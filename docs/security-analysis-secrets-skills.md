# secrets.json5 和 skills.json5 安全分析

## 文件概述

### secrets.json5

**位置**：`{configDir}/secrets.json5`

- 开发环境：`<项目>/.home/config/secrets.json5`
- 生产环境：`~/.coobee-ai/config/secrets.json5`

**内容**：Provider API Keys

```json5
{
  dashscope: 'sk-a6eab477152b4ed2af03b3de26a588dc',
  silicon: 'sk-xnngjclkrlotvdyoftgvkpbjqgsvcqmiidkbjbypkkwjgjpz',
  deepseek: 'sk-934f66074b1b46c6919a8996e47a4e71',
  minimax: 'sk-cp-rU6sUh4EugnLq_Q3-iIDbJ...'
  // ...
}
```

### skills.json5

**位置**：`{configDir}/skills.json5`

**内容**：Skill 专属配置（可能包含 API Key、Token 等）

```json5
{
  'paddle-ocr': {
    apiKey: 'sk-xxx',
    baseUrl: 'https://api.example.com'
  },
  'github-search': {
    token: 'ghp_xxx'
  }
}
```

---

## 现有保护机制

### ✅ 1. Git 版本控制隔离

**保护措施**：`.gitignore` 包含 `.home/` 目录

```gitignore
.home/
```

**效果**：

- ✅ secrets.json5 和 skills.json5 不会被 git 追踪
- ✅ 不会意外提交到远程仓库
- ✅ 每个开发者/用户拥有独立的密钥配置

**验证**：

```bash
$ git log --all --oneline -- .home/config/secrets.json5
# (无输出 - 文件从未被提交)
```

---

### ✅ 2. API Key 自动脱敏

#### 2.1 Gateway 返回配置时脱敏

**文件**：`src/main/gateway/methods/config.ts`

```typescript
function maskApiKeys(config: CoobeeConfig): CoobeeConfig {
  const cloned = structuredClone(config);
  const providers = cloned.models?.providers;
  if (!providers) return cloned;

  for (const provider of Object.values(providers)) {
    if (provider?.apiKey) {
      provider.apiKey = '****';
    }
  }
  return cloned;
}

// 前端调用 config.get 或 config.getAll 时自动脱敏
```

**效果**：

- ✅ 前端永远看不到真实 API Key
- ✅ 日志中不会泄露密钥
- ✅ 用户查看配置时只能看到 `****`

#### 2.2 ConfigStore 写入时还原占位符

**文件**：`src/main/common/config/ConfigStore.ts`

```typescript
private stripSecretsApiKeys(config: Record<string, unknown>): Record<string, unknown> {
  // 读取原始 coobee.json5 中的 apiKey（通常是 ${VAR} 模板）
  const original = this.readRawConfig();

  // 还原为原始占位符，防止真实 key 泄漏到 coobee.json5
  for (const [id, provider] of Object.entries(clonedProviders)) {
    if (originalProviders[id]) {
      provider.apiKey = originalProviders[id].apiKey; // 还原为 ${DASHSCOPE_API_KEY}
    } else {
      provider.apiKey = ''; // 新 Provider 清空，用户应放入 secrets.json5
    }
  }
}
```

**效果**：

- ✅ ConfigStore.patch() 写入时自动还原占位符
- ✅ secrets.json5 的真实 Key 不会泄漏到 coobee.json5
- ✅ coobee.json5 仍然可以安全提交到 git

#### 2.3 config-get.py 脚本脱敏

**文件**：`skills/config-manager/scripts/config-get.py`

```python
def mask_api_keys(obj):
    """递归脱敏 API Key"""
    result = {}
    for key, value in obj.items():
        if key == 'apiKey' and isinstance(value, str) and value:
            result[key] = '****'
        elif isinstance(value, (dict, list)):
            result[key] = mask_api_keys(value)
        else:
            result[key] = value
    return result
```

**效果**：

- ✅ Agent 通过 config-get.py 查看配置时，API Key 被脱敏
- ✅ 即使配置返回给 LLM，也不会泄露真实 Key

