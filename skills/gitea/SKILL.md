---
name: gitea
description: Gitea 代码托管平台操作指南。通过 Python 脚本（零依赖，跨平台）管理仓库、Issue 工单、Pull Request、标签、里程碑、Release 发布等。Use when: (1) creating/managing git repositories, (2) creating/updating issues or tickets, (3) managing pull requests and code review, (4) creating releases or tags, (5) managing labels and milestones. Triggers on: 创建仓库, 提交工单, 提Issue, 合并PR, 发布版本, create repo, create issue, merge PR, create release, Gitea.
config:
  - key: url
    description: Gitea 服务地址
    required: true
    default: http://localhost:13000
  - key: token
    description: Gitea API Access Token（在 Web 界面 → 设置 → 应用 中生成）
    required: true
  - key: owner
    description: 默认仓库所有者用户名
    required: false
---

# Gitea 代码托管平台操作

通过跨平台 Python 脚本管理 Gitea 仓库、工单、PR、发布等。所有脚本仅使用 Python 标准库（`urllib`），**无需安装任何第三方依赖**，macOS / Linux / Windows 均可运行。

## 服务信息

| 项目     | 值                         |
| -------- | -------------------------- |
| 服务地址 | 由 `skills.json5` 配置决定 |
| API 基址 | `{url}/api/v1`             |
| 脚本目录 | `skills/gitea/scripts/`    |
| 认证方式 | Access Token               |

---

## 前提条件：配置认证

脚本自动从 `.home/secrets/skills.json5` 读取配置，无需手动设置环境变量。

### 配置方法

在 `.home/secrets/skills.json5` 中添加 `gitea` 配置段：

```json5
{
  gitea: {
    url: 'http://localhost:13000',
    token: '你的 Access Token',
    owner: 'lifeng'
  }
}
```

### 获取 Token

1. 打开 Gitea Web 界面 → 右上角头像 → **设置** → **应用**
2. 在 "管理 Access Token" 处输入名称（如 `coobee-agent`），权限选 **全部**
3. 点击 "生成令牌"，复制 Token 填入上面的配置

如果 Gitea 运行在 Docker 中，也可以通过命令创建：

```
exec({ command: "docker exec -u git gitea gitea admin user generate-access-token -u lifeng -t coobee-agent --scopes all --raw" })
```

### 验证配置

```
exec({ command: "python3 skills/gitea/scripts/check.py" })
```

---

## 脚本一览

所有脚本位于 `skills/gitea/scripts/` 目录，通过 `python3 skills/gitea/scripts/<脚本>.py <子命令> [参数]` 调用。

| 脚本           | 子命令                                            | 说明           |
| -------------- | ------------------------------------------------- | -------------- |
| `check.py`     | （无）                                            | 环境检查       |
| `repo.py`      | `list` `info` `create` `delete`                   | 仓库管理       |
| `issue.py`     | `list` `create` `update` `comment` `close` `view` | Issue 工单管理 |
| `pr.py`        | `list` `create` `view` `merge`                    | Pull Request   |
| `label.py`     | `list` `create` `init`                            | 标签管理       |
| `milestone.py` | `list` `create`                                   | 里程碑管理     |
| `release.py`   | `list` `create` `upload`                          | Release 发布   |
| `branch.py`    | `list` `create` `delete`                          | 分支管理       |
| `file_ops.py`  | `get` `put`                                       | 文件读写       |

每个脚本都支持 `--help` 查看完整参数说明。

---

## 1. 环境检查

```
exec({ command: "python3 skills/gitea/scripts/check.py" })
```

检查内容：服务连通性、Token 认证、仓库列表、配置摘要。

---

## 2. 仓库管理

### 列出所有仓库

```
exec({ command: "python3 skills/gitea/scripts/repo.py list" })
```

### 查看仓库详情

```
exec({ command: "python3 skills/gitea/scripts/repo.py info {owner} {repo}" })
```

### 创建仓库

```
exec({ command: "python3 skills/gitea/scripts/repo.py create {name} --desc '仓库描述'" })
```

参数说明：

- `{name}`（必填）：仓库名称
- `--desc`：仓库描述
- `--private`：加此标志创建私有仓库

### 删除仓库

```
exec({ command: "python3 skills/gitea/scripts/repo.py delete {owner} {repo}" })
```

> ⚠️ **危险操作**：删除仓库不可恢复，执行前必须向用户确认。

---

## 3. Issue（工单）管理

### 列出 Issue

```
exec({ command: "python3 skills/gitea/scripts/issue.py list {owner} {repo}" })
```

可选参数：`--state open|closed|all`，`--limit 20`

### 创建 Issue

```
exec({ command: "python3 skills/gitea/scripts/issue.py create {owner} {repo} --title '标题' --body '详细描述（Markdown）'" })
```

可选参数：

- `--labels 1,2`：标签 ID（逗号分隔）
- `--assignees user1,user2`：指派人
- `--milestone 1`：里程碑 ID

### 更新 Issue

```
exec({ command: "python3 skills/gitea/scripts/issue.py update {owner} {repo} {index} --title '新标题' --state closed" })
```

只传需要修改的字段：`--title`、`--body`、`--state open|closed`

### 添加评论

```
exec({ command: "python3 skills/gitea/scripts/issue.py comment {owner} {repo} {index} --body '评论内容'" })
```

### 关闭 Issue

```
exec({ command: "python3 skills/gitea/scripts/issue.py close {owner} {repo} {index}" })
```

