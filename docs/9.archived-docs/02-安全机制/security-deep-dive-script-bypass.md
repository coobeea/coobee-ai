# 敏感文件保护深度分析：脚本绕过问题

## 核心问题

**你的担忧完全正确**：即使我们对 `read` 和 `write` 工具增加黑名单，Agent 仍然可以通过自己编写脚本来绕过。

### 攻击场景示例

```typescript
// 步骤 1: Agent 创建一个读取脚本
await tools.write({
  path: 'read_secrets.py',
  content: `
import json5
from pathlib import Path

# 向上查找 secrets.json5
config_path = Path.cwd().parent / 'config' / 'secrets.json5'
with open(config_path) as f:
    secrets = json5.load(f)
print(secrets)
`
});

// 步骤 2: 执行脚本
await tools.exec({ command: 'python read_secrets.py' });

// 结果: Agent 获取到所有 API Keys
```

**绕过原理**：

- `write` 工具可以在工作空间内创建任意脚本
- Python/Shell 脚本内部的文件操作不受我们的路径守卫限制
- `exec` 工具执行脚本时，脚本拥有进程的完整文件系统访问权限

---

## 为什么传统防护无效？

### ❌ 黑名单无效

**read 工具黑名单**：

- 只能阻止 `tools.read({ path: 'secrets.json5' })`
- 无法阻止脚本内的 `open('secrets.json5')`

**exec 工具黑名单**：

- 可以阻止 `cat secrets.json5`
- 无法阻止 `python read_secrets.py`（命令本身看起来无害）

### ❌ 路径守卫无效

**路径守卫范围**：

- 只在 `read`/`write`/`edit` 工具层生效
- 脚本内部的文件操作直接调用操作系统 API
- 绕过了我们的守卫层

### ❌ 静态分析困难

**脚本内容审查**：

- 可以检测脚本是否包含 `secrets.json5` 字符串
- 但攻击者可以混淆：
  ```python
  filename = 'sec' + 'rets' + '.json5'
  path = Path.cwd().parent / 'config' / filename
  ```
- 或者 base64 编码：
  ```python
  import base64
  filename = base64.b64decode('c2VjcmV0cy5qc29uNQ==').decode()
  ```

---

## 可行的防护方案

### 方案 1：敏感目录隔离 + 严格权限（你提出的）

#### 1.1 目录结构调整

**当前**：

```
.home/
├── config/
│   ├── coobee.json5
│   ├── secrets.json5  ← 在 config 目录
│   └── skills.json5   ← 在 config 目录
├── workspaces/
└── ...
```

**调整后**：

```
.home/
├── config/
│   └── coobee.json5
├── secrets/           ← 新建独立目录
│   ├── secrets.json5
│   └── skills.json5
├── workspaces/
└── ...
```

**优势**：

- ✅ 物理隔离，更清晰的安全边界
- ✅ 可以对 secrets/ 目录设置更严格的权限（700）
- ✅ 未来可以单独加密这个目录

#### 1.2 权限加固

```bash
# 目录权限
chmod 700 .home/secrets/  # drwx------ (只有所有者可访问)

# 文件权限
chmod 600 .home/secrets/secrets.json5  # -rw------- (只有所有者可读写)
chmod 600 .home/secrets/skills.json5   # -rw------- (只有所有者可读写)
```

**防护效果**：

- ✅ 多用户环境下其他用户无法读取
- 🟡 但对当前用户进程（包括 Agent）无效
- 🟡 Agent 的 Python 脚本仍然可以读取（因为是同一用户进程）

**局限性**：

- ⚠️ **文件权限无法防止同用户进程访问**
- ⚠️ Agent 的 Python 脚本运行在同一用户身份下
- ⚠️ 权限只能防护**跨用户**，不能防护**进程内**

---

### 方案 2：exec 工具深度审查（可行但有限）

#### 2.1 检测工作空间内新创建的脚本