---

### ✅ 3. 沙箱路径限制

#### 3.1 Agent 工作空间隔离

**设计**：

- Agent 工作空间：`{userHome}/workspaces/{sessionId}/`
- 配置目录：`{userHome}/config/`
- **两者不在同一路径下**

**Agent 工作空间**：

```
.home/workspaces/283557218403819520/
├── sessions/     # Agent 持久化数据
├── contexts/     # LLM 调用快照
├── skills/       # Agent 自生成 Skill
├── output/       # 输出文件
└── tasks/        # 委托任务
```

**配置目录**（在工作空间之外）：

```
.home/config/
├── coobee.json5   # 主配置
├── secrets.json5  # API Keys
└── skills.json5   # Skill 配置
```

#### 3.2 写操作路径守卫

**文件**：`src/main/ai/sandbox/path-guard.ts`

```typescript
// 写操作：严格限制在 workspace 目录内
const root = context?.sandboxRoot || context?.workspaceRoot;

// 检查路径是否在边界内
const rel = relative(root, absolutePath);
if (rel.startsWith('..') || isAbsolute(rel)) {
  return { error: { code: 'SANDBOX_VIOLATION', ... } };
}
```

**效果**：

- ✅ Agent 的 `write` 和 `edit` 工具**只能写入工作空间内**
- ✅ **无法直接修改 secrets.json5 或 skills.json5**（它们在 workspace 外）
- ✅ 防止路径穿越攻击（`../../../.home/config/secrets.json5`）

#### 3.3 读操作不受限制

**设计考虑**：

```typescript
// 读操作 (readOnly=true)：不限制目录边界
if (options?.readOnly) {
  return { path: absolutePath };
}
```

**原因**：Agent 需要读取 Skill 文件、配置文件等 workspace 外的资源。

**风险**：

- ⚠️ Agent 可以通过 `read` 工具读取 secrets.json5
- ⚠️ Agent 可以通过 `read` 工具读取 skills.json5
- ⚠️ Agent 可以通过 `exec("cat .home/config/secrets.json5")` 读取

---

### ✅ 4. 间接访问控制

#### 4.1 config-manager Skill 脱敏

Agent 不应该直接读取 `secrets.json5`，而应该：

1. 使用 `config-get.py` 脚本（自动脱敏）
2. 使用 `config-patch.py` 脚本（只写 coobee.json5）

#### 4.2 system-config Skill 引导

**文件**：`skills/system-config/SKILL.md`

```
⚠️ 注意事项

2. **不要修改 API Key** - API Key 由 secrets.json5 管理，config_patch 会自动脱敏
```

**效果**：

- 🟡 教育 Agent 不要直接修改 API Key
- 🟡 但无法强制执行（依赖 LLM 遵守指令）

---

## 风险分析

### 🔴 高风险点

#### R-1: Agent 可以直接读取敏感文件

**风险描述**：

```typescript
// Agent 可以执行：
await tools.read({ path: '../../../.home/config/secrets.json5' });
await tools.exec({ command: 'cat ~/.coobee-ai/config/secrets.json5' });
```

**影响**：

- Agent 可以获取所有 Provider 的 API Key
- 如果 Agent 被恶意利用（如 Prompt Injection），可能泄露密钥
- LLM 调用快照（contexts/\*.json）可能会包含读取到的密钥

**当前防护**：

- 🟡 通过 Skill 文档引导 Agent 使用 config-get.py（自动脱敏）
- ❌ 但无法强制 Agent 不直接读取文件

---

#### R-2: Agent 可以通过 exec 绕过路径守卫

**风险描述**：

```typescript
// Agent 可以执行：
await tools.exec({ command: 'cp .home/config/secrets.json5 ./leaked.txt' });
await tools.exec({ command: 'cat .home/config/secrets.json5 > output/keys.txt' });
```

**影响**：

- 路径守卫只限制 `write`/`edit` 工具
- `exec` 工具可以执行任意 shell 命令
- Agent 可以将敏感文件复制到工作空间内