### 查看 Issue 详情

```
exec({ command: "python3 skills/gitea/scripts/issue.py view {owner} {repo} {index}" })
```

---

## 4. Pull Request 管理

### 列出 PR

```
exec({ command: "python3 skills/gitea/scripts/pr.py list {owner} {repo}" })
```

可选参数：`--state open|closed|all`

### 创建 PR

```
exec({ command: "python3 skills/gitea/scripts/pr.py create {owner} {repo} --title 'PR标题' --head '源分支' --base 'main' --body '描述'" })
```

可选参数：`--assignees user1`、`--labels 1,2`

### 查看 PR 详情

```
exec({ command: "python3 skills/gitea/scripts/pr.py view {owner} {repo} {index}" })
```

### 合并 PR

```
exec({ command: "python3 skills/gitea/scripts/pr.py merge {owner} {repo} {index} --method merge --delete-branch" })
```

`--method` 可选值：

- `merge`：普通合并（创建合并提交）
- `rebase`：变基合并
- `squash`：压缩合并

---

## 5. 标签管理

### 列出标签

```
exec({ command: "python3 skills/gitea/scripts/label.py list {owner} {repo}" })
```

### 创建标签

```
exec({ command: "python3 skills/gitea/scripts/label.py create {owner} {repo} --name 'bug' --color '#ee0701' --desc 'Something is broken'" })
```

常用颜色：Bug `#ee0701`、Feature `#0075ca`、Enhancement `#a2eeef`、Priority-High `#d93f0b`

### 批量初始化常用标签

```
exec({ command: "python3 skills/gitea/scripts/label.py init {owner} {repo}" })
```

自动创建：bug、feature、enhancement、documentation、priority:high、priority:low、wontfix。

---

## 6. 里程碑管理

### 列出里程碑

```
exec({ command: "python3 skills/gitea/scripts/milestone.py list {owner} {repo}" })
```

### 创建里程碑

```
exec({ command: "python3 skills/gitea/scripts/milestone.py create {owner} {repo} --title 'v1.0.0' --desc '第一个正式版本' --due '2026-04-01'" })
```

---

## 7. Release 发布管理

### 列出 Release

```
exec({ command: "python3 skills/gitea/scripts/release.py list {owner} {repo}" })
```

### 创建 Release

```
exec({ command: "python3 skills/gitea/scripts/release.py create {owner} {repo} --tag 'v1.0.0' --name '正式发布' --body '## Changelog\n\n- 初始版本'" })
```

可选参数：`--target main`、`--prerelease`、`--draft`

### 上传 Release 附件

```
exec({ command: "python3 skills/gitea/scripts/release.py upload {owner} {repo} {release_id} --file 'path/to/build.zip'" })
```

---

## 8. 分支管理

### 列出分支

```
exec({ command: "python3 skills/gitea/scripts/branch.py list {owner} {repo}" })
```

### 创建分支

```
exec({ command: "python3 skills/gitea/scripts/branch.py create {owner} {repo} --name 'feature/xxx' --from main" })
```

### 删除分支

```
exec({ command: "python3 skills/gitea/scripts/branch.py delete {owner} {repo} {branch_name}" })
```

---

## 9. 文件操作

### 获取文件内容

```
exec({ command: "python3 skills/gitea/scripts/file_ops.py get {owner} {repo} 'README.md' --ref main" })
```

### 创建或更新文件

```
exec({ command: "python3 skills/gitea/scripts/file_ops.py put {owner} {repo} 'docs/note.md' --content '# 文件内容' --message 'docs: add note' --branch main" })
```

> 更新已有文件时脚本会自动获取 sha 值，无需手动处理。

---

## 注意事项

1. **占位符替换**：使用时将 `{owner}` 替换为仓库所有者（如 `lifeng`），`{repo}` 替换为仓库名（如 `coobee-ai`），`{index}` 替换为 Issue/PR 编号
2. **Token 安全**：Token 存储在 `skills.json5`（secrets 目录），受 sensitive-paths 保护，不会被 Agent 的 read 工具读取
3. **危险操作**：删除仓库、删除分支等不可逆操作执行前**必须**向用户确认
4. **分页**：列表接口默认 limit=20，可通过 `--limit` 参数调整（最大 50）
5. **跨平台**：所有脚本使用 Python 标准库 `urllib`，无需安装任何第三方依赖，支持 macOS / Linux / Windows
6. **查看帮助**：任何脚本都可加 `--help` 查看完整用法

## 常见工作流

### 创建 Issue 并跟踪

1. 初始化标签（首次）：`label.py init {owner} {repo}`
2. 创建里程碑（如需要）：`milestone.py create ...`
3. 创建 Issue：`issue.py create {owner} {repo} --title ... --labels 1 --milestone 1`
4. 完成后关闭：`issue.py close {owner} {repo} {index}`

### 代码审查与合并

1. 创建分支：`branch.py create {owner} {repo} --name feature/xxx`
2. 推送代码（通过 git push）
3. 创建 PR：`pr.py create {owner} {repo} --title ... --head feature/xxx`
4. 合并 PR：`pr.py merge {owner} {repo} {index} --delete-branch`

### 版本发布

1. 确保所有 Issue/PR 已关闭
2. 创建 Release：`release.py create {owner} {repo} --tag v1.0.0 --name ...`
3. 上传构建产物：`release.py upload {owner} {repo} {release_id} --file build.zip`
