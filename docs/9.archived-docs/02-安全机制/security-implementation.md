# 安全机制实现文档

> **实施时间**: 2026-02-23  
> **版本**: v1.0  
> **关联文档**: [安全分析报告](./security-analysis-secrets-skills.md) | [脚本绕过深度分析](./security-deep-dive-script-bypass.md)

---

## 概述

本文档详细记录了针对 `secrets.json5` 和 `skills.json5` 敏感文件的安全防护措施实施过程。

### 实施目标

1. **目录隔离**：将敏感文件从 `config/` 迁移到独立的 `secrets/` 目录
2. **工具黑名单**：在 `read`、`write`、`exec` 工具中增加敏感路径检测
3. **脚本扫描**：检测 Agent 编写的 Python/Node.js 脚本中的敏感操作

---

## 第一步：目录隔离

### 1.1 路径结构变更

#### 旧架构（v0.x）

```
.home/
└── config/
    ├── coobee.json5          # 应用配置
    ├── secrets.json5         # API Keys（敏感）
    └── skills.json5          # Skill 配置（敏感）

~/.coobee-ai/
└── config/
    ├── coobee.json5
    ├── secrets.json5
    └── skills.json5
```

#### 新架构（v1.0+）

```
.home/
├── config/
│   └── coobee.json5          # 应用配置（非敏感）
└── secrets/                   # 敏感信息目录（700 权限）
    ├── secrets.json5         # API Keys（600 权限）
    └── skills.json5          # Skill 配置（600 权限）

~/.coobee-ai/
├── config/
│   └── coobee.json5
└── secrets/                   # 700 权限
    ├── secrets.json5         # 600 权限
    └── skills.json5          # 600 权限
```

### 1.2 核心代码修改

#### 1.2.1 路径定义（`env.ts`）

```typescript
export const Env = {
  paths: {
    // ... 其他路径 ...

    /** 用户配置目录 */
    configDir: path.join(_userHome, 'config'),

    /** 敏感信息目录（独立于 config，更严格的权限控制） */
    secretsDir: path.join(_userHome, 'secrets')
  }
};
```

#### 1.2.2 配置加载器更新

**ConfigSecrets.ts**：

```typescript
export function loadSecrets(secretsDir: string): SecretsMap {
  const filePath = path.join(secretsDir, SECRETS_FILE_NAME);
  // ... 读取逻辑 ...
}

export function ensureSecretsFile(secretsDir: string): void {
  const filePath = secretsPath(secretsDir);
  if (fs.existsSync(filePath)) {
    fs.chmodSync(filePath, 0o600); // 确保 600 权限
    return;
  }

  if (!fs.existsSync(secretsDir)) {
    fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
  }

  fs.writeFileSync(filePath, template, { mode: 0o600, encoding: 'utf-8' });
  fs.chmodSync(secretsDir, 0o700); // 确保目录 700 权限
}
```

**SkillConfig.ts**：

```typescript
export function loadSkillConfigs(secretsDir: string): SkillConfigMap {
  const filePath = path.join(secretsDir, SKILL_CONFIG_FILE_NAME);
  // ... 读取逻辑 ...
}
```

**ConfigLoader.ts**：

```typescript
export class ConfigLoader {
  private configDir: string;
  private secretsDir: string;

  constructor(configDir: string, secretsDir?: string) {
    this.configDir = configDir;
    this.secretsDir = secretsDir || configDir; // 兼容旧调用
  }

  get secretsFilePath(): string {
    return secretsPath(this.secretsDir);
  }

  get skillConfigFilePath(): string {
    return skillConfigPath(this.secretsDir);
  }
}
```

#### 1.2.3 SkillManager 更新

```typescript
export class SkillManager {
  private secretsDir: string | undefined;

  scanSkills(searchPaths: string[], secretsDir?: string): SkillDefinition[] {
    if (secretsDir) this.secretsDir = secretsDir;
    // ... 扫描逻辑 ...
    if (this.secretsDir) {
      this.injectConfigStatus();
    }
  }

  private injectConfigStatus(): void {
    if (!this.secretsDir) return;
    const configs = loadSkillConfigs(this.secretsDir);
    // ... 注入逻辑 ...
  }

  getSkillRuntimeConfig(skillName: string): Record<string, unknown> | undefined {
    if (!this.secretsDir) return undefined;
    const configs = loadSkillConfigs(this.secretsDir);
    return configs[skillName];
  }
}
```