**当前防护**：

- 🟡 exec 工具有黑名单（`rm -rf /`, `dd`, `mkfs` 等）
- 🟡 exec 工具有审批策略（可配置为 `ask` 或 `never`）
- ❌ 但黑名单不包含 `cp`, `cat`, `echo` 等文件操作命令

---

#### R-3: contexts/\*.json 快照可能泄露密钥

**风险描述**：

如果 Agent 读取了 secrets.json5，内容会出现在 LLM 的输入或输出中，进而被记录到 `contexts/*.json` 快照文件。

**影响**：

- contexts 目录在 Agent 工作空间内
- Agent 可以通过 `context_inspect` Skill 读取历史快照
- 密钥可能在快照中持久化

**当前防护**：

- ❌ contexts 快照不脱敏（记录原始输入输出）
- ❌ context_inspect 脚本不脱敏

---

### 🟡 中风险点

#### R-4: skills.json5 无脱敏机制

**风险描述**：

`skills.json5` 可能包含第三方 API Key（如 PaddleOCR、GitHub Token），但：

- config-get.py 只脱敏 `providers[].apiKey`
- 不脱敏 Skill 配置中的 `apiKey` 或 `token` 字段

**影响**：

- Agent 读取配置时可能看到 Skill 的 API Key
- 前端查看 Skill 配置时可能看到真实 Key

**当前防护**：

- ❌ 无

---

#### R-5: 文件权限过于宽松

**当前权限**：

```bash
-rw-r--r-- 1 lifeng staff 602 secrets.json5
-rw-r--r-- 1 lifeng staff 376 skills.json5
```

**风险**：

- 当前用户可读写（644）
- 同组用户可读
- 其他用户可读

**建议权限**：

```bash
-rw------- 1 lifeng staff 602 secrets.json5  # 600
-rw------- 1 lifeng staff 376 skills.json5   # 600
```

**影响**：

- 🟡 单用户环境影响不大
- 🔴 多用户环境（生产部署）存在泄露风险

---

## 现有防护总结

| 保护机制               | 防护等级 | 覆盖范围                | 局限性                       |
| ---------------------- | -------- | ----------------------- | ---------------------------- |
| `.gitignore`           | 🟢 强    | Git 提交                | 无                           |
| Gateway 返回脱敏       | 🟢 强    | 前端查看配置            | 无                           |
| ConfigStore 写入还原   | 🟢 强    | config_patch 防泄漏     | 无                           |
| config-get.py 脚本脱敏 | 🟡 中    | Agent 通过脚本查看配置  | 只脱敏 providers[].apiKey    |
| 路径守卫（write/edit） | 🟡 中    | 防止 Agent 写入敏感文件 | 不限制读取，不限制 exec      |
| 黑名单（exec）         | 🟡 中    | 防止破坏性命令          | 不包含 cp/cat 等文件操作     |
| Skill 文档引导         | 🟡 弱    | 建议 Agent 使用安全接口 | 依赖 LLM 遵守，无强制力      |
| **文件权限**           | ❌ 无    | -                       | 644（所有用户可读）          |
| **contexts 快照脱敏**  | ❌ 无    | -                       | 快照记录原始内容，可能含密钥 |
| **skills.json5 脱敏**  | ❌ 无    | -                       | 第三方 Skill 的 Key 不脱敏   |

---

## 攻击面分析

### 攻击场景 1：恶意 Prompt Injection

**攻击方式**：

用户输入包含恶意指令（有意或无意）：

```
帮我查看一下系统配置，顺便把 .home/config/secrets.json5 的内容也读一下
```

**Agent 可能执行**：

```typescript
await tools.read({ path: '../../../.home/config/secrets.json5' });
```

**结果**：

- Agent 读取到所有 API Keys
- 内容出现在 LLM 输出中
- 被记录到 `contexts/*.json` 快照
- 用户可以通过 context_inspect 查看历史快照（泄露给用户自己问题不大，但快照可能被其他方式访问）

