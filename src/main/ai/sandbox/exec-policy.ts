/**
 * exec 命令安全策略
 *
 * 提供命令级安全过滤，防止 LLM 执行危险命令。
 *
 * 三层防护：
 *   1. 危险命令黑名单（始终拒绝，不可覆盖）
 *   2. 安全命令白名单（始终允许，不触发 HITL）
 *   3. 动态 allowlist 学习（approve-always 时记住命令模式）
 *
 * 集成架构（通过 tool-approval Extension 的 before_tool_call Hook 协同）：
 *
 *   所有 Runtime 统一路径：
 *     LLM 调用 exec → before_tool_call Hook（tool-approval Extension）
 *     → checkExecPolicy() 检查：
 *       - deny → 直接拒绝（block: true）
 *       - allow → 放行
 *       - ask → requestApproval() → hitlApprovalManager.waitForSingleDecision()
 *     → 用户通过前端审批（approve-once / approve-always / reject）
 *     → approve-always 时 learnExecCommand() 学习到动态 allowlist
 *
 * 注意：策略不在 exec 工具内部，工具层是纯执行逻辑。
 *       策略也不在 Runtime 内部，由 Extension Hook 统一处理。
 *
 * @module sandbox/exec-policy
 */

import fs from 'node:fs';
import path from 'node:path';
import { log } from '../../common/logger';

// ==================== 类型定义 ====================

/** 策略检查结果 */
export type PolicyDecision =
  | { action: 'allow'; reason: string }
  | { action: 'deny'; reason: string }
  | { action: 'ask'; reason: string };

// ==================== 安全白名单 ====================

/**
 * 安全命令前缀（不触发 HITL，直接放行）
 *
 * 只包含只读或极低风险的命令。
 * 注意：这里匹配的是命令的首个 token（二进制名称）。
 */
const SAFE_BINS: ReadonlySet<string> = new Set([
  // 文件系统（只读）
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'file',
  'stat',
  'find',
  'tree',
  'du',
  'df',
  'realpath',
  'readlink',
  'basename',
  'dirname',

  // 搜索
  'grep',
  'rg',
  'ag',
  'awk',
  // 'sed', // sed 可以修改文件，已移除，防止绕过 write 审批
  'sort',
  'uniq',
  'diff',
  'comm',
  'cut',
  'tr',
  'jq',

  // 系统信息
  'pwd',
  'whoami',
  'hostname',
  'uname',
  'date',
  'uptime',
  'env',
  'printenv',
  'echo',
  'printf',
  'which',
  'where',
  'type',
  'id',

  // 开发工具（只读操作）
  'git',
  'node',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'bun',
  'deno',
  'python',
  'python3',
  'pip',
  'pip3',
  'cargo',
  'go',
  'rustc',
  'javac',
  'java',
  'mvn',
  'gradle',

  // 网络（只读）
  'ping',
  'dig',
  'nslookup',
  'host',

  // 文本处理
  'less',
  'more',
  'bat', // bat (better cat)
  'hexdump',
  'xxd',
  'md5',
  'shasum',
  'sha256sum',

  // 其他安全工具
  'true',
  'false',
  'test',
  'expr',
  'bc',
  'tee',
  'xargs'
]);

// ==================== 危险命令黑名单 ====================

/**
 * 危险命令模式（始终拒绝）
 *
 * 使用正则匹配，覆盖常见的危险操作。
 * 即使用户 approve-always 也不能跳过这些检查。
 */
const DANGER_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  // 破坏性文件操作
  {
    pattern: /\brm\s+(-[a-zA-Z]*r|-[a-zA-Z]*f|--recursive|--force)/i,
    reason: 'recursive/force remove'
  },
  { pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f/i, reason: 'rm -rf detected' },
  { pattern: /\brm\s+-[a-zA-Z]*f[a-zA-Z]*r/i, reason: 'rm -fr detected' },
  { pattern: /\bmkfs\b/i, reason: 'filesystem format' },
  { pattern: /\bdd\s+.*of=/i, reason: 'raw disk write (dd)' },
  { pattern: /\bformat\b.*[/\\]/i, reason: 'disk format' },

  // 权限提升
  { pattern: /\bsudo\b/i, reason: 'privilege escalation (sudo)' },
  { pattern: /\bsu\s+-?\s*$/i, reason: 'switch user (su)' },
  { pattern: /\bchmod\s+[0-7]*777/i, reason: 'world-writable permissions' },
  { pattern: /\bchown\b/i, reason: 'change file ownership' },

  // 远程代码执行
  { pattern: /\bcurl\b.*\|\s*(sh|bash|zsh|python)/i, reason: 'pipe remote code to shell' },
  { pattern: /\bwget\b.*\|\s*(sh|bash|zsh|python)/i, reason: 'pipe remote code to shell' },
  { pattern: /\beval\b/i, reason: 'eval command' },

  // 系统破坏
  { pattern: /\bshutdown\b/i, reason: 'system shutdown' },
  { pattern: /\breboot\b/i, reason: 'system reboot' },
  { pattern: /\bhalt\b/i, reason: 'system halt' },
  { pattern: /\binit\s+0/i, reason: 'system halt via init' },
  { pattern: /\bkillall\b/i, reason: 'kill all processes' },
  { pattern: /\bpkill\s+-9/i, reason: 'force kill by name' },

  // Fork 炸弹
  { pattern: /:\(\)\s*\{\s*:\|:&\s*\}\s*;/i, reason: 'fork bomb' },

  // 敏感文件访问
  { pattern: /\/etc\/shadow/i, reason: 'access /etc/shadow' },
  { pattern: /\/etc\/sudoers/i, reason: 'access /etc/sudoers' }
];

