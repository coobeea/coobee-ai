# 16 - Channel 架构重构总体方案

> **文档版本**: v1.0  
> **创建日期**: 2026-03-05  
> **状态**: 📋 方案设计中

---

## 1. 背景与动机

### 1.1 当前问题

当前系统中的"群聊讨论"、"专家会诊"等多智能体协作功能是作为**独立的内部功能**实现的，存在以下问题：

1. **架构局限性**：
   - 讨论室、会诊室等功能直接调用 `agentExecutor`
   - 每个功能都要重复实现 Agent 加载、Builder 构建、工具/技能注入逻辑
   - 代码耦合度高，难以复用

2. **扩展性不足**：
   - 无法方便地对接外部系统（飞书、Slack、Discord、钉钉等）
   - 未来需要为每个外部系统单独实现一套对接逻辑
   - 缺乏统一的消息格式和路由机制

3. **设计思维局限**：
   - 将讨论室视为"内部功能"而非"通信渠道"
   - 与外部系统对接的设计思路脱节
   - 没有为未来的生态扩展做好准备

### 1.2 设计目标

**核心理念转变**：将所有多智能体协作场景统一视为 **Channel**（通信渠道）

```
旧思维:  讨论室 = 内部功能  ❌
        飞书   = 外部系统

新思维:  讨论室 = Discussion Channel  ✅
        飞书   = Feishu Channel
        Slack  = Slack Channel
        所有 Channel 平等对待，统一架构
```

**技术目标**：

1. ✅ **统一抽象**：所有 Channel 使用相同的接口与 Agent 交互
2. ✅ **完全解耦**：Channel 不关心 Agent 细节，Agent 不关心消息来源
3. ✅ **易于扩展**：新增 Channel 只需实现标准接口
4. ✅ **面向未来**：为外部系统对接（飞书、Slack、钉钉）做好准备

---

## 2. 架构设计概览

### 2.1 核心组件

```
┌─────────────────────────────────────────────────────────┐
│                   ChannelRuntime                        │
│         (统一的 Agent 调度与消息路由层)                  │
│  - Agent 加载                                           │
│  - Builder 构建                                         │
│  - 工具/技能注入                                        │
│  - Context 增强                                         │
│  - Session 管理                                         │
└─────────────────────────────────────────────────────────┘
                            ▲
                            │ 统一接口
            ┌───────────────┼───────────────┐
            │               │               │
    ┌───────▼──────┐ ┌─────▼──────┐ ┌─────▼──────┐
    │ Discussion   │ │  Feishu    │ │   Slack    │
    │  Channel     │ │  Channel   │ │  Channel   │
    │  (内置)      │ │  (外部)    │ │  (外部)    │
    │              │ │            │ │            │
    │ • Inbound    │ │ • Inbound  │ │ • Inbound  │
    │ • Outbound   │ │ • Outbound │ │ • Outbound │
    │ • Lifecycle  │ │ • Lifecycle│ │ • Lifecycle│
    └──────────────┘ └────────────┘ └────────────┘
```

### 2.2 设计原则

| 原则         | 说明                             | 对标 OpenClaw               |
| ------------ | -------------------------------- | --------------------------- |
| **插件化**   | 所有 Channel 均为 Extension      | ✅ ChannelPlugin            |
| **标准接口** | 统一的消息格式和生命周期         | ✅ Inbound/Outbound Adapter |
| **职责分离** | Channel 只管通信，Runtime 管调度 | ✅ ChannelRuntime           |
| **可配置化** | 支持多账号、热重载、动态启停     | ✅ ChannelConfigAdapter     |

---

## 3. 改进任务清单

本次重构涉及 **6 个核心任务**，每个任务单独一个详细设计文档：

| 任务 ID    | 任务名称                  | 文档                                   | 优先级 | 依赖           |
| ---------- | ------------------------- | -------------------------------------- | ------ | -------------- |
| **Task-1** | ChannelPlugin 接口定义    | `16.1-channel-plugin-interface.md`     | P0     | 无             |
| **Task-2** | ChannelRuntime 核心调度层 | `16.2-channel-runtime.md`              | P0     | Task-1         |
| **Task-3** | ExtensionApi 扩展         | `16.3-extension-api-enhancement.md`    | P0     | Task-1         |
| **Task-4** | ChannelManager 增强       | `16.4-channel-manager-enhancement.md`  | P1     | Task-1, Task-3 |
| **Task-5** | Discussion Channel 迁移   | `16.5-discussion-channel-migration.md` | P1     | Task-2, Task-3 |
| **Task-6** | Gateway HTTP 路由调整     | `16.6-gateway-route-refactor.md`       | P1     | Task-5         |

---

## 4. 实施阶段规划

### Phase 1: 基础架构（Day 1）

**目标**：搭建核心框架，定义标准接口

- [x] Task-1: ChannelPlugin 接口定义
- [x] Task-2: ChannelRuntime 实现
- [x] Task-3: ExtensionApi 扩展

**产出**：

- `src/main/channels/types.ts` - Channel 类型定义
- `src/main/channels/ChannelRuntime.ts` - 核心调度层
- `src/main/common/extension/types.ts` - 扩展 API

**验收标准**：

- ✅ 接口通过 TypeScript 类型检查
- ✅ ChannelRuntime 单元测试通过
- ✅ ExtensionApi 集成测试通过

---

### Phase 2: 讨论室迁移（Day 2）

**目标**：将现有讨论室改造为 Channel Plugin

