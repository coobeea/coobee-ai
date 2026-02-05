# Git Hooks 使用指南

## 📋 概述

项目已配置自动化的 Git hooks，在提交代码前自动执行代码质量检查。

---

## 🔧 已配置的 Hooks

### 1. **pre-commit** - 提交前检查

在每次 `git commit` 前自动执行：

1. **lint-staged** - 只检查暂存区（staged）的文件：
   - JavaScript/TypeScript: Prettier 格式化 + ESLint 检查
   - Vue 文件: Prettier 格式化 + ESLint 检查
   - JSON/Markdown/YAML: Prettier 格式化

2. **typecheck** - 完整的类型检查：
   - Node.js 代码（`tsconfig.node.json`）
   - Web/Renderer 代码（`tsconfig.web.json`）

### 2. **commit-msg** - 提交信息验证

验证 commit message 格式是否符合规范：

```
<type>(<scope>): <subject>
```

**允许的类型**：

- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档更新
- `style`: 代码格式（不影响功能）
- `refactor`: 重构
- `perf`: 性能优化
- `test`: 测试相关
- `build`: 构建系统
- `ci`: CI/CD 配置
- `chore`: 其他修改
- `types`: 类型定义
- `wip`: 进行中的工作
- `release`: 发布版本

**示例**：

```bash
feat(window): 添加窗口最小化功能
fix(tab): 修复标签页切换时的闪烁问题
docs(readme): 更新安装说明
refactor(eventbus): 优化事件分发逻辑
```

---

## 🚀 使用方式

### 正常提交流程

```bash
# 1. 添加文件到暂存区
git add .

# 2. 提交（会自动触发 hooks）
git commit -m "feat(hooks): 添加 git hooks 配置"

# pre-commit 自动执行：
#   ✓ 格式化暂存的代码
#   ✓ 运行 ESLint 检查
#   ✓ 类型检查

# commit-msg 自动执行：
#   ✓ 验证提交信息格式

# 3. 推送到远程
git push
```

### 跳过 Hooks（不推荐）

如果确实需要跳过检查（仅在紧急情况下使用）：

```bash
# 跳过 pre-commit 和 commit-msg
git commit --no-verify -m "wip: 临时提交"

# 或使用简写
git commit -n -m "wip: 临时提交"
```

---

## 🔍 Hooks 执行详情

### pre-commit 执行流程

脚本位置：`scripts/pre-commit.mjs`

```
1. 检测 pnpm 是否可用（支持 PATH 和 mise）
2. 运行 pnpm lint-staged
   - 对暂存的文件执行 prettier 和 eslint
   - 自动修复可修复的问题
3. 运行 pnpm typecheck
   - 检查 Node.js 代码类型
   - 检查 Renderer 代码类型
```

### commit-msg 执行流程

脚本位置：`scripts/verify-commit.js`

```
1. 读取 commit message
2. 使用正则验证格式
3. 如果不符合规范，显示错误并退出
```

---

## ⚙️ 配置文件

### package.json 配置

```json
{
  "simple-git-hooks": {
    "pre-commit": "node scripts/pre-commit.mjs",
    "commit-msg": "node scripts/verify-commit.js \"$1\""
  },
  "lint-staged": {
    "*.{js,mjs,cjs}": ["prettier --write", "eslint --cache --fix"],
    "*.ts": ["prettier --write", "eslint --cache --fix"],
    "*.vue": ["prettier --write", "eslint --cache --fix"],
    "*.{json,md,yml,yaml}": ["prettier --write"]
  }
}
```

---

## 🛠️ 常见问题

### Q1: Hooks 没有执行？

**解决方案**：重新安装 hooks

```bash
pnpm install
# 或手动安装
npx simple-git-hooks
```

### Q2: pnpm 命令找不到？

**错误信息**：

```
ERROR: pnpm not found.
```

**解决方案**：

- 确保 pnpm 在 PATH 中：`which pnpm`
- 或安装 mise：`curl https://mise.run | sh`

### Q3: 类型检查失败？

**解决方案**：

```bash
# 手动运行类型检查查看详细错误
pnpm typecheck

# 或分别检查
pnpm typecheck:node
pnpm typecheck:web
```

### Q4: ESLint 错误无法自动修复？

**解决方案**：

```bash
# 手动运行 ESLint 查看错误
pnpm lint

# 尝试自动修复
pnpm lint -- --fix
```

### Q5: 提交信息格式不知道怎么写？

**参考示例**：

```bash
# 新功能
git commit -m "feat(window): 添加窗口拖拽功能"

# Bug 修复
git commit -m "fix(eventbus): 修复事件监听器内存泄漏"

# 文档更新
git commit -m "docs(api): 更新 API 使用说明"

# 重构
git commit -m "refactor(store): 简化状态管理逻辑"

# 性能优化
git commit -m "perf(render): 优化大列表渲染性能"
```

---

## 📚 相关资源

- [Conventional Commits](https://www.conventionalcommits.org/)
- [simple-git-hooks](https://github.com/toplenboren/simple-git-hooks)
- [lint-staged](https://github.com/okonet/lint-staged)

---

## 🎯 最佳实践

1. **提交前自测**

   ```bash
   # 在提交前手动运行检查
   pnpm typecheck
   pnpm lint
   ```

2. **小步提交**
   - 每次提交只包含一个逻辑修改
   - 避免大批量混合修改

3. **清晰的提交信息**
   - 使用规范的格式
   - 描述修改的"为什么"而不只是"是什么"

4. **及时修复问题**
   - 不要跳过 hooks（除非紧急情况）
   - 遇到检查失败，及时修复后再提交
