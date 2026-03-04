---
name: gitea
description: Gitea 代码托管平台操作指南。通过 REST API 管理仓库、Issue 工单、Pull Request、标签、里程碑、Release 发布等。Use when: (1) creating/managing git repositories, (2) creating/updating issues or tickets, (3) managing pull requests and code review, (4) creating releases or tags, (5) managing labels and milestones. Triggers on: 创建仓库, 提交工单, 提Issue, 合并PR, 发布版本, create repo, create issue, merge PR, create release, Gitea.
---

# Gitea 代码托管平台操作

通过 Gitea REST API（v1）管理代码仓库、工单、PR、发布等。

## 服务信息

| 项目     | 值                              |
| -------- | ------------------------------- |
| 服务地址 | `http://localhost:13000`        |
| API 基址 | `http://localhost:13000/api/v1` |
| 版本     | Gitea 1.25.4                    |
| 默认用户 | `lifeng`                        |
| Web 界面 | `http://localhost:13000/lifeng` |

---

## 前提条件：认证配置

写操作（创建仓库、提交工单、合并 PR 等）需要 API Token 认证。

### 检查是否已有 Token

```bash
# 检查环境变量中是否已配置
echo $GITEA_TOKEN
```

### 创建 Token（首次使用）

1. 在浏览器中打开 `http://localhost:13000/user/settings/applications`
2. 在 "管理 Access Token" 部分：
   - Token 名称填写 `coobee-agent`
   - 权限选择 **全部**（或按需选择：issue、repo、package 等）
   - 点击 "生成令牌"
3. **复制生成的 Token**（只显示一次）
4. 配置到环境变量：

```bash
export GITEA_TOKEN="你复制的token值"
```

或通过 Basic Auth 创建（需要知道密码）：

```bash
curl -s -X POST 'http://localhost:13000/api/v1/users/lifeng/tokens' \
  -u 'lifeng:你的密码' \
  -H 'Content-Type: application/json' \
  -d '{"name":"coobee-agent","scopes":["all"]}'
```

或通过 Docker 容器内的 Gitea CLI 创建（本地 Docker 部署推荐）：

```bash
docker exec -u git gitea gitea admin user generate-access-token \
  -u lifeng -t coobee-agent --scopes all --raw
```

### 认证方式

后续所有写操作的 curl 命令都使用 Token 认证：

```bash
-H "Authorization: token $GITEA_TOKEN"
```

### 验证 Token 有效

```bash
curl -s -H "Authorization: token $GITEA_TOKEN" \
  'http://localhost:13000/api/v1/user' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('✓ 认证成功：', d.get('login', d.get('message','未知错误')))"
```

---

## 操作一览

| 操作         | 方法   | 端点                                               | 需认证 |
| ------------ | ------ | -------------------------------------------------- | ------ |
| 列出仓库     | GET    | `/api/v1/repos/search`                             | 否     |
| 创建仓库     | POST   | `/api/v1/user/repos`                               | 是     |
| 删除仓库     | DELETE | `/api/v1/repos/{owner}/{repo}`                     | 是     |
| 列出 Issue   | GET    | `/api/v1/repos/{owner}/{repo}/issues`              | 否     |
| 创建 Issue   | POST   | `/api/v1/repos/{owner}/{repo}/issues`              | 是     |
| 更新 Issue   | PATCH  | `/api/v1/repos/{owner}/{repo}/issues/{index}`      | 是     |
| 列出 PR      | GET    | `/api/v1/repos/{owner}/{repo}/pulls`               | 否     |
| 创建 PR      | POST   | `/api/v1/repos/{owner}/{repo}/pulls`               | 是     |
| 合并 PR      | POST   | `/api/v1/repos/{owner}/{repo}/pulls/{index}/merge` | 是     |
| 列出标签     | GET    | `/api/v1/repos/{owner}/{repo}/labels`              | 否     |
| 创建标签     | POST   | `/api/v1/repos/{owner}/{repo}/labels`              | 是     |
| 列出里程碑   | GET    | `/api/v1/repos/{owner}/{repo}/milestones`          | 否     |
| 创建里程碑   | POST   | `/api/v1/repos/{owner}/{repo}/milestones`          | 是     |
| 列出 Release | GET    | `/api/v1/repos/{owner}/{repo}/releases`            | 否     |
| 创建 Release | POST   | `/api/v1/repos/{owner}/{repo}/releases`            | 是     |
| 列出分支     | GET    | `/api/v1/repos/{owner}/{repo}/branches`            | 否     |
| 创建分支     | POST   | `/api/v1/repos/{owner}/{repo}/branches`            | 是     |