- [x] Task-4: ChannelManager 增强
- [x] Task-5: Discussion Channel 迁移
- [x] Task-6: Gateway HTTP 路由调整

**产出**：

- `extensions/discussion-channel/index.ts` - 讨论室 Channel 实现
- `src/main/gateway/http/discussion.ts` - 路由重构

**验收标准**：

- ✅ 现有讨论室功能完全正常
- ✅ 多 Agent 轮转正常工作
- ✅ 前端 UI 无需任何修改

---

### Phase 3: 外部 Channel 接入（Future）

**目标**：验证架构扩展性，接入飞书

- [ ] Task-7: Feishu Channel Plugin 实现（未来）
- [ ] Task-8: Slack Channel Plugin 实现（未来）
- [ ] Task-9: 多租户与权限控制（未来）

**产出**：

- `extensions/feishu-channel/` - 飞书 Channel
- `extensions/slack-channel/` - Slack Channel

---

## 5. 技术亮点

### 5.1 对比 OpenClaw

| 特性               | OpenClaw                  | Coobee-AI (本方案)         | 说明               |
| ------------------ | ------------------------- | -------------------------- | ------------------ |
| **Channel Plugin** | 17 个 Adapter             | 精简版（3 个核心 Adapter） | 保留核心，去除冗余 |
| **投递模式**       | Direct/Gateway/Hybrid     | 统一 Direct（简化）        | 无需复杂路由       |
| **连接模式**       | WebSocket/Webhook/Polling | Extension 自主决定         | 灵活性更高         |
| **多账号**         | ChannelConfigAdapter      | 统一配置系统               | 复用现有 config    |
| **热重载**         | 配置文件监听              | EventBus 驱动              | 更轻量             |

### 5.2 创新点

1. **轻量化设计**：不引入 OpenClaw 的 17 个 Adapter 复杂度
2. **复用现有能力**：利用已有的 AgentStore、Builder、ToolRegistry
3. **Extension 优先**：所有 Channel 均为 Extension，无内置/外置之分
4. **渐进式迁移**：现有功能无缝升级，无破坏性变更

---

## 6. 风险与应对

### 6.1 技术风险

| 风险             | 影响 | 应对措施                  |
| ---------------- | ---- | ------------------------- |
| **破坏现有功能** | 高   | 保留原 API，渐进迁移      |
| **性能回退**     | 中   | ChannelRuntime 增加缓存层 |
| **类型定义复杂** | 低   | 参考 OpenClaw 成熟设计    |

### 6.2 时间风险

| 阶段    | 预估工期 | 风险点                 | 缓解措施             |
| ------- | -------- | ---------------------- | -------------------- |
| Phase 1 | 1 天     | 接口设计反复           | 参考 OpenClaw 设计   |
| Phase 2 | 1 天     | 讨论室迁移复杂         | 保留原逻辑，分步迁移 |
| Phase 3 | TBD      | 外部系统对接未知因素多 | 先做 PoC 验证        |

---

## 7. 成功标准

### 7.1 功能完整性

- ✅ 现有讨论室功能 100% 正常
- ✅ 现有专家会诊功能 100% 正常
- ✅ 前端 UI 无需任何修改
- ✅ 所有测试用例通过

### 7.2 架构质量

- ✅ 新增 Channel 只需 < 200 行代码
- ✅ Channel 与 Agent 完全解耦
- ✅ 支持热插拔（动态加载/卸载 Channel）
- ✅ TypeScript 类型安全

### 7.3 可扩展性

- ✅ 飞书 Channel 接入工作量 < 1 天
- ✅ Slack Channel 接入工作量 < 1 天
- ✅ 支持自定义 Channel（用户自行开发）

---

## 8. 后续演进方向

### 8.1 短期（Phase 3）

- 接入飞书/Slack/Discord
- 支持多租户（多账号管理）
- 支持流式输出到 Channel
- 支持工具调用可视化

### 8.2 长期（Phase 4+）

- Channel Marketplace（Channel 插件市场）
- Channel Analytics（通信数据分析）
- Channel Orchestration（跨 Channel 编排）
- AI Channel Router（智能消息路由）

---

## 9. 参考资料

### 9.1 外部参考

- [OpenClaw Channel Architecture](https://github.com/openclaw/openclaw) - 39-channel-modes-architecture.md
- [OpenClaw Feishu Channel](https://github.com/openclaw/openclaw) - 42-feishu-channel-implementation.md

### 9.2 内部参考

- `src/main/channels/ChannelManager.ts` - 现有 Channel 管理器
- `src/main/common/extension/types.ts` - Extension 系统
- `extensions/tavern-integration/index.ts` - 酒馆集成（参考示例）

---

## 10. 附录：术语表

| 术语               | 定义                           | 示例                               |
| ------------------ | ------------------------------ | ---------------------------------- |
| **Channel**        | 智能体与外部世界交互的通信渠道 | Discussion、Feishu、Slack          |
| **ChannelPlugin**  | 实现 Channel 功能的插件        | discussion-channel Extension       |
| **ChannelRuntime** | 统一的 Agent 调度与路由层      | 加载 Agent、注入工具、管理 Session |
| **Inbound**        | 入站消息（Channel → Agent）    | 飞书用户消息 → Agent               |
| **Outbound**       | 出站消息（Agent → Channel）    | Agent 回复 → 飞书群聊              |
| **Lifecycle**      | Channel 生命周期（start/stop） | 启动 WebSocket 监听                |

---

**下一步**：阅读各任务的详细设计文档（`16.1 ~ 16.6`），了解具体实现细节。
