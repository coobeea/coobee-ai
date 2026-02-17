# 第二十八轮 — 资源泄漏与前端状态分析

> 编号：28 | 日期：2026-02-17
> 维度：D-4 资源泄漏专项 / D-3 前端状态管理 / D-6 并发压力场景
> 方法：代码走查 + 生命周期配对分析
> 来源：26-comprehensive-architecture-review.md 所列未执行维度

---

## 一、分析维度与方法

| 维度      | 关注点                                                    | 发现              |
| --------- | --------------------------------------------------------- | ----------------- |
| 资源泄漏  | EventListener、Timer、Watcher、AbortController、WebSocket | 2 个 P0 + 3 个 P1 |
| 前端状态  | Store 一致性、Gateway 重连、组件清理、错误传播            | 1 个 P0 + 2 个 P1 |
| 并发/内存 | 消息积累、会话切换竞态                                    | 1 个 P1           |

---

## 二、发现与修复

### 已修复项

| ID  | 严重度 | 问题                                                  | 修复内容                                                 |
| --- | ------ | ----------------------------------------------------- | -------------------------------------------------------- |
| R-1 | **P0** | ExtensionLoader.stopWatch() 从未被调用，fs.watch 泄漏 | 添加 `BeforeQuitExtensionHook`，退出时调用 `stopWatch()` |
| R-2 | **P0** | Gateway.close() 从未被调用，WebSocket 服务未关闭      | 添加 `BeforeQuitGatewayHook`，退出时调用 `close()`       |
| S-1 | **P0** | 流式消息未按 sessionId 过滤，快速切换会话可能串台     | `useStreamWs.ts` 添加 `sessionId` 比对过滤               |
| S-2 | **P1** | Chat 消息无上限，长会话内存膨胀                       | 添加 `MAX_MESSAGES=500` 和 `trimMessages()`              |
| R-3 | **P1** | useEventBus.once() 注册的处理器在组件卸载时不清理     | 包装 handler 加入 subscriptions，onUnmounted 时自动清理  |

### 未修复项（记录备查）

| ID  | 严重度 | 问题                                                         | 建议修复                                   |
| --- | ------ | ------------------------------------------------------------ | ------------------------------------------ |
| R-4 | P1     | streamStore.destroy() 从未调用                               | 在 BEFORE_QUIT hook 中调用                 |
| R-5 | P1     | streamCleanup/workerCleanup 从未调用（前端）                 | 在 APP_BEFORE_QUIT 事件中调用              |
| R-6 | P1     | streamChannelManager.shutdown() 从未调用                     | 在 BEFORE_QUIT hook 中调用                 |
| R-7 | P2     | StreamMonitor/StreamBridge EventBus 监听器从未移除           | 添加 destroy() 方法                        |
| R-8 | P2     | ConfigWatcher.watcher.close() 返回 Promise 但未 await        | 改为 async stop()                          |
| S-3 | 中     | isStreaming 设置有间隙，sendMessage 到 start 事件之间可双击  | 在 sendMessage 中提前设置 isStreaming=true |
| S-4 | 中     | submitDecision/abortSession 错误仅 console.error，无 UI 反馈 | 添加全局错误 Toast                         |
| S-5 | 中     | 无 Vue app.config.errorHandler 全局错误边界                  | 添加全局 errorHandler                      |

---

## 三、修改文件清单

| 文件                                          | 修改类型                                         |
| --------------------------------------------- | ------------------------------------------------ |
| `src/main/lifecycle/ReadyExtensionHook.ts`    | 新增 `BeforeQuitExtensionHook`，保存 loader 引用 |
| `src/main/lifecycle/ReadyGatewayHook.ts`      | 新增 `BeforeQuitGatewayHook`，保存 gateway 引用  |
| `src/renderer/src/composables/useStreamWs.ts` | sessionId 过滤 + 重连补发 + lastReceivedSeq      |
| `src/renderer/src/stores/chat.ts`             | MAX_MESSAGES + trimMessages()                    |
| `src/renderer/src/composables/useEventBus.ts` | once() 处理器加入 subscriptions 自动清理         |

---

## 四、与历轮对比

| 轮次   | 维度                  | P0    | P1      | P2    | 特征                    |
| ------ | --------------------- | ----- | ------- | ----- | ----------------------- |
| 10     | 契约/边界/时序        | 7     | 19      | 35    | 竞态+结构               |
| 11     | 端到端+恢复           | 5     | 7       | 11    | 链路断裂                |
| 26     | 全维度综合            | 5     | 9       | 17    | 前后端断裂+死代码       |
| **28** | **资源泄漏+前端状态** | **3** | **2+6** | **2** | **生命周期不完整+内存** |

**趋势**：

- P0 数量持续下降（7→5→5→3），核心功能趋于稳定
- 问题类型从"功能缺陷"转向"运行时健壮性"（资源泄漏、状态管理）
- 前端状态管理是新的改进方向，之前轮次较少覆盖

---

## 五、累计修复统计（第 26-28 轮）

| 类别          | 修复数 | 代表性修改                                                 |
| ------------- | ------ | ---------------------------------------------------------- |
| 关键缺陷 (P0) | 8      | tool-approval API 修复、WebSocket 重连补发、sessionId 过滤 |
| 重要问题 (P1) | 7      | Extension 热重载清理、退出 Hooks、消息限制                 |
| 可观测性      | 2      | ExtensionLoader 日志统一、agents.error UI 展示             |
| 快速修复      | 3      | LogViewer 路由、stores 导出、配置文件自动重建              |
| **总计**      | **20** |                                                            |

---

## 六、下一步建议

按维度清单（doc 22），剩余未执行的维度：

1. **D-2: 边缘用例与防御性** — 超长消息、空消息、API Key 错误等
2. **D-7: Extension 体系完整性** — Hook 对称性、冲突解决、版本兼容
3. **D-8: 数据模型与持久化** — 存储格式、迁移策略、容量清理
4. **D-9: 类型安全专项** — 消除 `as any`、Zod 与 TS 一致性
5. **D-10: 测试覆盖与质量** — 覆盖率盲区、Mock 准确性

建议下一轮从 **D-2 边缘用例** 入手，模拟极端输入验证系统的防御性。
