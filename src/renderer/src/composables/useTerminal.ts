/**
 * Terminal 组合式函数
 *
 * 管理 PTY 终端的创建、IO、xterm.js 渲染和生命周期。
 * 通过 Gateway HTTP API 创建/销毁终端，通过 Gateway WebSocket 事件接收输出。
 *
 * 使用方式：
 *   const { terminals, activeTerminalId, createTerminal, destroyTerminal, attachToElement } = useTerminal()
 */

import { ref, computed } from 'vue';
import { gateway } from '@/plugins/gatewaySetup';
import configManager from '@/config';

// ==================== 类型 ====================

export interface TerminalInstance {
  id: string;
  pid: number;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  xterm: any | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fitAddon: any | null;
  element: HTMLElement | null;
}

// ==================== 状态 ====================

const terminals = ref<TerminalInstance[]>([]);
const activeTerminalId = ref<string | null>(null);

const activeTerminal = computed(() => terminals.value.find((t) => t.id === activeTerminalId.value) || null);

let cleanups: (() => void)[] = [];
let initialized = false;

// ==================== 初始化 ====================

export function initTerminalWs(): void {
  if (initialized) return;
  initialized = true;

  cleanups.push(
    gateway.on('terminal.output', (payload) => {
      const { terminalId, data } = payload as { terminalId: string; data: string };
      const term = terminals.value.find((t) => t.id === terminalId);
      if (term?.xterm) {
        term.xterm.write(data);
      }
    })
  );

  cleanups.push(
    gateway.on('terminal.exit', (payload) => {
      const { terminalId, exitCode } = payload as { terminalId: string; exitCode: number };
      const term = terminals.value.find((t) => t.id === terminalId);
      if (term?.xterm) {
        term.xterm.write(`\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`);
      }
    })
  );
}

// ==================== API ====================

async function createTerminal(cwd?: string): Promise<TerminalInstance | null> {
  try {
    const baseUrl = configManager.getBaseUrl();
    const res = await fetch(`${baseUrl}/gateway/terminals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd, cols: 80, rows: 24 })
    });

    if (!res.ok) {
      console.error('[useTerminal] Failed to create terminal:', await res.text());
      return null;
    }

    const info = await res.json();
    const instance: TerminalInstance = {
      ...info,
      xterm: null,
      fitAddon: null,
      element: null
    };

    terminals.value.push(instance);
    activeTerminalId.value = instance.id;
    return instance;
  } catch (error) {
    console.error('[useTerminal] Create terminal error:', error);
    return null;
  }
}

async function destroyTerminal(terminalId: string): Promise<void> {
  try {
    const baseUrl = configManager.getBaseUrl();
    await fetch(`${baseUrl}/gateway/terminals/${terminalId}`, { method: 'DELETE' });
  } catch {
    // silent
  }

  const idx = terminals.value.findIndex((t) => t.id === terminalId);
  if (idx >= 0) {
    const term = terminals.value[idx];
    term.xterm?.dispose();
    terminals.value.splice(idx, 1);
  }

  if (activeTerminalId.value === terminalId) {
    activeTerminalId.value = terminals.value.length > 0 ? terminals.value[0].id : null;
  }
}

async function attachToElement(terminalId: string, element: HTMLElement): Promise<void> {
  const term = terminals.value.find((t) => t.id === terminalId);
  if (!term) return;

  if (term.xterm) {
    term.xterm.dispose();
  }

  await import('@xterm/xterm/css/xterm.css');
  const { Terminal } = await import('@xterm/xterm');
  const { FitAddon } = await import('@xterm/addon-fit');
  const { WebLinksAddon } = await import('@xterm/addon-web-links');

  const isDark =
    document.documentElement.classList.contains('dark') || window.matchMedia('(prefers-color-scheme: dark)').matches;

  const xterm = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: "'Menlo', 'Monaco', 'Consolas', 'Courier New', monospace",
    lineHeight: 1.2,
    scrollback: 5000,
    theme: isDark
      ? {
          background: '#1e1e2e',
          foreground: '#cdd6f4',
          cursor: '#f5e0dc',
          selectionBackground: '#45475a',
          black: '#45475a',
          red: '#f38ba8',
          green: '#a6e3a1',
          yellow: '#f9e2af',
          blue: '#89b4fa',
          magenta: '#f5c2e7',
          cyan: '#94e2d5',
          white: '#bac2de'
        }
      : {
          background: '#ffffff',
          foreground: '#4c4f69',
          cursor: '#dc8a78',
          selectionBackground: '#ccd0da',
          black: '#5c5f77',
          red: '#d20f39',
          green: '#40a02b',
          yellow: '#df8e1d',
          blue: '#1e66f5',
          magenta: '#ea76cb',
          cyan: '#179299',
          white: '#acb0be'
        }
  });

  const fitAddon = new FitAddon();
  const webLinksAddon = new WebLinksAddon();

  xterm.loadAddon(fitAddon);
  xterm.loadAddon(webLinksAddon);
  xterm.open(element);

  requestAnimationFrame(() => {
    try {
      fitAddon.fit();
    } catch {
      // element might not be visible yet
    }
  });

  xterm.onData((data: string) => {
    sendInput(terminalId, data);
  });

  xterm.onResize(({ cols, rows }: { cols: number; rows: number }) => {
    resizeTerminal(terminalId, cols, rows);
  });

  term.xterm = xterm;
  term.fitAddon = fitAddon;
  term.element = element;
}

function fitTerminal(terminalId: string): void {
  const term = terminals.value.find((t) => t.id === terminalId);
  if (term?.fitAddon) {
    try {
      term.fitAddon.fit();
    } catch {
      // ignore
    }
  }
}

function fitAllTerminals(): void {
  for (const term of terminals.value) {
    if (term.fitAddon) {
      try {
        term.fitAddon.fit();
      } catch {
        // ignore
      }
    }
  }
}

async function sendInput(terminalId: string, data: string): Promise<void> {
  try {
    const baseUrl = configManager.getBaseUrl();
    await fetch(`${baseUrl}/gateway/terminals/${terminalId}/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data })
    });
  } catch {
    // silent
  }
}

async function resizeTerminal(terminalId: string, cols: number, rows: number): Promise<void> {
  try {
    const baseUrl = configManager.getBaseUrl();
    await fetch(`${baseUrl}/gateway/terminals/${terminalId}/resize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cols, rows })
    });
  } catch {
    // silent
  }
}

function cleanupTerminalWs(): void {
  for (const fn of cleanups) fn();
  cleanups = [];
  initialized = false;
}

// ==================== 导出 ====================

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useTerminal() {
  return {
    terminals,
    activeTerminalId,
    activeTerminal,
    createTerminal,
    destroyTerminal,
    attachToElement,
    fitTerminal,
    fitAllTerminals,
    initTerminalWs,
    cleanupTerminalWs
  };
}
