# 第三十五轮 — P0/P1 修复行动计划 (Next Improvement Roadmap)

> 基于第三十四轮的四维度架构审查结果，我们制定了接下来的修复计划，按优先级分为三大战役。

## 战役一：系统安全与数据持久化修复 (Immediate / P0)

**目标**：消除高危漏洞，确保核心策略生效。

- [ ] **M-P0-1 & M-P0-2**: 修复 Gateway Server 接口 (`http/files.ts`, `http/skills.ts`) 中的路径穿越和任意文件读取问题，引入严格的 `path.resolve` 根目录前缀判断机制。
- [ ] **S-P0-1**: 修复 `exec-policy.ts` 中针对 `config` 模块的错误引用，改为 `env`，确保用户“总是允许”的指令能够正确落盘持久化。
- [ ] **S-P0-2**: 从 `exec-policy.ts` 的 `SAFE_BINS` 中移除 `sed` 或拦截 `-i` 参数，防止直接篡改文件。
- [ ] **M-P0-3**: 修改 `tabHandlers.ts` 的 IPC 逻辑，强制验证或使用 `event.sender` 所属的 `windowId`，禁止越权操作其他窗口的 Tab。

## 战役二：内存泄漏与资源阻断修复 (High / P0-P1)

**目标**：清理长生命周期应用中最容易导致卡顿和 OOM 的隐患。

- [ ] **B-P0-1**: 修复 `SwarmCoordinator` 的内存泄漏，在 `handoff` 后确保显式调用 `AgentPool` 的 `releaseAgent/retireAgent` 释放代理运行时。
- [ ] **F-P1-1 & F-P1-2**: 修复前端 `App.vue` 中的 `workerCleanup` 缺失问题，以及 `LayerManager` 中的 `keydown` 监听器泄漏。
- [ ] **F-P1-4**: 修复 `eventbus` 的 `once` 封装导致的内存清理死角，暴露正确的 `off` 方法或维护内置包裹映射。
- [ ] **M-P1-1 & M-P1-4**: 在 Gateway 与 Server 退出环节实现完整的 `close()` 卸载流程（包括 EventBridge 监听清理）。

## 战役三：并发竞态与状态一致性修复 (High / P0)

**目标**：确保多智能体、多会话并发执行时的状态不出错。

- [ ] **F-P0-1**: 前端 `ThreadView` 中的 `loadHistory` 加入请求版本或 AbortController，解决快速切换带来的串台问题。
- [ ] **F-P0-2**: 重构流式订阅逻辑，解决 Chat 与 Copilot 互相抢占单一 `stream.subscribe` 导致断流的问题。
- [ ] **B-P0-2 & B-P0-4**: 修复 `SwarmCoordinator` 共享状态的无锁突变问题，引入状态克隆或细粒度并发锁；同步修正 Pipeline 的 busy 状态设置时差。
- [ ] **B-P0-3 & B-P0-5**: 为 Tool 审批生成和 SessionQueue 的 MessageId 生成器替换为基于 UUID 或带原子操作前缀的生成逻辑。

---

**执行准则**：
遵循 `.cursor/rules/dev-workflow.mdc`，每完成一个 Ticket 的修复，需补充/更新对应单元测试，确保类型检查通过后，采用 `simple-git-hooks` 规范自动提交。
