# EvoMap 参考资料总结

> **整理日期**: 2026-02-23  
> **来源**: `/Users/lifeng/git/git_deep/deep-study/agent-network/networks/evomap/`  
> **作用**: 快速了解 EvoMap 的核心设计思想

---

## 1. EvoMap 是什么？

**一句话**: AI Agent 的 GitHub + NPM + Stack Overflow

**Slogan**: "One agent learns. A million inherit."  
（一个智能体学习，百万智能体继承）

---

## 2. 核心概念

### Gene（基因）→ 我们的"方案模板"

**定义**: 解决问题的策略/方法论

**包含**:

- 问题识别（signals_match, reuse_contexts）
- 解决策略（summary, strategy）
- 验证方法（validation, expected_outcomes）

**示例**:

```json
{
  "type": "Gene",
  "category": "repair",
  "signals_match": ["TimeoutError"],
  "summary": "Retry with exponential backoff on timeout errors",
  "asset_id": "sha256:abc..."
}
```

---

### Capsule（胶囊）→ 我们的"实践案例"

**定义**: Gene 的具体实现和效果

**包含**:

- 具体实现（content）
- 效果评估（confidence, success_streak）
- 环境信息（env_fingerprint）

**示例**:

```json
{
  "type": "Capsule",
  "gene": "sha256:abc...",
  "summary": "Fix API timeout with bounded retry",
  "confidence": 0.85,
  "blast_radius": { "files": 1, "lines": 10 },
  "outcome": { "status": "success", "score": 0.85 },
  "asset_id": "sha256:def..."
}
```

---

### EvolutionEvent（进化事件）→ 我们的"演进记录"

**定义**: 解决问题的过程记录

**包含**:

- 尝试次数（mutations_tried）
- 失败/成功的尝试
- 最终选择和原因

**示例**:

```json
{
  "type": "EvolutionEvent",
  "intent": "repair",
  "capsule_id": "sha256:def...",
  "genes_used": ["sha256:abc..."],
  "outcome": { "status": "success", "score": 0.85 },
  "mutations_tried": 3,
  "asset_id": "sha256:ghi..."
}
```

---

### Bundle（捆绑包）→ 我们的"经验包"

**定义**: Gene + Capsule + EvolutionEvent 的完整包

**为什么必须打包**:

1. 质量保证：必须有实际证据
2. 知识完整：不只是理论，还有实践
3. 防止空谈：必须真正解决过问题
4. 激励机制：真正有价值才能赚钱

---

## 3. 核心设计思想

### 3.1 三元组知识结构

```
Gene (策略)
  ↓ 告诉你"应该怎么想"
Capsule (实现)
  ↓ 告诉你"具体怎么做"
EvolutionEvent (过程)
  ↓ 告诉你"为什么这样做"

三者结合 = 完整的知识传承
```

### 3.2 内容寻址（Content-Addressable）

```
asset_id = sha256(content)

优点：
  • 内容决定 ID（全球唯一）
  • 内容不可变（改了 = 新资产）
  • 自动去重（相同内容 = 相同 hash）
  • 完整性校验（hash 不匹配 = 被篡改）
```

### 3.3 强制完整性（Bundle Required）

```
❌ 不能只发 Gene（只有理论）
❌ 不能只发 Capsule（只有实现）

✅ 必须 Gene + Capsule 一起发
✅ 强烈推荐加 EvolutionEvent

好处：
  • 保证每个资产都有价值
  • 完整的知识传承
  • 后来者不用重复试错
```

### 3.4 协作进化（Cooperation > Competition）

**生物学启发**:

- 进化不只是竞争（弱肉强食）
- 更重要的是协作（共生、基因水平转移）

**EvoMap 应用**:

- Agent 之间不是竞争
- 而是分享能力（水平转移）
- "One agent learns, a million inherit"

---

## 4. GEP-A2A 协议

### 4.1 协议本质

**底层**: 普通 HTTP + JSON  
**应用层**: 标准化规范（Envelope Pattern）

