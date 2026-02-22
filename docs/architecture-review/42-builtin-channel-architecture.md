# 42. 内置酒馆服务与 Channel 模式的融合架构设计

## 1. 核心业务定位与需求澄清

基于我们的深度讨论，明确了一个极其关键的架构边界原则：

- **保持不变的部分（发布任务侧）**：用户在酒馆前端填表、主进程处理 API、数据写入本地 SQLite/JSONL 的这套“发布任务”的流程**完全保持现状，作为内置服务不做改动**。
- **需要重构的部分（Agent 对接侧）**：后端 AI Agent 如何感知新任务、如何接取任务、如何提交任务结果。这部分必须**完全剥离解耦**，Agent 体系必须把内置的酒馆系统当作一个**“外部系统”**来对待。

这是一种极度优雅的架构模式：**物理同构（都在主进程），逻辑解耦（通过 Channel 模式通信）**。

## 2. 架构设计的“边界隔离”

既然 Agent 要把内置酒馆当成“外部系统”，我们需要在两者之间建立一道虚拟的网络边界——**Channel（通道层）**。

| 维度     | 酒馆系统（内置）                                                       | Channel 层（对接管线）                                     | Agent 体系（AI大脑）                                               |
| -------- | ---------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| **职责** | 提供任务 CRUD、数据库读写、抛出生命周期事件。                          | 作为“翻译官”，将内部事件转化为外部系统事件；提供对接工具。 | 监听外部事件，进行能力匹配和任务执行。                             |
| **感知** | 不知道 Agent 的存在。它只负责在任务状态改变时 `emit('task.changed')`。 | 左手牵着酒馆服务，右手牵着全局 EventBus 和 ToolRegistry。  | 不知道酒馆是内置的。它只知道有个叫 `tavern` 的外部通道发来了任务。 |
| **通信** | Node.js 内存事件 (EventEmitter)                                        | -                                                          | 订阅 `external.tavern.*` 事件，调用 `external_tavern_*` 工具。     |

## 3. 数据与事件流转图 (Data Flow)

```mermaid
graph TD
    subgraph 现有的内置酒馆业务 (保持不变)
        User[用户前端 UI] -->|1. 发布任务 /api/tasks| TavernAPI[现有的 HTTP API / IPC]
        TavernAPI -->|2. 写库| DB[(本地数据库)]
        TavernAPI -->|3. 抛出纯粹的内置事件| InternalEmitter[Node EventEmitter]
    end

    subgraph Channel 扩展对接层 (新架构)
        TavernChannel[Tavern Channel Plugin]
        TavernChannel -->|4. 监听内部事件| InternalEmitter
        TavernChannel -->|5. 翻译为标准外部事件\nexternal.tavern.task.created| EventBus[系统全局 EventBus]
        TavernChannel -.->|6. 注册交互工具\nexternal_tavern_submit_result| ToolRegistry[Tool Registry]
    end

    subgraph Agent 智能调度与执行体系 (完全解耦)
        TaskDispatcher[Task Dispatcher 调度器]
        TaskDispatcher -->|7. 收到任务事件| EventBus
        TaskDispatcher -->|8. 能力匹配与分配| Agent[具体的 AI Agent]

        Agent <--> ToolRegistry
        Agent -->|9. 执行完成后, 将酒馆当做外部系统\n调用 submit_result 工具| TavernCore[酒馆核心逻辑]
    end

    classDef highlight fill:#d4edda,stroke:#4caf50,stroke-width:2px;
    class TavernChannel,TaskDispatcher highlight;
```

## 4. 实施层面的伪代码示例

### 4.1 现有的酒馆逻辑（略微改造：增加事件抛出）

酒馆本身不需要去写任何对接 Agent 的逻辑，只需在关键节点加上事件抛出：

```typescript
// 现有的创建任务方法
async function createTask(taskData) {
  const task = await db.insert(taskData);
  // 【唯一需要加的一行代码】抛出 Node 内部事件
  TavernEventEmitter.emit('task.created', task);
  return task;
}
```

### 4.2 Tavern Channel Plugin（对接翻译层）

这就是我们双层架构中位于应用层的 **Plugin**。

```typescript
export const tavernChannelPlugin = {
  id: 'tavern',
  name: '酒馆对接通道',

  register(api) {
    // 1. 注册 Channel，并在启动时挂载事件监听
    api.registerChannel({
      id: 'tavern',
      gateway: {
        start: async (ctx) => {
          const handler = (task) => {
            // 将内部事件包装为“外部系统标准事件”抛给全局
            eventBus.emit('external.tavern.task.created', task);
          };
          TavernEventEmitter.on('task.created', handler);

          ctx.abortSignal.addEventListener('abort', () => {
            TavernEventEmitter.off('task.created', handler); // 安全清理
          });
        }
      }
    });

    // 2. 注册给 Agent 用的“外部调用工具”
    api.registerTool({
      name: 'external_tavern_submit_result',
      description: '向外部酒馆系统提交任务结果',
      execute: async (params) => {
        // Direct模式：因为物理上在同一个进程，直接调方法，而不是发起 HTTP 请求
        return await TavernCore.submitResult(params.taskId, params.result);
      }
    });
  }
};
```

### 4.3 Task Dispatcher（Agent 大脑层）

```typescript
// 作为一个全局的后台服务启动
eventBus.on('external.tavern.task.created', async (task) => {
  // 1. LLM 分析 task，提取复杂度与所需技能
  const analysis = await TaskAnalyzer.analyze(task);

  // 2. 在所有内置 Agent 中找最匹配的
  const bestAgentId = await AgentMatcher.match(analysis);

  // 3. 启动该 Agent，并在 System Prompt 中限制它只能使用 external_tavern_ 系列工具
  AgentExecutor.run(bestAgentId, {
    taskContext: task,
    allowedTools: ['external_tavern_submit_result']
  });
});
```

## 5. 总结

你提出的这种“保持发布端内置，Agent 端作外部系统解耦”的设计，是**企业级单体应用演进的最优解**：

1. **零改造成本**：现有的前端 Vue 界面、现有的主进程 API 都不用动，稳定性 100%。
2. **极强的扩展性**：如果哪天你要把 Agent 系统独立部署（或者把酒馆独立出去），你只需要把 `TavernChannel` 里的 `TavernEventEmitter.on` 改成 `new WebSocket()`，Agent 端一行代码都不需要改。
3. **架构的高级感**：这就是**边界隔离**的魅力，系统内的两个模块互不相认，完全靠标准的 Channel 协议和 EventBus 握手。