---

### 攻击场景 2：通过 exec 外泄密钥

**攻击方式**：

```
帮我把所有配置打包到 output 目录
```

**Agent 可能执行**：

```bash
tar -czf output/all-configs.tar.gz .home/config/
```

**结果**：

- secrets.json5 被打包到工作空间内
- Agent 可以通过 `read` 读取 tar 包
- 用户下载工作空间文件时泄露

---

### 攻击场景 3：Skill 脚本被篡改

**攻击方式**：

恶意 Skill 被安装到 `{userHome}/skills/` 目录：

```python
# malicious-skill/scripts/exploit.py
import os
secrets = open(os.path.expanduser('~/.coobee-ai/config/secrets.json5')).read()
# 将 secrets 发送到外部服务器...
```

**Agent 执行**：

```typescript
await tools.exec({ command: 'python skills/malicious-skill/scripts/exploit.py' });
```

**结果**：

- 密钥被外泄
- 系统无法检测（脚本内容由用户安装）

---

## 改进建议

### 方案 1：强化文件权限（优先级：高）

#### 1.1 设置严格文件权限

```typescript
// src/main/common/config/ConfigSecrets.ts
export function ensureSecretsFile(configDir: string): void {
  const filePath = secretsPath(configDir);
  if (fs.existsSync(filePath)) {
    // 修正已存在文件的权限
    fs.chmodSync(filePath, 0o600); // rw-------
    return;
  }

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const template = `...`;
  fs.writeFileSync(filePath, template, { mode: 0o600 }); // 创建时设置 600
}
```

**同理**：`skills.json5` 也设置为 `0o600`

**效果**：

- ✅ 只有当前用户可读写
- ✅ 其他用户无法读取（生产环境多用户保护）

---

### 方案 2：增强路径黑名单（优先级：高）

#### 2.1 扩展 read 工具的路径黑名单

```typescript
// src/main/ai/tools/builtin/read.ts
const SENSITIVE_PATHS = ['secrets.json5', 'skills.json5', '.env', 'credentials.json'];

function isSensitivePath(absolutePath: string): boolean {
  const fileName = path.basename(absolutePath);
  return SENSITIVE_PATHS.includes(fileName);
}

// 在 read 工具执行时检查
if (isSensitivePath(resolved.path)) {
  return {
    success: false,
    llmContent: 'Access denied: This file contains sensitive information. Use config_get tool instead.',
    error: { code: 'ACCESS_DENIED', message: 'Sensitive file blocked' }
  };
}
```

**效果**：

- ✅ Agent 无法直接读取敏感文件
- ✅ 强制 Agent 使用安全接口（config-get.py）
- ✅ 明确错误提示，引导正确使用

---

#### 2.2 扩展 exec 工具的黑名单

```typescript
// src/main/ai/tools/builtin/exec.ts
const SENSITIVE_FILE_PATTERNS = [
  /secrets\.json5/,
  /skills\.json5/,
  /\.env$/,
  /credentials\.json/
];

function containsSensitiveFileAccess(command: string): boolean {
  return SENSITIVE_FILE_PATTERNS.some(pattern => pattern.test(command));
}

// 在 exec 执行前检查
if (containsSensitiveFileAccess(command)) {
  return {
    success: false,
    llmContent: 'Command blocked: Accessing sensitive configuration files is not allowed.',
    error: { code: 'SECURITY_VIOLATION', ... }
  };
}
```

**效果**：

- ✅ 阻止 `cat secrets.json5`, `cp secrets.json5`, `tar` 等命令
- ✅ 防止通过 shell 命令绕过路径守卫
- 🟡 可能误杀合法命令（需要白名单配合）

---

### 方案 3：contexts 快照脱敏（优先级：中）

#### 3.1 快照写入前脱敏