#### 1.2.4 调用点更新

所有调用 `scanSkills` 的地方都需要传入 `secretsDir`：

```typescript
// AgentEnvInjector.ts
skillManager.scanSkills(agentEnv.skillPaths, Env.paths.secretsDir);

// skills.ts (Gateway)
const allSkills = manager.scanSkills(searchPaths, Env.paths.secretsDir);

// chat.ts (Gateway)
const secretsDir = Env.paths.secretsDir;
const allSkills = manager.scanSkills(searchPaths, secretsDir);

// agents.ts (Gateway)
const secretsDir = Env.paths.secretsDir;
const allSkills = manager.scanSkills(searchPaths, secretsDir);
```

### 1.3 迁移脚本

创建 `scripts/migrate-secrets.ts`：

```typescript
function migrateFiles(baseDir: string, env: 'dev' | 'prod'): MigrationResult {
  const configDir = path.join(baseDir, 'config');
  const secretsDir = path.join(baseDir, 'secrets');

  const secretsOld = path.join(configDir, 'secrets.json5');
  const secretsNew = path.join(secretsDir, 'secrets.json5');
  const skillsOld = path.join(configDir, 'skills.json5');
  const skillsNew = path.join(secretsDir, 'skills.json5');

  // 创建 secrets/ 目录（700 权限）
  if (!fs.existsSync(secretsDir)) {
    fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
  }

  // 迁移 secrets.json5
  if (fs.existsSync(secretsOld) && !fs.existsSync(secretsNew)) {
    fs.copyFileSync(secretsOld, secretsNew);
    fs.chmodSync(secretsNew, 0o600);
    fs.unlinkSync(secretsOld);
  }

  // 迁移 skills.json5
  if (fs.existsSync(skillsOld) && !fs.existsSync(skillsNew)) {
    fs.copyFileSync(skillsOld, skillsNew);
    fs.chmodSync(skillsNew, 0o600);
    fs.unlinkSync(skillsOld);
  }
}
```

**执行迁移**：

```bash
npx tsx scripts/migrate-secrets.ts
```

---

## 第二步：工具黑名单

### 2.1 敏感路径检测模块

创建 `src/main/ai/tools/security/sensitive-paths.ts`：

```typescript
const SENSITIVE_FILES = ['secrets/secrets.json5', 'secrets/skills.json5', '.env', '.env.local'];

const SENSITIVE_DIRS = ['secrets'];

export function checkSensitivePath(absolutePath: string): { sensitive: false } | { sensitive: true; reason: string } {
  const userHome = Env.paths.userHome;

  if (!absolutePath.startsWith(userHome)) {
    return { sensitive: false };
  }

  const relativePath = path.relative(userHome, absolutePath);

  for (const sensitiveFile of SENSITIVE_FILES) {
    if (relativePath === sensitiveFile || relativePath.startsWith(sensitiveFile + path.sep)) {
      return {
        sensitive: true,
        reason: `Sensitive file: ${sensitiveFile} (contains API Keys or credentials)`
      };
    }
  }

  for (const sensitiveDir of SENSITIVE_DIRS) {
    if (relativePath.startsWith(sensitiveDir + path.sep) || relativePath === sensitiveDir) {
      return {
        sensitive: true,
        reason: `Sensitive directory: ${sensitiveDir}/ (restricted access)`
      };
    }
  }

  return { sensitive: false };
}

export function canRead(absolutePath: string): string | null {
  const check = checkSensitivePath(absolutePath);
  if (check.sensitive) {
    return `Access denied: ${check.reason}. Use official config APIs instead.`;
  }
  return null;
}

export function canWrite(absolutePath: string): string | null {
  const check = checkSensitivePath(absolutePath);
  if (check.sensitive) {
    return `Access denied: ${check.reason}. Use official config APIs instead.`;
  }
  return null;
}
```

### 2.2 read 工具增强

