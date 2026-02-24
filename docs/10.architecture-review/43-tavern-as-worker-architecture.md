# 43. 深入解析：从“Channel 对接”向“Tachikoma 多智能体（Worker）对接”的架构演进

## 1. 核心矛盾：我们真的需要把酒馆当作一个“死”的外部系统吗？

在第 41、42 篇方案中，我们讨论了如何使用 **Channel 模式** 将酒馆系统与 AI Agent 智能体进行解耦对接。  
无论是 41 篇的**“物理隔离（WebSocket 连接）”**，还是 42 篇的**“物理同构（Event-Driven 内存事件）”**，其底层逻辑都是一致的：

> **AI 大脑（Orchestrator/Agent）高高在上，将酒馆当成一个被动的外部数据源（External System）。当数据源有变动时通知我，我处理完再通过 Tool 写回去。**

但现在，你的视角发生了**升维**：

> **“我们已经有了一个 Tachikoma 架构中的 `Worker`（工作者）概念，它本身就能维护系统的启动和发布。我们为什么不让酒馆作为一个独立的 Worker，主动去扫任务、发事件，然后通过 Channel 或者 Orchestrator 进行对接？”**

这是一个极其深刻的架构洞察！
它把酒馆从一个**“被动的外部通道 (Passive Channel)”**，升级成了一个**“主动的业务智能体 (Active Worker)”**。

---

## 2. 什么是 Worker 模式？它与 Channel 模式有什么区别？

在现有的 Tachikoma 多智能体架构（参考文档 `Orchestrator-Worker交互机制深度解析.md`）中，**Worker** 是一等公民。

| 维度                       | Channel 模式（第41/42篇思路）                                             | Worker 模式（你现在提出的思路）                                                      |
| -------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **角色定位**               | 哑管道（Dumb Pipe）。负责数据搬运和事件格式转换。                         | **智能实体（Smart Agent）**。具备主观能动性，能执行特定的业务逻辑。                  |
| **运行机制**               | 依附于网关，生命周期由 ChannelManager 管理。被动接收 HTTP/WS/Event 请求。 | **独立进程/服务**。自己跑循环（Loop），自己去扫库（Polling），甚至有自己的思考过程。 |
| **交互媒介**               | EventBus / HTTP 请求                                                      | **Tachikoma 的共享文件系统 (Layer 2) / 内存通信 (Layer 1)**                          |
| **与 Orchestrator 的关系** | Orchestrator 不知道 Channel 的存在，它只听全局事件。                      | Orchestrator 直接将 `Tavern Worker` 纳入 WorkerPool 管理，双向发号施令。             |

---

## 3. 架构重塑：基于 Tachikoma Worker 的酒馆对接方案

如果我们采用你的思路，将酒馆对接层设计为一个 **“Tavern Worker”**（或者叫 Tavern Poller Worker），整个架构将发生翻天覆地的变化。它完美契合了系统已有的 Orchestrator-Worker 三层交互机制。

### 3.1 架构设计图

```mermaid
graph TD
    subgraph 酒馆业务系统 (物理上独立或内置均可)
        TavernDB[(酒馆任务库\nSQLite/JSONL)]
    end

    subgraph Tachikoma 多智能体生态圈

        subgraph 主动型业务 Worker
            TavernWorker[Tavern Polling Worker\n(酒馆侦察兵)]
            TavernWorker -->|1. 主动且不间断地轮询/扫库| TavernDB
        end

        subgraph Tachikoma 共享文件系统 (Layer 2)
            SharedFS[(.tachikoma/sessions/)]
            TavernWorker -->|2. 发现新任务, 写入共享文件/抛事件| SharedFS
        end

        subgraph 统筹者 Orchestrator
            Orch[Orchestrator / Task Dispatcher]
            Orch -->|3. 监控到新任务文件| SharedFS
            Orch -->|4. 任务规划与拆解\nPlanner| Orch
        end

        subgraph 任务执行 Worker
            ExecutionWorker[Task Execution Worker\n(执行任务的 AI)]
            Orch -->|5. 分配子任务给空闲 Worker| ExecutionWorker
            ExecutionWorker -->|6. 执行完成，写入产出物| SharedFS
        end

        %% 回写链路
        Orch -.->|7. 通知 TavernWorker 结果已就绪| TavernWorker
        TavernWorker -.->|8. 将结果回写到数据库| TavernDB
    end

    classDef highlight fill:#d4edda,stroke:#4caf50,stroke-width:2px;
    class TavernWorker,ExecutionWorker highlight;
    classDef core fill:#e2e3e5,stroke:#343a40,stroke-width:2px;
    class Orch core;
```

### 3.2 方案解析：Tavern Worker 如何工作？

在这个架构下，`Tavern Worker` 成为了一个特殊的、**只写代码不接大模型的“系统级 Worker”**。

