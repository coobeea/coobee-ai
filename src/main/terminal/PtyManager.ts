/**
 * PtyManager — 伪终端管理器
 *
 * 管理所有 PTY 实例的生命周期（创建、IO、调整大小、销毁）。
 * 每个 PTY 对应一个唯一 terminalId，前端通过 Gateway 事件接收输出、发送输入。
 *
 * 架构位置：
 *   主进程 → PtyManager → node-pty IPty
 *   前端 ← Gateway events (terminal.output / terminal.exit)
 *   前端 → Gateway HTTP  (create / resize / input / destroy)
 */

import { EventEmitter } from 'node:events';
import os from 'node:os';
import { createLogger } from '@main/common/logger';

const log = createLogger('PtyManager');

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
let ptyModule: any = undefined;
try {
  ptyModule = require('node-pty');
} catch {
  log.warn('[PtyManager] node-pty not available');
}
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

/** 允许测试注入 mock pty 模块 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function _setPtyModule(mod: any): void {
  ptyModule = mod;
}

// ==================== 类型 ====================

export interface TerminalInfo {
  id: string;
  pid: number;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: number;
}

export interface TerminalCreateOptions {
  cwd?: string;
  cols?: number;
  rows?: number;
  shell?: string;
  env?: Record<string, string>;
}

interface PtyEntry {
  info: TerminalInfo;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pty: any;
}

// ==================== PtyManager ====================

const MAX_TERMINALS = 10;
let nextId = 1;

class PtyManager extends EventEmitter {
  private terminals = new Map<string, PtyEntry>();

  getDefaultShell(): string {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'cmd.exe';
    }
    return process.env.SHELL || '/bin/zsh';
  }

  create(options: TerminalCreateOptions = {}): TerminalInfo {
    if (this.terminals.size >= MAX_TERMINALS) {
      throw new Error(`Terminal limit reached (max ${MAX_TERMINALS})`);
    }

    const id = `term-${nextId++}`;
    const shell = options.shell || this.getDefaultShell();
    const cols = options.cols || 80;
    const rows = options.rows || 24;
    const cwd = options.cwd || os.homedir();

    const SENSITIVE_ENV_KEYS = [
      'npm_config_',
      'GITHUB_TOKEN',
      'GH_TOKEN',
      'AWS_SECRET',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'SECRET_KEY',
      'PRIVATE_KEY',
      'DATABASE_URL',
      'REDIS_URL'
    ];

    const filteredEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue;
      const upper = key.toUpperCase();
      const isSensitive = SENSITIVE_ENV_KEYS.some(
        (pat) => upper === pat.toUpperCase() || upper.startsWith(pat.toUpperCase())
      );
      if (!isSensitive) {
        filteredEnv[key] = value;
      }
    }

    const env = {
      ...filteredEnv,
      ...options.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor'
    };

    if (!ptyModule) {
      throw new Error('node-pty is not available. Install it with: pnpm add node-pty');
    }

    const ptyProcess = ptyModule.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env
    });

    const info: TerminalInfo = {
      id,
      pid: ptyProcess.pid,
      shell,
      cwd,
      cols,
      rows,
      createdAt: Date.now()
    };

    const entry: PtyEntry = { info, pty: ptyProcess };
    this.terminals.set(id, entry);

    ptyProcess.onData((data: string) => {
      this.emit('terminal:output', { terminalId: id, data });
    });

    ptyProcess.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
      this.emit('terminal:exit', { terminalId: id, exitCode, signal });
      this.terminals.delete(id);
      log.info(`[PTY] Terminal exited: ${id} (code=${exitCode}, signal=${signal})`);
    });

    log.info(`[PTY] Created terminal: ${id} (shell=${shell}, cwd=${cwd}, pid=${ptyProcess.pid})`);
    return info;
  }

  write(terminalId: string, data: string): boolean {
    const entry = this.terminals.get(terminalId);
    if (!entry) return false;
    entry.pty.write(data);
    return true;
  }

  resize(terminalId: string, cols: number, rows: number): boolean {
    const entry = this.terminals.get(terminalId);
    if (!entry) return false;
    entry.pty.resize(cols, rows);
    entry.info.cols = cols;
    entry.info.rows = rows;
    return true;
  }

  destroy(terminalId: string): boolean {
    const entry = this.terminals.get(terminalId);
    if (!entry) return false;

    try {
      entry.pty.kill();
    } catch (e) {
      log.warn(`[PTY] Failed to kill terminal ${terminalId}:`, e);
    }
    this.terminals.delete(terminalId);
    log.info(`[PTY] Destroyed terminal: ${terminalId}`);
    return true;
  }

  get(terminalId: string): TerminalInfo | undefined {
    return this.terminals.get(terminalId)?.info;
  }

  list(): TerminalInfo[] {
    return [...this.terminals.values()].map((e) => e.info);
  }

  cleanup(): void {
    for (const [id, entry] of this.terminals) {
      try {
        entry.pty.kill();
      } catch {
        // ignore
      }
      log.info(`[PTY] Cleanup: ${id}`);
    }
    this.terminals.clear();
  }
}

// ==================== 单例 ====================

let instance: PtyManager | null = null;

export function getPtyManager(): PtyManager {
  if (!instance) {
    instance = new PtyManager();
  }
  return instance;
}

export { PtyManager };