---

## 1. 仓库管理

### 1.1 列出所有仓库

```bash
curl -s 'http://localhost:13000/api/v1/repos/search?limit=50' \
  | python3 -c "
import sys,json
data = json.load(sys.stdin)
for r in data.get('data', []):
    private = '🔒' if r['private'] else '🌐'
    print(f\"{private} {r['full_name']:30s} {r.get('description','')}\")
"
```

### 1.2 查看仓库详情

```bash
curl -s 'http://localhost:13000/api/v1/repos/{owner}/{repo}' \
  | python3 -c "
import sys,json
r = json.load(sys.stdin)
print(f\"仓库: {r['full_name']}\")
print(f\"描述: {r.get('description','无')}\")
print(f\"默认分支: {r['default_branch']}\")
print(f\"Star: {r['stars_count']}  Fork: {r['forks_count']}  Issue: {r['open_issues_count']}\")
print(f\"创建时间: {r['created_at']}\")
"
```

### 1.3 创建仓库

```bash
curl -s -X POST 'http://localhost:13000/api/v1/user/repos' \
  -H "Authorization: token $GITEA_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "{repo_name}",
    "description": "{描述}",
    "private": false,
    "auto_init": true,
    "default_branch": "main",
    "readme": "Default"
  }' | python3 -c "
import sys,json
r = json.load(sys.stdin)
if 'full_name' in r:
    print(f\"✓ 仓库已创建: {r['full_name']}\")
    print(f\"  地址: {r['html_url']}\")
    print(f\"  Clone: {r['clone_url']}\")
else:
    print(f\"✗ 创建失败: {r.get('message','未知错误')}\")
"
```

**参数说明**：

- `name`（必填）：仓库名称，只允许字母、数字、`-`、`_`、`.`
- `description`：仓库描述
- `private`：`true` 为私有仓库，`false` 为公开仓库
- `auto_init`：`true` 自动初始化（创建 README），`false` 创建空仓库
- `default_branch`：默认分支名，一般用 `main`

### 1.4 删除仓库

```bash
curl -s -X DELETE "http://localhost:13000/api/v1/repos/{owner}/{repo}" \
  -H "Authorization: token $GITEA_TOKEN" \
  -w "HTTP %{http_code}" \
  | python3 -c "
import sys
body = sys.stdin.read()
if 'HTTP 204' in body:
    print('✓ 仓库已删除')
else:
    print(f'✗ 删除失败: {body}')
"
```

> ⚠️ **危险操作**：删除仓库不可恢复，执行前必须向用户确认。

---

## 2. Issue（工单）管理

### 2.1 列出 Issue

```bash
curl -s 'http://localhost:13000/api/v1/repos/{owner}/{repo}/issues?state=open&limit=20&type=issues' \
  | python3 -c "
import sys,json
data = json.load(sys.stdin)
if isinstance(data, dict) and 'message' in data:
    print(f\"查询失败: {data['message']}\")
elif not data:
    print('暂无 Issue')
else:
    for i in data:
        labels = ','.join(l['name'] for l in i.get('labels', []))
        assignee = i.get('assignee', {})
        who = assignee.get('login', '未分配') if assignee else '未分配'
        print(f\"#{i['number']:4d} [{i['state']:6s}] {i['title']:40s} 👤{who} 🏷️{labels}\")
"
```

**查询参数**：

- `state`：`open`（默认）、`closed`、`all`
- `type`：`issues`（仅工单）、`pulls`（仅 PR）
- `labels`：按标签过滤（逗号分隔的标签 ID）
- `milestone`：按里程碑过滤（里程碑名称）
- `limit`：每页数量（默认 50）
- `page`：页码（从 1 开始）

### 2.2 创建 Issue