```typescript
import { canRead } from '../security/sensitive-paths'

execute: async function* (...) {
  // ... 路径解析 ...
  const absolutePath = resolved.absolutePath

  // 敏感路径检查
  const sensitiveError = canRead(absolutePath)
  if (sensitiveError) {
    return {
      success: false,
      llmContent: `Error: ${sensitiveError}`,
      error: { code: 'SENSITIVE_PATH', message: sensitiveError }
    }
  }

  // ... 继续读取 ...
}
```

### 2.3 write 工具增强

```typescript
import { canWrite } from '../security/sensitive-paths'
import { scanScriptContent } from '../security/command-scanner'

execute: async function* (...) {
  // ... 路径解析 ...
  const absolutePath = resolved.absolutePath

  // 敏感路径检查
  const sensitiveError = canWrite(absolutePath)
  if (sensitiveError) {
    return {
      success: false,
      llmContent: `Error: ${sensitiveError}`,
      error: { code: 'SENSITIVE_PATH', message: sensitiveError }
    }
  }

  // 脚本内容扫描
  const ext = extname(absolutePath).toLowerCase()
  const isScript = ['.py', '.js', '.ts', '.mjs', '.cjs', '.sh', '.bash'].includes(ext)
  if (isScript) {
    const scriptError = scanScriptContent(content)
    if (scriptError) {
      return {
        success: false,
        llmContent: `Error: ${scriptError}`,
        error: { code: 'DANGEROUS_SCRIPT', message: scriptError }
      }
    }
  }

  // ... 继续写入 ...
}
```

### 2.4 exec 工具增强

创建 `src/main/ai/tools/security/command-scanner.ts`：