// ==================== Allowlist 持久化 ====================

/** allowlist 文件名（存放在 configDir 中） */
const ALLOWLIST_FILE = 'learned-commands.json';

/** 内存缓存（与文件保持同步） */
let learnedAllowlist = new Set<string>();

/** 是否已从文件加载 */
let loaded = false;

/**
 * 获取 allowlist 文件路径
 *
 * 通过 ConfigStore 动态获取 configDir，避免硬编码路径。
 */
function getAllowlistPath(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Env } = require('../../common/env');
    const configDir = Env?.paths?.configDir;
    return configDir ? path.join(configDir, ALLOWLIST_FILE) : null;
  } catch {
    return null;
  }
}

/** 从文件加载 allowlist（启动时调用一次） */
function loadAllowlist(): void {
  if (loaded) return;
  loaded = true;

  const filePath = getAllowlistPath();
  if (!filePath || !fs.existsSync(filePath)) return;

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      learnedAllowlist = new Set(data.filter((s: unknown) => typeof s === 'string'));
      log.info(`[ExecPolicy] Loaded ${learnedAllowlist.size} learned commands from file`);
    }
  } catch (err) {
    log.warn('[ExecPolicy] Failed to load learned-commands.json:', err);
  }
}

/** 将 allowlist 同步写入文件 */
function saveAllowlist(): void {
  const filePath = getAllowlistPath();
  if (!filePath) return;

  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(Array.from(learnedAllowlist), null, 2), 'utf-8');
  } catch (err) {
    log.warn('[ExecPolicy] Failed to save learned-commands.json:', err);
  }
}

// ==================== 公共 API ====================

/**
 * 检查命令是否允许执行
 *
 * @param command - 要执行的 shell 命令
 * @returns 策略决策（allow / deny / ask）
 */
export function checkExecPolicy(command: string): PolicyDecision {
  // 确保 allowlist 已从文件加载
  loadAllowlist();

  const trimmed = command.trim();

  // 1. 黑名单检查（不可覆盖）
  for (const { pattern, reason } of DANGER_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        action: 'deny',
        reason: `Dangerous command blocked: ${reason}`
      };
    }
  }

  // 2. 提取首个命令 token（处理管道、重定向等）
  const bin = extractCommandBin(trimmed);

  // 3. 安全白名单
  if (bin && SAFE_BINS.has(bin)) {
    return {
      action: 'allow',
      reason: `Safe command: ${bin}`
    };
  }

  // 4. 动态 allowlist（文件持久化）
  if (bin && learnedAllowlist.has(bin)) {
    return {
      action: 'allow',
      reason: `Learned allowlist: ${bin}`
    };
  }

  // 5. 未知命令 → 需要审批
  return {
    action: 'ask',
    reason: `Unknown command: ${bin || trimmed.slice(0, 50)}`
  };
}

/**
 * 将命令模式加入动态 allowlist（approve-always 时调用）
 *
 * 同时写入文件持久化，应用重启后仍然有效。
 */
export function learnExecCommand(command: string): void {
  loadAllowlist();
  const bin = extractCommandBin(command.trim());
  if (bin && !SAFE_BINS.has(bin)) {
    learnedAllowlist.add(bin);
    saveAllowlist();
    log.info(`[ExecPolicy] Learned allowlist: ${bin} (persisted)`);
  }
}

/**
 * 获取当前动态 allowlist 内容（用于调试/显示/前端展示）
 */
export function getLearnedAllowlist(): string[] {
  loadAllowlist();
  return Array.from(learnedAllowlist);
}

/**
 * 从 allowlist 中移除指定命令
 */
export function unlearnExecCommand(command: string): void {
  const bin = extractCommandBin(command.trim());
  if (bin && learnedAllowlist.has(bin)) {
    learnedAllowlist.delete(bin);
    saveAllowlist();
    log.info(`[ExecPolicy] Removed from allowlist: ${bin}`);
  }
}

/**
 * 清空动态 allowlist
 */
export function clearLearnedAllowlist(): void {
  learnedAllowlist.clear();
  saveAllowlist();
  log.info('[ExecPolicy] Allowlist cleared');
}

// ==================== 内部 ====================

/**
 * 从命令字符串中提取首个可执行文件名
 *
 * 处理常见前缀模式：
 *   - `cd dir && npm install` → `cd`
 *   - `FOO=bar npm run build` → `npm`
 *   - `./script.sh` → `script.sh`
 *   - `/usr/bin/python3 foo.py` → `python3`
 */
function extractCommandBin(command: string): string | null {
  // 跳过环境变量赋值 (VAR=val ...)
  let trimmed = command;
  while (/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/.test(trimmed)) {
    trimmed = trimmed.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/, '');
  }

  // 提取第一个 token
  const match = trimmed.match(/^(?:\.\/)?([^\s|;&]+)/);
  if (!match) return null;

  let bin = match[1];

  // 去除路径前缀（`/usr/bin/python3` → `python3`）
  const lastSlash = bin.lastIndexOf('/');
  if (lastSlash >= 0) {
    bin = bin.slice(lastSlash + 1);
  }

  return bin || null;
}