```bash
curl -s -X POST 'http://localhost:13000/api/v1/repos/{owner}/{repo}/issues' \
  -H "Authorization: token $GITEA_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "{标题}",
    "body": "{详细描述，支持 Markdown}",
    "labels": [],
    "milestone": 0,
    "assignees": ["{用户名}"]
  }' | python3 -c "
import sys,json
i = json.load(sys.stdin)
if 'number' in i:
    print(f\"✓ Issue 已创建: #{i['number']} {i['title']}\")
    print(f\"  链接: {i['html_url']}\")
else:
    print(f\"✗ 创建失败: {i.get('message','未知错误')}\")
"
```

**参数说明**：

- `title`（必填）：工单标题
- `body`：工单内容，支持 Markdown 格式
- `labels`：标签 ID 数组（先通过列出标签获取 ID）
- `milestone`：里程碑 ID（0 表示无里程碑）
- `assignees`：指派人用户名数组

### 2.3 更新 Issue

```bash
curl -s -X PATCH 'http://localhost:13000/api/v1/repos/{owner}/{repo}/issues/{index}' \
  -H "Authorization: token $GITEA_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "{新标题}",
    "body": "{新描述}",
    "state": "open"
  }' | python3 -c "
import sys,json
i = json.load(sys.stdin)
if 'number' in i:
    print(f\"✓ Issue #{i['number']} 已更新: {i['title']} [{i['state']}]\")
else:
    print(f\"✗ 更新失败: {i.get('message','未知错误')}\")
"
```

**可更新字段**（只传需要修改的字段）：

- `title`：标题
- `body`：内容
- `state`：`open` 或 `closed`
- `assignees`：指派人数组
- `milestone`：里程碑 ID

### 2.4 为 Issue 添加评论

```bash
curl -s -X POST 'http://localhost:13000/api/v1/repos/{owner}/{repo}/issues/{index}/comments' \
  -H "Authorization: token $GITEA_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "body": "{评论内容，支持 Markdown}"
  }' | python3 -c "
import sys,json
c = json.load(sys.stdin)
if 'id' in c:
    print(f\"✓ 评论已添加 (ID: {c['id']})\")
else:
    print(f\"✗ 评论失败: {c.get('message','未知错误')}\")
"
```

### 2.5 关闭 Issue

```bash
curl -s -X PATCH 'http://localhost:13000/api/v1/repos/{owner}/{repo}/issues/{index}' \
  -H "Authorization: token $GITEA_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"state": "closed"}' \
  | python3 -c "
import sys,json
i = json.load(sys.stdin)
if i.get('state') == 'closed':
    print(f\"✓ Issue #{i['number']} 已关闭\")
else:
    print(f\"✗ 关闭失败: {i.get('message','未知错误')}\")
"
```

---

## 3. Pull Request 管理

### 3.1 列出 PR

```bash
curl -s 'http://localhost:13000/api/v1/repos/{owner}/{repo}/pulls?state=open&limit=20' \
  | python3 -c "
import sys,json
data = json.load(sys.stdin)
if isinstance(data, dict) and 'message' in data:
    print(f\"暂无 Pull Request（{data['message']}）\")
elif not data:
    print('暂无 Pull Request')
else:
    for p in data:
        print(f\"#{p['number']:4d} [{p['state']:6s}] {p['title']:40s} {p['head']['label']} → {p['base']['label']}\")
"
```

### 3.2 创建 PR

```bash
curl -s -X POST 'http://localhost:13000/api/v1/repos/{owner}/{repo}/pulls' \
  -H "Authorization: token $GITEA_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "{PR 标题}",
    "body": "{PR 描述，支持 Markdown}",
    "head": "{源分支名}",
    "base": "{目标分支名，通常是 main}",
    "assignees": ["{审阅人用户名}"],
    "labels": []
  }' | python3 -c "
import sys,json
p = json.load(sys.stdin)
if 'number' in p:
    print(f\"✓ PR 已创建: #{p['number']} {p['title']}\")
    print(f\"  {p['head']['label']} → {p['base']['label']}\")
    print(f\"  链接: {p['html_url']}\")
else:
    print(f\"✗ 创建失败: {p.get('message','未知错误')}\")
"
```

**参数说明**：

- `title`（必填）：PR 标题
- `body`：PR 描述
- `head`（必填）：源分支名称
- `base`（必填）：目标分支名称（通常是 `main`）
- `assignees`：审阅人用户名数组
- `labels`：标签 ID 数组

### 3.3 合并 PR