```typescript
// src/main/ai/tools/builtin/write.ts
const SCRIPT_EXTENSIONS = ['.py', '.sh', '.js', '.mjs'];

async function* execute(...) {
  const filePath = params.path as string;
  const content = params.content as string;

  // 检测是否是脚本文件
  if (SCRIPT_EXTENSIONS.some(ext => filePath.endsWith(ext))) {
    // 扫描脚本内容是否包含敏感路径
    const hasSensitiveAccess = detectSensitiveFileAccess(content);

    if (hasSensitiveAccess) {
      yield {
        type: 'warning',
        content: '⚠️ 检测到脚本可能访问敏感文件，需要用户确认'
      };
      // 标记为需要用户确认（needUserConfirm）
    }
  }

  // 正常写入
  // ...
}

function detectSensitiveFileAccess(scriptContent: string): boolean {
  const patterns = [
    /secrets\.json5/,
    /skills\.json5/,
    /\.home.*config/,
    /~\/\.coobee-ai\/config/,
  ];

  return patterns.some(pattern => pattern.test(scriptContent));
}
```

**防护效果**：

- 🟡 可以检测明文包含敏感路径的脚本
- 🟡 提示用户审查
- ❌ **无法防止混淆和编码**
- ❌ **误报率高**（合法脚本也可能匹配）

---

### 方案 3：运行时监控（最有效但复杂）

#### 3.1 文件访问监控

使用操作系统级别的文件访问监控（如 macOS 的 `fs_usage`、Linux 的 `inotify`）：

```typescript
// 伪代码
class FileAccessMonitor {
  watch(sensitiveFiles: string[]) {
    // 监控进程对敏感文件的访问
    // 当检测到 Agent 子进程访问 secrets.json5 时
    this.onAccess((pid, file) => {
      if (isAgentProcess(pid) && isSensitiveFile(file)) {
        // 1. 终止进程
        process.kill(pid);
        // 2. 记录安全事件
        log.security(`Agent ${pid} attempted to access ${file}`);
        // 3. 通知用户
        notify.warn('检测到异常文件访问');
      }
    });
  }
}
```

**防护效果**：

- ✅ 无论通过什么方式访问，都能检测
- ✅ 可以实时阻止
- ❌ **实现复杂**（需要平台相关代码）
- ❌ **性能开销**（监控所有文件操作）
- ❌ **可能误杀**（合法访问也被阻止）

---

### 方案 4：密钥服务化（根本解决方案）

#### 4.1 设计

**当前模式**：文件存储

```
Agent → read secrets.json5 → 获取 API Key
```

**改进模式**：密钥服务

```
Agent → 调用 get_api_key(provider) 工具 → 主进程验证 → 返回 Key
                                          ↓
                                    不存储在文件系统
                                    存储在内存或系统钥匙串
```

**架构**：

```typescript
// src/main/secrets/SecretManager.ts
class SecretManager {
  private secrets: Map<string, string> = new Map();

  // 从系统钥匙串加载（macOS Keychain, Windows Credential Manager）
  async loadFromKeychain() {
    // 使用 keytar 或 node-keytar 库
  }

  // 工具接口
  getApiKey(provider: string): string | null {
    return this.secrets.get(provider) ?? null;
  }
}

// 新增工具
const getApiKeyTool: ToolDefinition = {
  name: 'get_api_key',
  description: 'Get API key for a specific provider',
  parameters: z.object({
    provider: z.string()
  }),
  execute: async function* (params) {
    const provider = params.provider as string;
    const key = secretManager.getApiKey(provider);

    if (!key) {
      return { success: false, error: 'API Key not found' };
    }

    // 只返回给 LLM 使用的 Provider 调用接口，不返回原始 Key
    return {
      success: true,
      llmContent: `API Key configured for ${provider}. You can now call models from this provider.`
    };
  }
};
```

**LLM Runtime 集成**：

