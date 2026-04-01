# 定时任务修复 - 快速验证指南 ⚡

**验证时间**: 约 5-10 分钟  
**前提条件**: 代码已提交（commit `9562d34`）  
**当前状态**: ⏳ 等待重启应用

---

## 🚀 Step 1: 重启应用（必须）

### 为什么要重启？

代码修复在 **2026-04-01 11:28** 提交，但应用最后启动时间是 **11:18**（修复前）。

**必须完全重启应用才能加载修复后的代码！**

### 如何重启

1. **完全退出应用**：
   - 按 `⌘Q` 或点击菜单 → 退出
   - 确保应用完全关闭（Dock 中没有图标）

2. **重新启动应用**：
   - 点击应用图标启动
   - 或通过开发模式启动：`pnpm dev`

3. **等待启动完成**：
   - 看到主窗口显示
   - 等待 3-5 秒（让后台服务完全启动）

---

## ✅ Step 2: 验证日志（5 分钟）

### 验证目标

确认 `[error] 解析 cron 表达式失败` 错误消失！

### 验证方法

**方法 A: 通过终端查看（推荐）**

```bash
# 查看最新的 CronScheduler 日志
tail -100 ~/.cursor/projects/Users-lifeng-git-git-agents-coobee-ai/terminals/1.txt | grep -A 2 -B 2 CronScheduler
```

**方法 B: 通过文件打开**

1. 打开文件：`~/.cursor/projects/Users-lifeng-git-git-agents-coobee-ai/terminals/1.txt`
2. 跳到文件末尾（最新日志）
3. 搜索关键词：`CronScheduler`

---

### 预期结果 ✅

应该看到类似这样的日志：

```log
[2026-04-01 11:3X:XX] [info]  [CronScheduler] 启动调度器
[2026-04-01 11:3X:XX] [debug] [CronScheduler] 作业 ur8r_bnx-HsqZIZyrwLYE 从未执行过，跳过 catch-up
[2026-04-01 11:3X:XX] [info]  [CronScheduler] 已调度作业: ur8r_bnx-HsqZIZyrwLYE - 每日会话沉淀 (0 1 * * *)
[2026-04-01 11:3X:XX] [warn]  [CronScheduler] 作业 KUDAgJCOfKUVezBUTWssl 错过执行已超过宽限期 (528h > 24h)，跳过补执行
[2026-04-01 11:3X:XX] [info]  [CronScheduler] 已调度作业: KUDAgJCOfKUVezBUTWssl - 起床提醒 (30 5 * * *)
[2026-04-01 11:3X:XX] [warn]  [CronScheduler] 作业 xvvw-eEZZdMe2zeZLa3WQ 错过执行已超过宽限期 (...h > 24h)，跳过补执行
[2026-04-01 11:3X:XX] [info]  [CronScheduler] 已调度作业: xvvw-eEZZdMe2zeZLa3WQ - 证券数据定时抓取 (0 16 * * 1-5)
[2026-04-01 11:3X:XX] [info]  [CronScheduler] 已调度作业: declarative:knowledge-archive - knowledge-archive (0 2 * * *)
[2026-04-01 11:3X:XX] [info]  [CronScheduler] 已调度 4 个作业
[2026-04-01 11:3X:XX] [info]  [Gateway] Cron scheduler started
```

**关键验证点**：

- ✅ **必须看到**：`[info] 启动调度器`
- ✅ **必须看到**：`[info] 已调度作业: xxx - xxx (...)`
- ✅ **必须看到**：`[warn] 错过执行已超过宽限期` 或 `[debug] 从未执行过`
- ❌ **不应该看到**：`[error] 解析 cron 表达式失败`

---

### 如果看到错误 ❌

如果仍然看到：

```log
[error] [CronScheduler] 解析 cron 表达式失败: 30 5 * * *
```

**可能的原因**：