```bash
curl -s -X POST 'http://localhost:13000/api/v1/repos/{owner}/{repo}/pulls/{index}/merge' \
  -H "Authorization: token $GITEA_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "Do": "merge",
    "merge_message_field": "{合并提交信息}",
    "delete_branch_after_merge": true
  }' -w "\nHTTP %{http_code}" \
  | python3 -c "
import sys
body = sys.stdin.read()
if 'HTTP 200' in body:
    print('✓ PR 已合并')
elif 'HTTP 405' in body:
    print('✗ PR 无法合并（可能存在冲突或未通过检查）')
else:
    print(f'✗ 合并失败: {body}')
"
```

**`Do` 参数可选值**：

- `merge`：普通合并（创建合并提交）
- `rebase`：变基合并
- `squash`：压缩合并（所有提交合为一个）

### 3.4 查看 PR 详情

```bash
curl -s 'http://localhost:13000/api/v1/repos/{owner}/{repo}/pulls/{index}' \
  | python3 -c "
import sys,json
p = json.load(sys.stdin)
print(f\"PR #{p['number']}: {p['title']}\")
print(f\"状态: {p['state']}  可合并: {p.get('mergeable', '未知')}\")
print(f\"分支: {p['head']['label']} → {p['base']['label']}\")
print(f\"描述: {p.get('body','无')[:200]}\")
"
```

---

## 4. 标签管理

### 4.1 列出标签

```bash
curl -s 'http://localhost:13000/api/v1/repos/{owner}/{repo}/labels' \
  | python3 -c "
import sys,json
labels = json.load(sys.stdin)
if not labels:
    print('暂无标签')
else:
    for l in labels:
        print(f\"  ID:{l['id']:4d}  {l['name']:20s}  色值:{l['color']}  {l.get('description','')}\")
"
```

### 4.2 创建标签

```bash
curl -s -X POST 'http://localhost:13000/api/v1/repos/{owner}/{repo}/labels' \
  -H "Authorization: token $GITEA_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "{标签名}",
    "color": "#ee0701",
    "description": "{标签描述}"
  }' | python3 -c "
import sys,json
l = json.load(sys.stdin)
if 'id' in l:
    print(f\"✓ 标签已创建: {l['name']} (ID: {l['id']})\")
else:
    print(f\"✗ 创建失败: {l.get('message','未知错误')}\")
"
```

**常用标签颜色参考**：

- Bug: `#ee0701`（红）
- Feature: `#0075ca`（蓝）
- Enhancement: `#a2eeef`（青）
- Documentation: `#0075ca`（蓝）
- Priority-High: `#d93f0b`（橙红）
- Priority-Low: `#c5def5`（浅蓝）

### 4.3 批量初始化标签

一次性创建项目常用标签：

```bash
for label_data in \
  '{"name":"bug","color":"#ee0701","description":"Something is broken"}' \
  '{"name":"feature","color":"#0075ca","description":"New feature request"}' \
  '{"name":"enhancement","color":"#a2eeef","description":"Improvement to existing feature"}' \
  '{"name":"documentation","color":"#0075ca","description":"Documentation update"}' \
  '{"name":"priority:high","color":"#d93f0b","description":"High priority"}' \
  '{"name":"priority:low","color":"#c5def5","description":"Low priority"}' \
  '{"name":"wontfix","color":"#ffffff","description":"Will not be fixed"}'; do
  curl -s -X POST "http://localhost:13000/api/v1/repos/{owner}/{repo}/labels" \
    -H "Authorization: token $GITEA_TOKEN" \
    -H 'Content-Type: application/json' \
    -d "$label_data" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"  {'✓' if 'id' in d else '✗'} {d.get('name', d.get('message',''))}\")"
done
```

---

## 5. 里程碑管理

### 5.1 列出里程碑

```bash
curl -s 'http://localhost:13000/api/v1/repos/{owner}/{repo}/milestones?state=open' \
  | python3 -c "
import sys,json
ms = json.load(sys.stdin)
if not ms:
    print('暂无里程碑')
else:
    for m in ms:
        due = m.get('due_on', '无截止日期')[:10] if m.get('due_on') else '无截止日期'
        print(f\"  ID:{m['id']:4d}  {m['title']:20s}  截止:{due}  open:{m['open_issues']}/closed:{m['closed_issues']}\")
"
```

### 5.2 创建里程碑