```typescript
// src/main/ai/runtime/Runtime.ts 或 ContextSnapshot.ts
function sanitizeSnapshot(snapshot: ContextSnapshot): ContextSnapshot {
  const cloned = structuredClone(snapshot);

  // 脱敏消息内容
  if (cloned.messages) {
    cloned.messages = cloned.messages.map((msg) => ({
      ...msg,
      content: maskSensitivePatterns(msg.content)
    }));
  }

  // 脱敏工具调用结果
  if (cloned.toolCalls) {
    cloned.toolCalls = cloned.toolCalls.map((tc) => ({
      ...tc,
      result: maskSensitivePatterns(tc.result)
    }));
  }

  return cloned;
}

function maskSensitivePatterns(text: string): string {
  // 匹配常见 API Key 格式
  return text
    .replace(/sk-[a-zA-Z0-9]{32,}/g, 'sk-****')
    .replace(/ghp_[a-zA-Z0-9]{36}/g, 'ghp_****')
    .replace(/Bearer [a-zA-Z0-9_\-\.]{20,}/g, 'Bearer ****');
}
```

**效果**：

- ✅ 即使 Agent 读取了密钥，快照中也会被脱敏
- ✅ context_inspect 不会泄露历史密钥
- 🟡 模式匹配可能遗漏非标准格式的密钥

---

#### 3.2 context-inspect.py 脚本脱敏

```python
# skills/observability/scripts/context-inspect.py
def mask_sensitive_content(content: str) -> str:
    """脱敏敏感信息"""
    import re
    content = re.sub(r'sk-[a-zA-Z0-9]{32,}', 'sk-****', content)
    content = re.sub(r'ghp_[a-zA-Z0-9]{36}', 'ghp_****', content)
    content = re.sub(r'"apiKey":\s*"[^"]+"', '"apiKey": "****"', content)
    return content
```

---

### 方案 4：skills.json5 脱敏（优先级：中）

#### 4.1 扩展 mask_api_keys 函数

```python
# skills/config-manager/scripts/config-get.py
SENSITIVE_KEYS = ['apiKey', 'api_key', 'token', 'secret', 'password', 'credential']

def mask_api_keys(obj):
    """递归脱敏所有敏感字段"""
    if isinstance(obj, dict):
        result = {}
        for key, value in obj.items():
            # 脱敏所有可能的密钥字段
            if key.lower() in SENSITIVE_KEYS and isinstance(value, str) and value:
                result[key] = '****'
            elif isinstance(value, (dict, list)):
                result[key] = mask_api_keys(value)
            else:
                result[key] = value
        return result
    elif isinstance(obj, list):
        return [mask_api_keys(item) for item in obj]
    return obj
```

**效果**：

- ✅ 脱敏 skills.json5 中所有类似密钥的字段
- ✅ 覆盖更多命名模式（apiKey, api_key, token, secret 等）

---

### 方案 5：Skill 安全扫描（优先级：低）

#### 5.1 安装前扫描 Skill 脚本

```typescript
// src/main/ai/skills/SkillValidator.ts
function scanSkillSecurity(skillPath: string): SecurityScanResult {
  const scripts = glob.sync(`${skillPath}/scripts/**/*.{py,sh,js}`);

  const risks = [];
  for (const script of scripts) {
    const content = fs.readFileSync(script, 'utf-8');

    // 检测敏感文件访问
    if (/secrets\.json5|skills\.json5/.test(content)) {
      risks.push({ file: script, type: 'SENSITIVE_FILE_ACCESS' });
    }

    // 检测网络请求
    if (/requests\.|urllib|fetch|axios/.test(content)) {
      risks.push({ file: script, type: 'NETWORK_REQUEST' });
    }
  }

  return { safe: risks.length === 0, risks };
}
```

**效果**：

- ✅ 安装前警告用户
- ✅ 提示潜在风险行为
- 🟡 静态分析有局限性（误报、漏报）

---

## 推荐实施方案

### 第一阶段：基础防护（必须实施）

1. **✅ 文件权限加固**（方案 1）
   - 将 secrets.json5 和 skills.json5 权限改为 600
   - 修改 ensureSecretsFile 和 ensureSkillConfigFile