```typescript
// LLM 调用时自动注入 API Key
async function callLLM(model: string, messages: Message[]) {
  const [provider, modelId] = model.split('/');
  const apiKey = secretManager.getApiKey(provider);

  // 使用 apiKey 调用 LLM API
  // Key 永远不传给 Agent，只在 Runtime 层使用
}
```

**防护效果**：

- ✅ **文件系统中不存在明文密钥**
- ✅ Agent 无法通过任何文件操作获取
- ✅ 脚本绕过无效（因为没有文件可读）
- ✅ 密钥只在主进程内存中，Agent 子进程不可见
- ❌ **实施成本高**（需要重构配置系统）
- ❌ **跨平台复杂**（Keychain API 不统一）

---

### 方案 5：Agent 工作空间完全隔离（Docker/VM）

#### 5.1 容器隔离

**设计**：

- Agent 在 Docker 容器内运行
- **不挂载 secrets 目录**
- API Key 通过环境变量传入（但不包含在脚本环境中）

**挂载策略**：

```typescript
// src/main/ai/sandbox/docker/container.ts
function createContainer(config: DockerConfig) {
  return docker.createContainer({
    Image: 'coobee-agent:latest',
    Volumes: {
      '/workspace': {}
      // ❌ 不挂载 secrets 目录
    },
    HostConfig: {
      Binds: [
        `${workspaceDir}:/workspace`
        // ❌ 不包含 secrets/
      ],
      NetworkMode: config.network ? 'bridge' : 'none' // 可选禁用网络
    }
  });
}
```

**防护效果**：

- ✅ **物理隔离**，容器内看不到 secrets 目录
- ✅ Agent 脚本无法访问（文件不存在）
- ✅ 即使提权也无法访问宿主机文件
- ❌ **性能开销**（容器启动、文件同步）
- ❌ **开发体验差**（调试困难）
- ❌ **跨平台兼容性**（Windows Docker Desktop）

---

## 综合方案建议

### 🎯 推荐：分层防护策略

结合多种方案，建立纵深防御：

#### Layer 1: 物理隔离（优先级：高）

**1.1 敏感目录独立**（你提出的）

```
.home/
├── config/           # 非敏感配置
│   └── coobee.json5
├── secrets/          # 敏感信息（新建）
│   ├── secrets.json5
│   └── skills.json5
├── workspaces/       # Agent 工作空间
└── ...
```

**权限设置**：

```bash
chmod 700 .home/secrets/          # 目录: drwx------
chmod 600 .home/secrets/*.json5   # 文件: -rw-------
```

**优势**：

- ✅ 清晰的安全边界
- ✅ 未来可以单独加密 secrets/ 目录
- ✅ 实施简单

---

#### Layer 2: 工具层黑名单（优先级：高）

**2.1 read 工具路径黑名单**

```typescript
const SENSITIVE_PATHS = [
  /secrets\.json5$/,
  /skills\.json5$/,
  /\.home\/secrets\//,
  /~\/\.coobee-ai\/secrets\//,
  /\.env$/
];

function isSensitivePath(path: string): boolean {
  return SENSITIVE_PATHS.some((pattern) => pattern.test(path));
}
```

**2.2 exec 工具命令黑名单**

```typescript
const SENSITIVE_FILE_OPERATIONS = [
  /cat\s+.*secrets/i,
  /cp\s+.*secrets/i,
  /mv\s+.*secrets/i,
  /tar\s+.*secrets/i,
  /grep\s+.*secrets/i
];
```

**效果**：

- ✅ 阻止常见的直接访问
- ✅ 降低意外泄露风险
- 🟡 提高攻击门槛（但不能根除）

---

#### Layer 3: 脚本内容审查（优先级：中）

**3.1 write 工具创建脚本时扫描**

