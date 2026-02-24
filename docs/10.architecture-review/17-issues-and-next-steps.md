# 第八轮 — 问题清单与下一步

> 日期: 2026-02-12
> 来源: 16-eighth-round-comprehensive-analysis.md

---

## 一、P0 问题（必须修复）

### C-1: secrets.json5 变更不触发热重载

**位置**: `ConfigLoader.ts` L75-76, `ConfigWatcher.ts` L108
**原因**: hash 仅基于 coobee.json5 内容，修改 secrets.json5 时 hash 不变，processChange 直接 return
**修复方案**: 在 ConfigSnapshot 中增加 secretsHash，或在 processChange 中同时计算 secrets 文件的 hash，任一变化即触发重载

---

### C-2: config.getAll 返回含真实 API Key

**位置**: Gateway `config.getAll` → ConfigStore → ConfigLoader（已合并 secrets）
**原因**: secrets 在 ConfigLoader 管线中合并后，成为 config 的一部分，getAll 直接返回
**修复方案**: Gateway 层对返回结果做脱敏，将 `models.providers.*.apiKey` 替换为 `"***"` 或原始 `${VAR}` 模板

---

### P-1: PiMonoBuilder.resolveApiKey 与 ApiKeyResolver 逻辑不一致

**位置**: `PiMonoBuilder.ts` L235-249
**原因**: `${VAR}` 模板未解析时直接返回字面量，不继续尝试 env fallback
**修复方案**: 统一使用 ApiKeyResolver，或在模板解析失败后继续 fallback（process.env[PROVIDER]\_API_KEY）

---

### P-2: chat 入口未传递 sessionId/agentId

**位置**: `chat.ts` L79-98, `applyProviderConfig` 调用 `selector.resolve()`
**原因**: resolve() 无参数，始终使用全局默认
**修复方案**: 从 chat 请求中提取 sessionId/agentId，传入 selector.resolve({ sessionId, agentId })

---

### A-1: AbortSignal 未贯穿 Runtime 和工具层

**位置**: AgentExecutor → Runtime → ToolExecutionPipeline
**原因**: ExecutionConfig 无 signal 字段，runtime.stream() 不接收 signal，工具层无法感知取消
**修复方案**:

1. ExecutionConfig 增加 `signal?: AbortSignal`
2. runtime.stream(message, { signal }) 透传
3. ToolExecutionPipeline 接收并检查 signal

---

### L-1: before-quit 异步清理可能未完成即退出

**位置**: `src/main/common/app/index.ts` L99-114
**原因**: Electron before-quit 不等待 async handler
**修复方案**: 使用 `event.preventDefault()` 阻止退出，清理完成后调用 `app.quit()`

---

## 二、P1 问题（重要改进）

| ID  | 子系统    | 问题                                                   | 修复方案                                           |
| --- | --------- | ------------------------------------------------------ | -------------------------------------------------- |
| C-3 | Config    | ConfigStore.set/patch 可能把 secrets 写入 coobee.json5 | 写入前对 apiKey 做脱敏/过滤                        |
| C-4 | Config    | mergeSecrets 原地修改传入对象                          | 使用 structuredClone 深拷贝后合并                  |
| C-5 | Config    | ConfigStore 无单元测试                                 | 补充 get/set/patch/writeRawConfig 测试             |
| P-3 | Provider  | loadFromConfig 未映射 maxOutputTokens                  | 增加 `maxTokens: m.maxTokens ?? m.maxOutputTokens` |
| P-4 | Provider  | ProviderRegistry 覆盖 name 为 key                      | 改为 `name: providerConf.name ?? id`               |
| P-5 | Provider  | 空配置时默认模型不一致                                 | 统一 ModelSelector fallback 与 Builder 默认值      |
| P-6 | Provider  | parseModelRef 对异常输入缺少校验                       | 增加 trim、非空校验                                |
| A-2 | Agent     | HITL 等待期间 Abort 无效                               | Promise.race([waitForDecision, signalAborted])     |
| A-3 | Agent     | consumeAndForward 仅在 chunk 间检查 Abort              | 将 signal 传入 Runtime/Tool，使阻塞操作可中断      |
| A-4 | Agent     | AbortManager.isAborted 在 abort 后返回 false           | 记录已 abort 状态到 Set                            |
| A-5 | Agent     | MessagePipeline.queues 永不清理                        | 空闲时移除或加 TTL                                 |
| A-6 | Agent     | StreamEmitter.sequenceCounters 永不清理                | session 结束时清理                                 |
| A-7 | Agent     | Drain 期间 Abort 仍继续                                | drainQueue 开始时检查 abort 状态                   |
| L-2 | Lifecycle | HttpServer/IpcServer 无显式关闭                        | 增加 BeforeQuitServerHook                          |
| L-3 | Lifecycle | 日志路径变更 handler 未实现                            | 在 handler 中调用 setLogPath                       |
| L-4 | Lifecycle | ReadyInfraHook 失败时半初始化                          | 设为 critical 或 throw                             |

---

## 三、P2 问题（低优先级）

| ID  | 问题                                    | 备注             |
| --- | --------------------------------------- | ---------------- |
| C-6 | ConfigStore 写入丢失 JSON5 注释         | 建议手动编辑配置 |
| C-7 | debounceTimer 未置 null                 | 代码卫生         |
| P-7 | OpenAIBuilder 不支持 fromProviderConfig | 未来扩展需补齐   |
| A-8 | debounceMs 已定义未实现                 | 功能缺失         |
| A-9 | stream() 路径不支持 Abort               | SSE 场景         |
| L-5 | Logger.init() async 未 await            | 竞态风险低       |
| L-6 | Hook 注释 priority 数值不符             | 维护性           |

---

## 四、建议修复顺序

### 阶段 1: 安全与热重载（Config 子系统）

1. **C-1**: secrets hash 纳入热重载判断
2. **C-2**: Gateway 返回配置时脱敏 API Key
3. **C-3**: ConfigStore 写入时过滤 secrets
4. **C-4**: mergeSecrets 不可变改造

### 阶段 2: Provider 一致性

5. **P-1**: 统一 API Key 解析（复用 ApiKeyResolver）
6. **P-3**: loadFromConfig 补充 maxOutputTokens 映射
7. **P-4**: name 使用配置值
8. **P-5**: 默认模型对齐

### 阶段 3: Abort 全链路

9. **A-1**: signal 贯穿 Runtime → Tool
10. **A-2**: HITL 感知 abort
11. **A-4**: AbortManager.isAborted 修复
12. **A-7**: Drain 时检查 abort

### 阶段 4: 生命周期与资源

13. **L-1**: before-quit 正确等待异步清理
14. **A-5/A-6**: Pipeline 和 StreamEmitter 内存清理
15. **L-2**: Server 显式关闭

---

## 五、风险评估

| 风险                           | 可能性 | 影响 | 对策                    |
| ------------------------------ | ------ | ---- | ----------------------- |
| secrets 通过 getAll 泄露到前端 | 高     | 高   | 阶段 1 立即修复         |
| abort 无法中断长时间工具执行   | 高     | 中   | 阶段 3 系统性修复       |
| 应用退出时数据丢失             | 中     | 高   | 阶段 4 修复 before-quit |
| secrets 被写入 coobee.json5    | 中     | 高   | 阶段 1 修复 ConfigStore |