```typescript
const DANGEROUS_PATTERNS = [
  /secrets\.json5/,
  /skills\.json5/,
  /\.env(\s|$)/,
  /[\/\\]secrets[\/\\]/,
  /rm\s+-rf\s+\//,
  /chmod\s+777/,
  /sudo\s+/
  // ... 更多危险模式 ...
];

const SAFE_COMMAND_PREFIXES = [
  'echo',
  'cat',
  'ls',
  'pwd',
  'cd',
  'mkdir',
  'touch',
  'node',
  'npm',
  'pnpm',
  'yarn',
  'git',
  'python',
  'tsx',
  'tsc'
];

export function scanCommand(command: string, workingDir?: string): string | null {
  const firstToken = command.trim().split(/\s+/)[0];
  const isWhitelisted = SAFE_COMMAND_PREFIXES.some((prefix) => {
    return firstToken === prefix || firstToken.endsWith(`/${prefix}`);
  });

  if (isWhitelisted) {
    return null; // 白名单命令跳过危险模式检查
  }

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return `Dangerous command pattern detected: ${pattern.source}. Operation blocked for security.`;
    }
  }

  if (workingDir && workingDir.startsWith(Env.paths.secretsDir)) {
    return `Cannot execute commands in sensitive directory: ${Env.paths.secretsDir}/. Operation blocked.`;
  }

  return null;
}

export function scanScriptContent(scriptContent: string): string | null {
  const sensitiveFilePatterns = [
    /open\s*\(\s*['"`].*secrets\.json5['"`]/,
    /readFileSync\s*\(\s*['"`].*secrets\.json5['"`]/
    // ... 更多模式 ...
  ];

  for (const pattern of sensitiveFilePatterns) {
    if (pattern.test(scriptContent)) {
      return `Script attempts to access sensitive files. Use official config APIs instead.`;
    }
  }

  if (/[\/\\]secrets[\/\\]/.test(scriptContent)) {
    return `Script attempts to access sensitive directory: /secrets/. Operation blocked.`;
  }

  return null;
}
```

在 `exec.ts` 中应用：

```typescript
import { scanCommand } from '../security/command-scanner'

execute: async function* (...) {
  const command = params.command as string
  const cwd = resolveWorkingDirectory(context)

  // 敏感路径和危险命令扫描（第一道防线）
  const scanError = scanCommand(command, cwd)
  if (scanError) {
    return {
      success: false,
      llmContent: `Error: ${scanError}`,
      error: { code: 'DANGEROUS_COMMAND', message: scanError }
    }
  }

  // ... 继续执行策略检查 ...
}
```

---

## 测试验证

### 3.1 单元测试

创建 `src/main/ai/tools/security/__tests__/security-integration.test.ts`：

```typescript
describe('Sensitive Paths Protection', () => {
  it('应该阻止读取 secrets.json5', () => {
    const sensitiveFile = path.join(os.homedir(), '.coobee-ai', 'secrets', 'secrets.json5');
    const result = checkSensitivePath(sensitiveFile);
    expect(result.sensitive).toBe(true);
  });

  it('应该允许访问普通文件', () => {
    const normalFile = path.join(os.homedir(), '.coobee-ai', 'config', 'coobee.json5');
    const result = checkSensitivePath(normalFile);
    expect(result.sensitive).toBe(false);
  });
});

describe('Command Scanner', () => {
  it('应该阻止修改 secrets.json5', () => {
    const error = scanCommand('sed -i "s/old/new/" ~/.coobee-ai/secrets/secrets.json5');
    expect(error).not.toBeNull();
    expect(error).toContain('secrets.json5');
  });

  it('应该允许安全的 npm 命令', () => {
    const error = scanCommand('npm install axios');
    expect(error).toBeNull();
  });
});
```

### 3.2 TypeScript 类型检查

```bash
npx tsc --noEmit
```

---

## 效果总结

### 4.1 实现的防护层级

| 防护层级 | 防护措施            | 防护对象              | 绕过难度              |
| -------- | ------------------- | --------------------- | --------------------- |
| **L1**   | 目录隔离 + 文件权限 | 操作系统文件系统      | 低（需要 shell 访问） |
| **L2**   | read 工具黑名单     | Agent 直接读取        | 中（需要使用 exec）   |
| **L3**   | exec 命令扫描       | Agent 执行 shell 命令 | 中高（需要写脚本）    |
| **L4**   | write 脚本内容扫描  | Agent 编写恶意脚本    | 高（需要混淆技术）    |

### 4.2 防护范围

✅ **已防护**：

- Agent 直接使用 `read` 工具读取 `secrets/` 目录
- Agent 直接使用 `write` 工具修改敏感文件
- Agent 使用常见命令（`sed`, `awk`, `vim`）修改敏感文件
- Agent 编写包含明文敏感路径的 Python/Node.js 脚本

⚠️ **部分防护**（可通过混淆绕过）：

- Agent 编写高度混淆的脚本（如 Base64 编码路径、动态拼接）
- Agent 使用不常见的工具或语言

❌ **未防护**（需要更高级的方案）：

- Agent 运行的脚本与主进程共享用户权限（文件系统权限无法隔离）
- 需要 Docker 容器或虚拟机隔离才能彻底防护

### 4.3 后续优化方向

**短期（已实施）**：

1. ✅ 目录隔离 + 文件权限
2. ✅ read/write/exec 工具黑名单
3. ✅ 脚本内容静态扫描

**中期（待实施）**：4. ⏳ 运行时监控（`strace`/`dtruss` 拦截文件访问）5. ⏳ 增强脚本扫描（支持 Base64、动态拼接检测）

**长期（未来计划）**：6. 🔮 Secret Service（系统 Keychain 集成）7. 🔮 Docker/VM 进程隔离 8. 🔮 细粒度权限控制（特定 Skill 白名单访问）

---

## 兼容性说明

### 5.1 升级指南

**对于开发者**：

1. 运行迁移脚本：`npx tsx scripts/migrate-secrets.ts`
2. 确认 `.home/secrets/` 目录权限为 700
3. 确认 `secrets.json5` 和 `skills.json5` 权限为 600
4. 测试应用是否正常加载配置

**对于用户**：

- 应用启动时会自动触发迁移（`ensureSecretsFile` 自动创建并修正权限）
- 无需手动操作

### 5.2 向后兼容

- `ConfigLoader` 构造函数第二个参数 `secretsDir` 是可选的（兼容旧测试代码）
- 如果 `secrets/` 目录不存在，会自动创建并迁移文件
- 旧的 `config/secrets.json5` 迁移后会被删除（避免双重配置）

---

## 参考资料

- [安全分析报告](./security-analysis-secrets-skills.md)
- [脚本绕过深度分析](./security-deep-dive-script-bypass.md)
- [工具迁移文档](./tools-to-skills-migration.md)