```bash
curl -s -X POST 'http://localhost:13000/api/v1/repos/{owner}/{repo}/milestones' \
  -H "Authorization: token $GITEA_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "{里程碑名称}",
    "description": "{描述}",
    "due_on": "2026-04-01T00:00:00Z"
  }' | python3 -c "
import sys,json
m = json.load(sys.stdin)
if 'id' in m:
    print(f\"✓ 里程碑已创建: {m['title']} (ID: {m['id']})\")
else:
    print(f\"✗ 创建失败: {m.get('message','未知错误')}\")
"
```

**参数说明**：

- `title`（必填）：里程碑名称
- `description`：描述
- `due_on`：截止日期，ISO 8601 格式（如 `2026-04-01T00:00:00Z`），可省略

---

## 6. Release 发布管理

### 6.1 列出 Release

```bash
curl -s 'http://localhost:13000/api/v1/repos/{owner}/{repo}/releases?limit=10' \
  | python3 -c "
import sys,json
releases = json.load(sys.stdin)
if not releases:
    print('暂无 Release')
else:
    for r in releases:
        pre = '⚠️预发布' if r['prerelease'] else '✅正式版'
        print(f\"  {r['tag_name']:15s} {r['name']:30s} {pre}  {r['published_at'][:10]}\")
"
```

### 6.2 创建 Release

```bash
curl -s -X POST 'http://localhost:13000/api/v1/repos/{owner}/{repo}/releases' \
  -H "Authorization: token $GITEA_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "tag_name": "{版本号，如 v1.0.0}",
    "target_commitish": "main",
    "name": "{发布标题}",
    "body": "{发布说明，支持 Markdown}",
    "draft": false,
    "prerelease": false
  }' | python3 -c "
import sys,json
r = json.load(sys.stdin)
if 'id' in r:
    print(f\"✓ Release 已创建: {r['tag_name']} - {r['name']}\")
    print(f\"  链接: {r['html_url']}\")
else:
    print(f\"✗ 创建失败: {r.get('message','未知错误')}\")
"
```

**参数说明**：

- `tag_name`（必填）：Git Tag 名称，如 `v1.0.0`
- `target_commitish`：基于哪个分支或 commit 创建 Tag（默认仓库默认分支）
- `name`：发布标题
- `body`：发布说明（Changelog）
- `draft`：`true` 为草稿（不公开）
- `prerelease`：`true` 为预发布版本

### 6.3 上传 Release 附件

```bash
curl -s -X POST "http://localhost:13000/api/v1/repos/{owner}/{repo}/releases/{release_id}/assets?name={文件名}" \
  -H "Authorization: token $GITEA_TOKEN" \
  -H 'Content-Type: application/octet-stream' \
  --data-binary "@{本地文件路径}" \
  | python3 -c "
import sys,json
a = json.load(sys.stdin)
if 'id' in a:
    print(f\"✓ 附件已上传: {a['name']} ({a['size']} bytes)\")
    print(f\"  下载: {a['browser_download_url']}\")
else:
    print(f\"✗ 上传失败: {a.get('message','未知错误')}\")
"
```

---

## 7. 分支管理

### 7.1 列出分支

```bash
curl -s 'http://localhost:13000/api/v1/repos/{owner}/{repo}/branches' \
  | python3 -c "
import sys,json
data = json.load(sys.stdin)
if not data or not isinstance(data, list):
    msg = data.get('message','') if isinstance(data, dict) else ''
    print(f\"暂无分支（仓库可能为空）{msg}\")
else:
    for b in data:
        protected = '🔒' if b.get('protected') else '  '
        commit_msg = b['commit']['message'].split('\n')[0][:50] if b.get('commit') else ''
        print(f\"  {protected} {b['name']:30s} {commit_msg}\")
"
```

### 7.2 创建分支

```bash
curl -s -X POST 'http://localhost:13000/api/v1/repos/{owner}/{repo}/branches' \
  -H "Authorization: token $GITEA_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "new_branch_name": "{新分支名}",
    "old_branch_name": "main"
  }' | python3 -c "
import sys,json
b = json.load(sys.stdin)
if 'name' in b:
    print(f\"✓ 分支已创建: {b['name']}\")
else:
    print(f\"✗ 创建失败: {b.get('message','未知错误')}\")
"
```

### 7.3 删除分支