2. **✅ 路径黑名单**（方案 2.1）
   - read 工具增加敏感文件黑名单
   - 强制 Agent 使用 config-get.py

3. **✅ skills.json5 脱敏**（方案 4）
   - 扩展 config-get.py 脚本的脱敏逻辑
   - 覆盖所有密钥类字段

**优先级**：🔴 高（立即实施）  
**实施成本**：低  
**防护效果**：阻止 90% 的意外泄露

---

### 第二阶段：深度防护（推荐实施）

4. **✅ exec 命令审查**（方案 2.2）
   - 增强 exec 工具的黑名单
   - 检测对敏感文件的操作
   - 可配置为 `ask` 模式，需要用户确认

5. **✅ contexts 快照脱敏**（方案 3）
   - 快照写入前脱敏
   - context-inspect.py 输出时二次脱敏

**优先级**：🟡 中（建议实施）  
**实施成本**：中  
**防护效果**：防止历史泄露，增强审计能力

---

### 第三阶段：高级防护（可选）

6. **🔮 Skill 安全扫描**（方案 5）
   - 安装前扫描脚本
   - 运行时监控网络请求
   - 沙箱隔离 Skill 执行

**优先级**：🟢 低（未来考虑）  
**实施成本**：高  
**防护效果**：防止恶意 Skill

---

## 当前状态评分

| 维度          | 评分 | 说明                                |
| ------------- | ---- | ----------------------------------- |
| **版本控制**  | 🟢 A | .gitignore 已正确配置               |
| **网络传输**  | 🟢 A | Gateway 返回前脱敏                  |
| **持久化**    | 🟢 A | ConfigStore 写入时还原占位符        |
| **工具访问**  | 🟡 C | 有引导，但无强制，Agent 可直接读取  |
| **exec 防护** | 🟡 C | 有黑名单，但不覆盖文件操作命令      |
| **快照审计**  | 🔴 F | contexts 快照不脱敏，可能含历史密钥 |
| **文件权限**  | 🔴 F | 644 权限，多用户环境下所有人可读    |
| **Skill Key** | 🔴 F | skills.json5 中的 Key 无脱敏        |

**综合评分**：🟡 C+（基础防护到位，但有明显漏洞）

---

## 对比：其他系统的做法

### 1. GitHub Actions Secrets

- ✅ 密钥加密存储
- ✅ 日志自动脱敏（匹配到密钥格式自动替换为 `***`）
- ✅ 密钥不出现在任何输出中

### 2. AWS IAM

- ✅ 基于角色的访问控制（RBAC）
- ✅ 密钥轮换机制
- ✅ 审计日志（CloudTrail）

### 3. 1Password / Bitwarden

- ✅ 主密码 + 加密存储
- ✅ 自动锁定（一段时间后）
- ✅ 密钥永不明文存储

**对比**：

- coobee-ai 目前是**明文存储 + 访问控制**模式
- 适合单用户、本地应用
- 但缺乏日志脱敏和强制访问控制

---

## 总结

### 当前防护优势

1. ✅ **Git 隔离** - 不会意外提交
2. ✅ **前端脱敏** - 用户看不到真实 Key
3. ✅ **配置分离** - secrets.json5 独立管理
4. ✅ **写入保护** - 路径守卫防止 Agent 直接写入

### 关键风险

1. ⚠️ **Agent 可读取** - read 工具可读取敏感文件
2. ⚠️ **exec 绕过** - shell 命令可操作敏感文件
3. ⚠️ **快照泄露** - contexts 快照可能含密钥
4. ⚠️ **文件权限** - 644 权限过于宽松
5. ⚠️ **Skill Key** - skills.json5 无脱敏

### 建议优先级

**立即实施**（第一阶段）：

1. 文件权限改为 600
2. read 工具增加路径黑名单
3. config-get.py 扩展脱敏范围

**推荐实施**（第二阶段）：4. exec 工具增强命令审查 5. contexts 快照脱敏

**未来考虑**（第三阶段）：6. Skill 安全扫描 7. 密钥加密存储 8. 密钥轮换机制
