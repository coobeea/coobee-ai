# 系统改进计划

> 基于全模块深度分析，汇总所有发现的问题和改进建议。

## 优先级说明

- **P0 (紧急)**：安全漏洞、数据丢失风险
- **P1 (重要)**：功能缺陷、架构问题
- **P2 (改进)**：性能优化、代码质量
- **P3 (增强)**：新功能、体验优化

---

## P0 — 安全与数据安全

| #   | 问题                                                     | 模块         | 影响 | 建议                             |
| --- | -------------------------------------------------------- | ------------ | ---- | -------------------------------- |
| 1   | command-scanner 白名单过宽（node/python 可执行任意脚本） | 安全沙箱     | 高   | 对白名单命令做参数级检查         |
| 2   | Extension 在主进程运行无沙箱                             | Extension    | 高   | 考虑 Worker 进程隔离或权限边界   |
| 3   | files.copy 未校验 sourcePath                             | Gateway HTTP | 高   | 对 sourcePath 做 isPathSafe 校验 |
| 4   | 读操作无路径边界限制                                     | 安全沙箱     | 中   | 对 readOnly 操作也做 path-guard  |
| 5   | learned-commands.json 无签名校验                         | exec-policy  | 中   | 增加完整性校验或用户确认         |
| 6   | HTTP API 无认证机制                                      | Gateway      | 中   | 增加简单 token 或 IPC 校验       |

## P1 — 架构与功能

| #   | 问题                               | 模块                    | 建议                                             |
| --- | ---------------------------------- | ----------------------- | ------------------------------------------------ |
| 7   | LLMClient 与 ProviderRegistry 脱节 | Provider / Quality Loop | 统一接入 ProviderRegistry + ModelFallback        |
| 8   | UnifiedGateway 与主 Gateway 未打通 | Gateway                 | 明确迁移路径或作为适配层统一入口                 |
| 9   | 质量循环仅 Orchestrator 使用       | Quality Loop            | 扩展至单 Agent 模式                              |
| 10  | GatewayClient 重连后无自动重订阅   | Gateway / 前端          | onConnect 中自动重订阅当前会话                   |
| 11  | Worker 配置热重载未启用            | Worker                  | 在 ReadyWorkerHook 中调用 startWatching()        |
| 12  | Extension 热重载竞态               | Extension               | 加锁或版本号，避免卸载中被调用                   |
| 13  | 并发会话无上限控制                 | AgentExecutor           | 增加全局最大并发会话配置                         |
| 14  | Process 与 Thread 无绑定           | Process                 | 在 ProcessRegistry 记录 threadId，按 Thread 清理 |
| 15  | 子任务失败无部分成功模式           | Orchestrator            | 支持 partial-success 状态                        |
| 16  | 前端 fetch 与 GatewayClient 混用   | 前端                    | 统一为 Gateway RPC 或封装 API 层                 |
| 17  | Store 分散、职责边界不清           | 前端状态管理            | 统一规划 Store 分层和命名                        |

## P2 — 性能与效率

| #   | 问题                                | 模块                | 建议                                              |
| --- | ----------------------------------- | ------------------- | ------------------------------------------------- |
| 18  | Terminal/Process 事件全量广播       | Gateway EventBridge | 增加订阅过滤（类似 stream 的 subscribedSessions） |
| 19  | OpenAI FileSession JSONL 无大小限制 | Runtime             | 增加 session 文件大小上限或自动归档               |
| 20  | exec 前台默认超时 30s 偏短          | 工具                | 可配置或根据命令类型调整                          |
| 21  | ModelFallback 无重试间隔            | Provider            | 增加可配置的 delayMs                              |
| 22  | 记忆系统无容量限制和淘汰机制        | Memory              | 增加 maxEntries/TTL 配置                          |
| 23  | venv 每次启动都 pip install         | Worker              | 增加依赖锁和缓存判断                              |
| 24  | MessageBus 无消息大小限制           | Swarm               | 增加单消息/总量限制                               |

## P3 — 体验与增强

| #   | 问题                              | 模块         | 建议                                            |
| --- | --------------------------------- | ------------ | ----------------------------------------------- |
| 25  | AgentView 约 1200 行，职责过多    | 前端组件     | 拆分为 AgentCard、AgentCreateForm、RunDialog 等 |
| 26  | formatRelativeTime 等函数重复定义 | 前端工具     | 抽到 utils/format.ts                            |
| 27  | Sidebar 与路由入口不一致          | 前端 UI      | logs/settings 需在底部栏或 sidebar 增加入口     |
| 28  | 无全局错误边界                    | 前端         | 增加 Vue Error Boundary 防止白屏                |
| 29  | 无离线/断连提示                   | 前端         | 增加 GatewayClient 连接状态提示                 |
| 30  | Skill 依赖关系未声明              | Skill        | frontmatter 增加 depends 字段                   |
| 31  | 快捷键无文档或设置界面            | 前端         | 增加快捷键配置页                                |
| 32  | PlanVersionManager 版本无限增长   | Orchestrator | 增加版本淘汰策略                                |
| 33  | approval-done 事件已废弃但仍兼容  | Thread       | 清理废弃代码                                    |
| 34  | PTY 环境变量全量继承              | Terminal     | 过滤敏感环境变量                                |

---

## 改进路线图建议

### 第一阶段：安全加固（P0）

- 修复 command-scanner 白名单
- files.copy sourcePath 校验
- 读操作 path-guard
- HTTP API 基础认证

### 第二阶段：架构优化（P1）

- LLMClient 接入 Provider 体系
- GatewayClient 重连重订阅
- Process/Thread 绑定
- 前端 API 层统一

### 第三阶段：性能提升（P2）

- 事件定向推送
- Session 文件大小控制
- 记忆系统容量管理
- Worker 依赖缓存

### 第四阶段：体验增强（P3）

- AgentView 组件拆分
- 全局错误边界
- 快捷键管理