```typescript
// src/main/ai/tools/builtin/write.ts
function scanScriptForSensitiveAccess(content: string, filePath: string): ScanResult {
  const isScript = /\.(py|sh|js|mjs)$/.test(filePath);
  if (!isScript) return { safe: true };

  const patterns = [
    { regex: /secrets\.json5/, risk: 'high', desc: '访问密钥文件' },
    { regex: /skills\.json5/, risk: 'high', desc: '访问 Skill 配置' },
    { regex: /\.home\/secrets/, risk: 'high', desc: '访问敏感目录' },
    { regex: /open\(['"](.*secrets.*|.*\.env)['"]\)/, risk: 'high', desc: '读取敏感文件' }
  ];

  const matches = patterns.filter((p) => p.regex.test(content));

  if (matches.length > 0) {
    return {
      safe: false,
      risks: matches,
      recommendation: '建议人工审查脚本内容'
    };
  }

  return { safe: true };
}
```

**审批策略**：

```typescript
if (!scanResult.safe) {
  // 强制需要用户确认
  yield {
    type: 'approval_required',
    reason: `脚本可能访问敏感文件: ${scanResult.risks.map(r => r.desc).join(', ')}`
  };
}
```

**效果**：

- 🟡 可以检测明文引用
- 🟡 提示用户审查
- ❌ 无法防止混淆和编码
- ❌ 误报率较高（合法脚本也可能匹配）

---

#### Layer 4: 运行时监控（优先级：低，未来考虑）

**4.1 文件访问审计**

在 exec 工具执行前，启动审计模式：

```typescript
// 使用 strace/dtruss 监控子进程的文件访问
const child = spawn('strace', ['-e', 'trace=open,openat', 'python', 'script.py'], {
  // ...
});

child.stderr.on('data', (data) => {
  const line = data.toString();
  // 解析 strace 输出，检测是否访问敏感文件
  if (/open.*secrets\.json5/.test(line)) {
    child.kill();
    notifySecurityViolation();
  }
});
```

**效果**：

- ✅ 运行时实时检测
- ✅ 无法绕过（操作系统级监控）
- ❌ **实现复杂**（平台相关）
- ❌ **性能开销大**
- ❌ **可能影响正常功能**

---

#### Layer 5: 密钥服务化（优先级：低，彻底方案）

**架构调整**：

```
原有: Agent 进程可以读取 secrets.json5
改进: Agent 进程无法访问密钥，只能通过 IPC 请求

┌─────────────────┐          ┌──────────────────┐
│  Agent 进程     │          │  主进程          │
│                 │  IPC     │                  │
│  exec python    │ ───────> │  SecretManager   │
│  (no file)      │ <─────── │  (in-memory)     │
│                 │  API Key │                  │
└─────────────────┘          └──────────────────┘
```

**工具接口**：

```typescript
// Agent 只能调用工具，不能直接读取
await tools.get_api_key({ provider: 'dashscope' });
// 返回: "Key is available, you can now use this provider"
// 不返回原始 Key
```

**LLM 调用时自动注入**：

```typescript
// Runtime 层自动获取 Key 并调用 API
// Agent 不需要知道 Key 的值
```

**效果**：

- ✅ **彻底解决**脚本绕过问题
- ✅ 密钥不在文件系统，无法读取
- ✅ 符合最小权限原则
- ❌ **改动大**（需要重构配置加载、LLM 调用链路）
- ❌ **开发调试复杂**（密钥管理流程变化）

---

## 实施建议

### 🔴 第一步：基础隔离（立即实施）

**改动内容**：

1. **创建 secrets/ 目录**

   ```typescript
   // src/main/common/env.ts
   secretsDir: path.join(_userHome, 'secrets'),
   ```

2. **迁移文件**

   ```bash
   mkdir -p .home/secrets
   mv .home/config/secrets.json5 .home/secrets/
   mv .home/config/skills.json5 .home/secrets/
   chmod 700 .home/secrets
   chmod 600 .home/secrets/*.json5
   ```