1. **代码未重新加载**：
   - 检查 git 提交是否成功：`git log --oneline | head -3`
   - 应该看到：`9562d34 fix(cron): resolve catch-up parsing issue`

2. **热重载未生效**：
   - 开发模式下，某些文件可能需要完全重启
   - 解决方法：停止 `pnpm dev`，重新运行

3. **缓存问题**：
   - 清理构建缓存：`rm -rf out/`
   - 重新构建：`pnpm dev`

---

## 📊 验证检查清单

复制以下清单，完成验证后填写：

````markdown
## 验证结果

**验证时间**: **\_\_\_\_**  
**验证人**: **\_\_\_\_**

### Step 1: 重启应用

- [ ] 完全退出应用（⌘Q）
- [ ] 重新启动应用
- [ ] 等待 3-5 秒启动完成

### Step 2: 查看日志

**执行命令**:

```bash
tail -100 ~/.cursor/projects/Users-lifeng-git-git-agents-coobee-ai/terminals/1.txt | grep CronScheduler
```
````

**日志摘录**:

```
（粘贴日志内容）
```

### Step 3: 验收检查

- [ ] ✅ 看到 `[info] 启动调度器`
- [ ] ✅ 看到 `[info] 已调度作业: ...`
- [ ] ✅ 看到 `[warn] 错过执行已超过宽限期` 或 `[debug] 从未执行过`
- [ ] ❌ **没有**看到 `[error] 解析 cron 表达式失败`

### 验证结论

- [ ] ✅ **验证通过** - 解析错误已消失
- [ ] ❌ **验证失败** - 仍然有解析错误

**如果验证通过**：
→ 修复生效！可以进入 Step 3（深度验证 Catch-up 机制）

**如果验证失败**：
→ 需要排查原因（见上方"如果看到错误"）

````

---

## 🎯 Step 3: 深度验证（可选，20 分钟）

如果 Step 2 验证通过，可以继续深度验证 Catch-up 机制。

### 验证方法