```bash
curl -s -X DELETE "http://localhost:13000/api/v1/repos/{owner}/{repo}/branches/{分支名}" \
  -H "Authorization: token $GITEA_TOKEN" \
  -w "HTTP %{http_code}" \
  | python3 -c "
import sys
body = sys.stdin.read()
if 'HTTP 204' in body:
    print('✓ 分支已删除')
else:
    print(f'✗ 删除失败: {body}')
"
```

---

## 8. 文件操作（通过 API）

### 8.1 获取文件内容

```bash
curl -s 'http://localhost:13000/api/v1/repos/{owner}/{repo}/contents/{文件路径}?ref=main' \
  | python3 -c "
import sys,json,base64
f = json.load(sys.stdin)
if 'content' in f:
    content = base64.b64decode(f['content']).decode('utf-8')
    print(content)
else:
    print(f\"✗ 获取失败: {f.get('message','未知错误')}\")
"
```

### 8.2 创建或更新文件

```bash
curl -s -X POST 'http://localhost:13000/api/v1/repos/{owner}/{repo}/contents/{文件路径}' \
  -H "Authorization: token $GITEA_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{
    \"content\": \"$(echo -n '{文件内容}' | base64)\",
    \"message\": \"{提交信息}\",
    \"branch\": \"main\"
  }" | python3 -c "
import sys,json
r = json.load(sys.stdin)
if 'content' in r:
    print(f\"✓ 文件已创建/更新: {r['content']['path']}\")
else:
    print(f\"✗ 操作失败: {r.get('message','未知错误')}\")
"
```

> 更新已有文件时需额外传 `sha` 字段（通过 8.1 获取文件时返回的 `sha` 值）。

---

## 9. 用户与组织

### 9.1 查看当前用户信息

```bash
curl -s -H "Authorization: token $GITEA_TOKEN" \
  'http://localhost:13000/api/v1/user' \
  | python3 -c "
import sys,json
u = json.load(sys.stdin)
print(f\"用户: {u['login']}\")
print(f\"邮箱: {u.get('email','未设置')}\")
print(f\"管理员: {'是' if u.get('is_admin') else '否'}\")
"
```

### 9.2 列出组织

```bash
curl -s -H "Authorization: token $GITEA_TOKEN" \
  'http://localhost:13000/api/v1/user/orgs' \
  | python3 -c "
import sys,json
orgs = json.load(sys.stdin)
if not orgs:
    print('暂无组织')
else:
    for o in orgs:
        print(f\"  {o['username']:20s} {o.get('description','')}\")
"
```

---

## 10. 健康检查与版本

### 10.1 检查 Gitea 是否可用

```bash
curl -s 'http://localhost:13000/api/v1/version' \
  | python3 -c "
import sys,json
d = json.load(sys.stdin)
print(f\"✓ Gitea 运行中，版本: {d['version']}\")
"
```

---

## 注意事项

1. **占位符替换**：使用时将 `{owner}` 替换为仓库所有者（如 `lifeng`），`{repo}` 替换为仓库名（如 `coobee-ai`），`{index}` 替换为 Issue/PR 编号
2. **Token 安全**：不要将 Token 硬编码在命令中，始终通过 `$GITEA_TOKEN` 环境变量引用
3. **危险操作**：删除仓库、删除分支等不可逆操作执行前必须向用户确认
4. **分页**：列表接口支持 `page` 和 `limit` 参数，`limit` 最大 50
5. **错误处理**：所有命令都包含输出解析，会显示成功或失败信息。如果返回 `token is required`，说明需要配置认证
6. **URL 编码**：如果仓库名或路径包含特殊字符，需要 URL 编码

## 常见工作流

### 创建 Issue 并跟踪

1. 创建标签（如果尚未创建）→ 操作 4.2
2. 创建里程碑（如果需要）→ 操作 5.2
3. 创建 Issue，关联标签和里程碑 → 操作 2.2
4. Issue 完成后关闭 → 操作 2.5

### 代码审查与合并

1. 创建功能分支 → 操作 7.2
2. 推送代码到功能分支（通过 git push）
3. 创建 PR → 操作 3.2
4. 审查通过后合并 PR → 操作 3.3

### 版本发布

1. 确保所有 Issue/PR 已关闭
2. 创建 Release → 操作 6.2
3. 上传构建产物 → 操作 6.3