1. **自主扫描（Polling / Watch）**：
   这个 Worker 启动后，跑一个无穷循环（`while(true)`）。它不断扫描酒馆的数据库（或者监听酒馆内部事件）。
2. **任务投递（Layer 2 文件协调）**：
   当它发现了一个状态为 `pending` 的新任务时，它不发普通的系统 Event，而是直接按照 Tachikoma 的协议，把任务写到 `.tachikoma/sessions/{sessionId}/shared/` 的共享目录中，或者写一个 `pending_task.json`。
3. **Orchestrator 统筹分配（Layer 1 内存）**：
   Orchestrator（统筹者）通过监听共享文件系统，立刻感知到新任务的到来。它调动 `Planner` 分析任务，然后从 `WorkerPool` 里揪出一个闲置的执行型 Worker（比如专门负责写代码的 Worker），把任务分配给它。
4. **状态回写**：
   执行型 Worker 做完后，把结果放在共享文件系统的 `artifacts/` 目录下。
   `Tavern Worker` 一直盯着这个目录，一旦发现属于它的任务做完了，它就主动把结果拿出来，写入到酒馆数据库里，把任务标记为 `completed`。

---

## 4. 这种“Worker 模式”的巨大优势

你提到：_“假如说我在另外部署一套之后，另外部署另外一套 Agent 的系统之后，它也可以通过这种方式来和我们这个酒馆服务对接起来。”_

没错！这正是 **Worker 模式** 碾压 **Channel 模式** 的地方。

### 优势 1：去中心化的松耦合（极易横向扩展）

在 Channel 模式下，网关（Gateway）是核心，通道依附于网关。如果系统挂了，通道也就死了。
但在 Worker 模式下，**大家都是对等的打工人**。

- **部署节点 A** 可以跑一个 `Tavern Worker`（专职扫任务并发布到文件系统）。
- **部署节点 B** 可以跑 10 个 `Execution Worker`（专职干活）。
- 它们甚至不需要在同一台机器上，只要它们能访问**同一个共享目录（或者同一个消息队列/Redis）**，这套机制就能完美运转！

### 优势 2：天然契合 Tachikoma 的“可恢复性（Reliable Path）”

参考深度解析文档中的第二层架构（文件协调），如果你的 `Execution Worker` 在做任务的过程中断电崩溃了：

- Channel 模式下，这个任务的上下文可能就丢失了，酒馆那边一直卡在“进行中”。
- 在 Tachikoma 的 Worker 模式下，任务的状态、思考日志（`thinking.jsonl`）、工具调用记录（`actions.jsonl`）全部在共享文件夹里。重启后，Orchestrator 会重新把这个半拉子工程丢给另一个 Worker 继续干。

### 优势 3：简化了接入层的代码

以前你需要写一个复杂的 `Tavern Channel Plugin`，还要在网关里注册通道、管心跳、管生命周期。
现在，你只需要写一个标准的 Python/TS **Worker 脚本**，通过 `WorkerManager` 启动它就行了。它的逻辑极其纯粹：

```python
# TavernWorker 伪代码
while True:
    new_tasks = db.query("status = 'pending'")
    for task in new_tasks:
        write_to_tachikoma_shared_fs(task)
        db.update(task.id, status='dispatched')
    time.sleep(5)
```

---

## 5. 对比总结：你应该选哪种？

| 维度           | 第 42 篇方案 (内置服务 + Channel 对接)               | 第 43 篇方案 (作为 Tachikoma Worker 扫库)                                     |
| -------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| **架构哲学**   | 集中式网关 (API Gateway / EventBus)                  | 去中心化智能体协同 (Multi-Agent File/Message Sync)                            |
| **实现成本**   | 低。直接内存调方法，基于现在的 Plugin 架构稍微改改。 | 中。需要严格遵守 Tachikoma 的共享文件读写协议。                               |
| **横向扩展性** | 弱。绑定在同一个 Node.js 进程内。                    | **极强**。只要共享存储在，随便在几台机器上部署几个 Agent 系统都可以无缝抢单。 |
| **容错与恢复** | 依赖应用层自己写恢复逻辑。                           | **天然支持**。文件系统里存着所有的 `checkpoint`。                             |

### 最终建议

你的直觉非常准确。如果**酒馆的发布任务侧是内置且不变的**，但你**未来的愿景是：能在这个系统之外，再拉起一套甚至多套独立的 Agent 系统来共同消费这些任务**，那么：

**放弃 Channel 模式，全面拥抱 Tachikoma Worker 模式！**

把酒馆对接逻辑写成一个 `Tavern Task Poller Worker`（扫任务的 Worker）和一个 `Tavern Result Submitter Worker`（写结果的 Worker）。
它们和那些真正调用大模型的 AI Worker 平级，统统接受 Orchestrator 的统筹。
这样，你的整个 AI 架构不仅完全解耦，而且具备了真正意义上的“分布式多智能体（Distributed Multi-Agent）”的雏形！