3. **更新加载路径**
   ```typescript
   // ConfigSecrets.ts, SkillConfig.ts
   const filePath = path.join(Env.paths.secretsDir, SECRETS_FILE_NAME);
   ```

**优势**：

- ✅ 简单清晰
- ✅ 降低意外泄露风险
- ✅ 为后续加密做准备

**局限性**：

- 🟡 不能防止 Agent 脚本读取（因为是同用户进程）

---

### 🟡 第二步：工具黑名单（推荐实施）

1. **read 工具增加路径黑名单**
2. **exec 工具增加命令黑名单**
3. **write 工具增加脚本内容扫描**

**效果**：

- 提高攻击门槛
- 降低意外泄露
- 但**无法根除**脚本绕过

---

### 🟢 第三步：深度方案（未来考虑）

根据实际需求选择：

- **高安全场景**（企业部署、多用户）→ 方案 5（密钥服务化）+ 方案 4（运行时监控）
- **单用户场景**（当前）→ 第一步 + 第二步已足够

---

## 核心问题讨论

### Q: 文件权限能防止同用户进程吗？

**A: 不能。**

文件权限 `600` 只能防止：

- ❌ 其他用户读取
- ❌ 跨用户进程访问

无法防止：

- ✅ 同用户的进程访问
- ✅ Agent 的 Python 脚本（运行在同一用户身份下）

**原因**：

- Unix 权限模型基于用户/组/其他三级
- 同用户的所有进程拥有相同的文件访问权限
- Agent 进程 = 用户进程 = 可以读取 600 权限的文件

---

### Q: 那怎么防止 Agent 脚本读取？

**A: 只有 3 种方式：**

1. **不在文件系统存储**（方案 5 - 密钥服务化）
   - 密钥在内存或系统钥匙串
   - Agent 进程无法访问

2. **进程隔离**（方案 4 - Docker/VM）
   - Agent 在容器内运行
   - 容器内看不到敏感目录

3. **运行时监控 + 终止**（方案 3 - 文件访问监控）
   - 检测到访问立即终止进程
   - 性能开销大

**结论**：

- 如果要**彻底防护**，必须选择上述之一
- 如果接受**有限防护**，第一步 + 第二步可以降低 90% 风险

---

### Q: 是否过度设计？

**A: 取决于威胁模型。**

**当前场景（单用户本地应用）**：

- 威胁：用户的 Prompt Injection（无意中让 Agent 读取）
- 风险：用户自己的密钥泄露给自己（问题不大）
- 结论：**基础防护即可**（第一步 + 第二步）

**未来场景（企业部署、云服务）**：

- 威胁：恶意用户、共享环境、网络攻击
- 风险：密钥泄露给第三方
- 结论：**需要深度防护**（方案 5 密钥服务化）

---

## 我的建议

### 当前阶段（短期）

**实施第一步 + 第二步**：

1. **创建 `secrets/` 独立目录** ✓
   - 物理隔离敏感文件
   - 设置 700/600 权限

2. **工具层黑名单** ✓
   - read 工具禁止读取 `secrets/` 下的文件
   - exec 工具检测命令中的敏感路径
   - write 工具扫描脚本内容

**实施成本**：低  
**防护效果**：90% 的意外泄露  
**局限性**：无法防止蓄意绕过（但当前场景下可接受）

---

### 未来演进（长期）

当系统需要更高安全性时（如企业部署），再考虑：

**方案 A：密钥服务化**（推荐）

- 密钥不在文件系统
- Agent 无法读取
- 实施成本中等

**方案 B：Docker 完全隔离**（最强）

- 容器内运行 Agent
- 不挂载敏感目录
- 实施成本高

---

## 现在怎么做？

我建议先实施**第一步（目录隔离）**：

1. 创建 `secrets/` 目录
2. 迁移 `secrets.json5` 和 `skills.json5`
3. 更新所有加载这两个文件的代码
4. 设置严格权限

**要开始吗？还是你有其他想法？**