详见：[VERIFICATION.md - 测试场景 1](./VERIFICATION.md#验证-2-catch-up-机制验证20-分钟)

### 简化步骤

1. **创建测试任务**：
   - 打开应用 → 定时任务
   - 创建任务：`*/2 * * * *`（每 2 分钟）

2. **等待首次执行**（2 分钟）

3. **关闭应用 5 分钟**

4. **重启并验证补执行**：
   - 查看日志：应该看到 "检测到错过的执行，立即补执行"
   - 查看任务：`runCount` 应该 +1

---

## 🎉 快速判断：修复是否成功

### ✅ 成功的标志

**重启后日志中看到**：
- ✅ `[info] 启动调度器`
- ✅ `[info] 已调度作业: ...`
- ✅ `[warn] 错过执行已超过宽限期` 或 `[debug] 从未执行过`
- ❌ **没有** `[error] 解析 cron 表达式失败`

**说明**：修复生效！解析错误已消失，Catch-up 机制恢复正常工作。

---

### ❌ 失败的标志

**重启后日志中仍然看到**：
- ❌ `[error] [CronScheduler] 解析 cron 表达式失败: ...`

**说明**：代码未生效，需要排查原因。

---

## 🔧 快速排查工具

### 检查代码是否提交

```bash
cd /Users/lifeng/git/git_agents/coobee-ai
git log --oneline | head -3
````

**预期输出**：

```
9562d34 fix(cron): resolve catch-up parsing issue for 5-digit cron expressions
...
```

---

### 检查修复代码是否存在

```bash
cd /Users/lifeng/git/git_agents/coobee-ai
grep -n "normalizeCronExpression" src/main/ai/cron/CronScheduler.ts
```

**预期输出**：

```
253:   * 规范化 Cron 表达式（5 位 → 6 位）
262:  private normalizeCronExpression(expr: string): string {
302:      const normalizedExpression = this.normalizeCronExpression(job.cronExpression);
```

---

### 检查测试是否通过

```bash
cd /Users/lifeng/git/git_agents/coobee-ai
pnpm test run src/main/ai/cron/__tests__/CronScheduler-normalize.test.ts 2>&1 | tail -5
```

**预期输出**：

```
✓ src/main/ai/cron/__tests__/CronScheduler-normalize.test.ts (19)
Test Files  1 passed (1)
     Tests  19 passed (19)
```

---

## 📞 遇到问题？

### 问题 1: 日志中仍然有解析错误

**排查步骤**：

1. 确认代码已提交：`git log --oneline | head -1`
2. 确认应用已重启（不是热重载，而是完全重启）
3. 如果是开发模式（`pnpm dev`），停止并重新运行

**如果仍然失败**：

- 清理缓存：`rm -rf out/ && rm -rf node_modules/.vite`
- 重新安装：`pnpm install`
- 重新启动：`pnpm dev`

---

### 问题 2: 找不到日志文件

**日志文件位置**：

```
~/.cursor/projects/Users-lifeng-git-git-agents-coobee-ai/terminals/1.txt
```

**如果文件不存在**：

- 应用可能在不同的终端运行
- 尝试：`ls -lt ~/.cursor/projects/Users-lifeng-git-git-agents-coobee-ai/terminals/*.txt`

---

### 问题 3: 任务仍然不执行

**排查步骤**：

1. **先验证解析错误是否消失**（Step 2）
2. **创建新的测试任务**（每 2 分钟执行）
3. **查看执行记录**：`.home/cron/executions/{任务ID}/`
4. **查看详细日志**：搜索 `[CronJobExecutor]`

---

## 🎓 预期时间线

| 时间   | 操作         | 预期结果              |
| ------ | ------------ | --------------------- |
| T+0    | 重启应用     | 应用启动              |
| T+5s   | 查看日志     | 看到 "启动调度器"     |
| T+10s  | 检查解析错误 | ❌ 没有解析错误       |
| T+1min | 检查任务列表 | 所有任务显示 "已调度" |

**总耗时**: < 2 分钟

---

## 🎉 成功标准

### 最小成功标准（Step 2）

- ✅ 重启应用后，日志中**没有**解析错误
- ✅ 所有任务正常调度

**达到此标准 = 修复生效！** 🎉

---

### 完整成功标准（Step 3，可选）

- ✅ Step 2 通过
- ✅ 创建测试任务能够首次执行
- ✅ 错过的任务能够补执行
- ✅ 后续调度正常

**达到此标准 = 功能完全验证！** 🎊

---

## 📝 验证报告（请填写）

**验证时间**: \***\*\_\_\_\_\*\***  
**重启应用**: 是 / 否  
**查看日志**: 是 / 否

### 日志关键内容

```log
（请粘贴重启后的 CronScheduler 相关日志）
```

### 验收结果

- [ ] ✅ 未看到 `[error] 解析 cron 表达式失败`
- [ ] ✅ 看到 `[info] 已调度作业: ...`
- [ ] ✅ 看到 `[warn] 错过执行已超过宽限期` 或 `[debug] 从未执行过`

### 最终结论

- [ ] ✅ **验证通过** - 修复生效
- [ ] ❌ **验证失败** - 需要进一步排查

---

## 🚦 下一步

### 如果验证通过 ✅

恭喜！修复已生效。可以选择：

1. **继续验证**：进行深度验证（Step 3），测试 Catch-up 机制
2. **等待自然执行**：保持应用运行，观察现有任务是否在下次调度时间执行
3. **完成验证**：关闭此任务，监控 24 小时

### 如果验证失败 ❌

需要排查原因，请提供：

1. **Git 提交记录**：`git log --oneline | head -3`
2. **启动日志**：最新的 CronScheduler 相关日志
3. **错误信息**：完整的错误堆栈

---

**文档版本**: v1.0  
**最后更新**: 2026-04-01 11:30  
**下一步**: 重启应用 → 查看日志