```
普通 REST API = 直接发业务数据
EvoMap A2A    = 业务数据包裹在统一的信封里
```

### 4.2 Envelope Pattern（7 层封装）

```json
{
  "protocol": "gep-a2a",
  "protocol_version": "1.0.0",
  "message_type": "publish",
  "message_id": "msg_xxx",
  "sender_id": "node_xxx",
  "timestamp": "2026-02-23T10:00:00Z",
  "payload": {
    /* 业务数据 */
  }
}
```

**好处**:

- 统一的消息结构
- 协议可演进（protocol_version）
- 每条消息可追溯（message_id）

---

## 5. 我们采纳的设计

| EvoMap 设计        | 是否采纳      | 我们的实现                               |
| ------------------ | ------------- | ---------------------------------------- |
| 三元组结构         | ✅ 是         | Pattern + Practice + Evolution           |
| 内容寻址（SHA256） | ✅ 是         | asset_id 计算                            |
| 强制完整性         | ✅ 是         | Package 必须完整                         |
| 生命周期管理       | ✅ 是（简化） | candidate → validated → promoted         |
| Envelope Pattern   | ⚠️ 简化       | 3 层（message_id + timestamp + payload） |
| 收益系统           | ❌ 否         | 内部使用不需要                           |
| 全球网络           | ❌ 否         | 本地单机                                 |
| 质量评分（GDI）    | ⏳ 后续       | 暂不实现                                 |

---

## 6. 核心差异

### 我们 vs EvoMap

| 维度       | EvoMap                         | Coobee Brain                   |
| ---------- | ------------------------------ | ------------------------------ |
| **范围**   | 全球网络                       | 本地单机                       |
| **存储**   | 云端数据库                     | 文件系统                       |
| **命名**   | Gene/Capsule/Event             | Pattern/Practice/Evolution     |
| **系统名** | EvoMap Hub                     | Brain（智库）                  |
| **工具**   | 不注册工具，纯 HTTP + skill.md | 不注册工具，纯 HTTP + SKILL.md |
| **协议**   | 7 层 Envelope                  | 3 层简化版                     |

---

## 7. 参考文档位置

### EvoMap 分析文档（外部）

完整路径：`/Users/lifeng/git/git_deep/deep-study/agent-network/networks/evomap/`

**关键文档**：

- `00-阅读指南.md` - 文档索引
- `01-evomap网站分析.md` - 25 章完整分析
- `08b-最终正确理解.md` - Gene/Capsule/Event 关系
- `10-a2a协议详解.md` - 协议本质分析
- `protocol.md` - 官方协议文档
- `skill.md` - 官方集成指南

### Coobee 设计文档（本目录）

- `01-设计方案.md` - 完整设计
- `02-EvoMap参考资料.md` - 本文件
- `03-命名对照表.md` - 概念映射
- `04-实施计划.md` - 开发任务

---

## 8. 核心价值

### 对 Agent

- ✅ 避免重复解决同样的问题
- ✅ 快速获取经过验证的方案
- ✅ 理解"为什么"而非只是"怎么做"

### 对系统

- ✅ 经验沉淀和复用
- ✅ Agent 能力持续积累
- ✅ 形成自己的智库体系

---

## 9. 设计理念（来自 EvoMap）

### 生物学启发

```
Gene（基因）    = 信息编码
Evolution（进化） = 协作而非竞争
Symbiosis（共生）= 人机协作
```

### 核心哲学

> "Life is a vortex -- its form is more essential than its matter."  
> 生命是信息涡流，形式比物质更本质

**应用到 AI**:

- Agent 的能力本质是信息（Pattern）
- 能力可以编码、复制、进化
- 通过分享能力，整个生态进化

---

## 📝 更新记录

- 2026-02-23: 创建智库设计文档集
- 2026-02-23: 整理 EvoMap 参考资料

---

**维护者**: AI Agent  
**版本**: v0.1  
**状态**: 设计阶段
