# 第九轮 — 问题清单与下一步

> 日期: 2026-02-12
> 来源: 18-ninth-round-cross-cutting-analysis.md
> 维度: 安全 / 韧性 / 代码质量 / 性能

---

## 一、P0 问题（3个）

### R-1: 热重载无效配置覆盖有效配置

**位置**: `ConfigWatcher.ts` L110-116
**现象**: processChange 中在判断 `!nextSnap.valid` 前就执行了 `this.lastHash = nextSnap.hash` 和 `this.lastConfig = nextSnap.config`
**后果**: 配置格式损坏时，lastConfig 被 `mergeWithDefaults({})` 覆盖为空配置；下次修复格式后 diff 会认为所有字段都变了
**修复**: 将 lastHash/lastConfig 更新移到 valid 判断之后

---

### PF-1: SkillManager.scanSkills 每次 Agent 请求同步读文件

**位置**: `AgentEnvInjector` → `SkillManager.scanSkills()`
**现象**: 每次 Agent 请求都 `readdirSync` + `readFileSync` 扫描 Skill 目录
**后果**: 阻塞 Event Loop，workspace 中 Skill 多时延迟明显
**修复**: 缓存 Skill 列表 + 用 fs.watch 做增量更新，或改为 async

---

### PF-2: search 工具循环内 readFileSync

**位置**: `search.ts` 工具实现
**现象**: 遍历匹配文件时在循环内 `readFileSync` 读取每个文件
**后果**: 大 workspace（数千文件）严重阻塞 Event Loop
**修复**: 改为 `fs.promises.readFile` + 并发控制（如 p-limit）

---

## 二、P1 问题（7个）

| ID   | 维度 | 问题                                      | 修复方案                                                        |
| ---- | ---- | ----------------------------------------- | --------------------------------------------------------------- |
| S-1  | 安全 | ConfigStore.patch 新 Provider apiKey 泄漏 | stripSecretsApiKeys 对不存在于原始配置的 Provider 也清空 apiKey |
| S-2  | 安全 | 用户消息前 50 字符写入日志                | 改为仅记录 sessionId + message.length                           |
| S-3  | 安全 | ipcRenderer 暴露任意 channel              | 用白名单包装 invoke，仅允许预定义 channel                       |
| R-2  | 韧性 | Pipeline 执行错误被 .catch 吞掉           | 在 catch 中 emit run:error 到 EventBus                          |
| R-3  | 韧性 | 配置写入非原子                            | 先写 .tmp 再 rename（POSIX 原子）                               |
| R-4  | 韧性 | Runtime throw 前未 yield run:error        | 在 recovery.action === 'throw' 前 yield error                   |
| PF-3 | 性能 | StreamMonitor.sessionStats 无清理         | stream:end/error 时 delete sessionId                            |
| Q-1  | 质量 | WindowManager 1696 行                     | 拆分为 TabManager、WindowState 等子模块                         |
| Q-2  | 质量 | stream 方法错误处理不一致                 | 统一改为 throw GatewayMethodError                               |

---

## 三、P2 问题（5个）

| ID   | 问题                                 | 备注                            |
| ---- | ------------------------------------ | ------------------------------- |
| R-5  | 所有 Provider 禁用时无校验           | 可在 applyProviderConfig 中检查 |
| Q-3  | Provider types 与 Config schema 重复 | 长期用 z.infer 派生             |
| Q-4  | 约 30 处 as any                      | 逐步替换                        |
| PF-4 | 热重载路径全同步                     | 改为 fs.promises + 异步管线     |
| PF-5 | StreamEmitter sequence 用 Map        | 改为 this.sequence++            |

---

## 四、建议修复顺序

### 阶段 1: 安全+韧性关键修复

1. **R-1**: ConfigWatcher 无效配置不覆盖有效配置（代码改动极小，影响极大）
2. **R-2**: Pipeline 错误不再静默吞掉
3. **S-2**: 日志脱敏用户消息
4. **R-3**: 原子写入配置文件

### 阶段 2: 性能瓶颈

5. **PF-1**: SkillManager 缓存 + 增量更新
6. **PF-2**: search 工具改为异步
7. **PF-3**: StreamMonitor 清理

### 阶段 3: 工程质量

8. **Q-2**: stream 方法错误处理统一
9. **PF-5**: StreamEmitter sequence 简化
10. **S-1**: ConfigStore.patch apiKey 保护加固

---

## 五、趋势分析（9轮累计）

| 轮次  | 维度       | P0    | P1    | P2    | 特征                             |
| ----- | ---------- | ----- | ----- | ----- | -------------------------------- |
| 5     | 子系统     | 5     | 8     | 6     | 基础设施缺失                     |
| 6     | 子系统     | 2     | 5     | 4     | 内存泄漏、死代码                 |
| 7     | 子系统     | 1     | 4     | 3     | Abort 信号                       |
| 8     | 子系统     | 6     | 12    | 6     | 深层安全+一致性                  |
| **9** | **横切面** | **3** | **7** | **5** | **隐藏 Bug、性能瓶颈、工程债务** |

**趋势**：

- P0 数量 5→2→1→6→3，振荡中收敛
- 问题类型从"缺失功能"转向"隐藏 Bug"和"非功能性需求"（安全/性能/质量）
- 切换分析维度确实发现了大量之前纵向分析遗漏的问题
- R-1（无效配置覆盖有效配置）是本轮最有价值的发现，可能在生产中导致严重故障
