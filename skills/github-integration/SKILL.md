---
name: GitHub 集成操作
description: 与 GitHub 交互的技能包，支持 PR 审查、Issue 管理、代码提交等操作
version: 1.0.0
author: coobee-ai
tags: [github, integration, git, automation]
---

# GitHub 集成操作技能

## 概述

本技能包提供与 GitHub 交互的能力，包括：

- 获取 PR 详情和文件变更
- 在 PR 上发表评论和 Review
- 获取 CI/CD 状态
- 读取和更新文件内容

**注意**：本技能需要在 `coobee.json5` 中配置 GitHub Token。

## 配置

在 `coobee.json5` 中添加：

```json5
{
  integrations: {
    github: {
      token: 'ghp_your_token_here',
      webhookSecret: 'optional_webhook_secret',
      autoReview: {
        enabled: true,
        trigger: '@coobee review'
      },
      autoFixCI: {
        enabled: false,
        maxAttempts: 3
      }
    }
  }
}
```

## 可用操作

### 1. 获取 PR 详情

获取指定 Pull Request 的完整信息。

**用法示例**：

```
获取 PR coobee/coobee-ai#123 的详情
```

**内部实现**（Agent 自动调用）：

```python
python3 ~/.coobee-ai/skills/github-integration/scripts/pr_info.py \
  --owner coobee \
  --repo coobee-ai \
  --number 123
```

### 2. 获取 PR 文件变更

获取 PR 中修改的文件列表和 diff。

**用法示例**：

```
列出 PR coobee/coobee-ai#123 修改的文件
```

**内部实现**：

```python
python3 ~/.coobee-ai/skills/github-integration/scripts/pr_files.py \
  --owner coobee \
  --repo coobee-ai \
  --number 123
```

### 3. 发表 PR 评论

在 PR 上发表普通评论。

**用法示例**：

```
在 PR coobee/coobee-ai#123 上评论："代码看起来不错，但建议增加单元测试"
```

**内部实现**：

```python
python3 ~/.coobee-ai/skills/github-integration/scripts/pr_comment.py \
  --owner coobee \
  --repo coobee-ai \
  --number 123 \
  --message "代码看起来不错，但建议增加单元测试"
```

### 4. 发表 PR Review

发表带有审查状态的 Review（APPROVE / REQUEST_CHANGES / COMMENT）。

**用法示例**：

```
批准 PR coobee/coobee-ai#123，评论："LGTM，代码质量良好"
```

**内部实现**：

```python
python3 ~/.coobee-ai/skills/github-integration/scripts/pr_review.py \
  --owner coobee \
  --repo coobee-ai \
  --number 123 \
  --event APPROVE \
  --body "LGTM，代码质量良好"
```

### 5. 获取 CI 状态

获取指定 commit 的 CI/CD 检查状态。

**用法示例**：

```
检查 PR coobee/coobee-ai#123 的 CI 状态
```

**内部实现**：

```python
python3 ~/.coobee-ai/skills/github-integration/scripts/check_runs.py \
  --owner coobee \
  --repo coobee-ai \
  --ref <commit_sha>
```

## Webhook 集成

coobee-ai 提供 GitHub Webhook 端点：`POST /webhooks/github`

### 配置步骤

1. 在 GitHub 仓库设置中添加 Webhook
2. URL: `http://your-server:port/webhooks/github`
3. Content type: `application/json`
4. Secret: 与 `coobee.json5` 中的 `webhookSecret` 一致
5. 勾选需要的事件：
   - Issue comments
   - Pull requests
   - Check runs

### 自动触发功能

#### PR 审查

在 PR 评论中提及 `@coobee review`，系统会自动创建 PR 审查任务。

#### 自动修复 CI

（实验性功能）当 CI 失败时，系统可以自动分析失败原因并尝试修复。

## 使用示例

### 场景 1：手动审查 PR

```
帮我审查 PR coobeea/coobee-ai#456，重点关注安全性和性能
```

Agent 会：

1. 获取 PR 详情和文件变更
2. 分析代码质量
3. 生成审查意见
4. 在 PR 上发表 Review

### 场景 2：自动 PR 审查（Webhook 触发）

用户在 PR 评论中输入：`@coobee review`

系统会：

1. 接收 Webhook 事件
2. 创建酒馆任务
3. TaskScheduler 自动执行审查
4. 在 PR 上发表审查结果

## 限制与注意事项

- 需要有效的 GitHub Token（需要 `repo` 权限）
- API 有速率限制（个人 Token：5000 次/小时）
- Webhook Secret 必须配置以确保安全性
- 私有仓库需要确保 Token 有访问权限

## 故障排查

### Token 无效

```
错误: GitHub API error (401): Bad credentials
解决: 检查 coobee.json5 中的 token 是否正确
```

### Webhook 签名验证失败

```
错误: Invalid signature
解决: 确保 webhookSecret 与 GitHub 配置一致
```

### API 速率限制

```
错误: API rate limit exceeded
解决: 等待限制重置或升级到 GitHub App 认证
```

## 扩展

本技能包可扩展支持：

- GitHub Actions 触发
- Release 自动发布
- Issues 自动分类
- PR 自动合并（需谨慎使用）

## 参考

- [GitHub REST API 文档](https://docs.github.com/en/rest)
- [GitHub Webhooks 文档](https://docs.github.com/en/webhooks)
