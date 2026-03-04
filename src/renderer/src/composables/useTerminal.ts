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
  /** 每个终端独立的 DOM 容器 */
  wrapperEl: HTMLDivElement | null;
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
      wrapperEl: null
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
    term.wrapperEl?.remove();
    terminals.value.splice(idx, 1);
  }

  if (activeTerminalId.value === terminalId) {
    activeTerminalId.value = terminals.value.length > 0 ? terminals.value[0].id : null;
  }
}

/**
 * 在父容器中为终端创建独立的 wrapper div 并初始化 xterm。
 * 每个终端拥有自己的 wrapper，通过 display 切换可见性，避免 open() 冲突。
 */
async function attachToContainer(terminalId: string, parentEl: HTMLElement): Promise<void> {
  const term = terminals.value.find((t) => t.id === terminalId);
  if (!term) return;

  if (term.xterm) return;

  await import('@xterm/xterm/css/xterm.css');
  const { Terminal } = await import('@xterm/xterm');
  const { FitAddon } = await import('@xterm/addon-fit');
  const { WebLinksAddon } = await import('@xterm/addon-web-links');

  const wrapper = document.createElement('div');
  wrapper.className = 'xterm-wrapper';
  wrapper.style.cssText = 'width:100%;height:100%;display:none;';
  wrapper.dataset.terminalId = terminalId;
  parentEl.appendChild(wrapper);

  // 终端使用白色背景主题，与输出面板保持一致
  const xterm = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: "'Menlo', 'Monaco', 'Consolas', 'Courier New', monospace",
    lineHeight: 1.2,
    scrollback: 5000,
    theme: {
      background: '#ffffff',
      foreground: '#1e1e1e',
      cursor: '#333333',
      selectionBackground: '#e0e0e0',
      black: '#000000',
      red: '#cd3131',
      green: '#00bc00',
      yellow: '#949800',
      blue: '#0451a5',
      magenta: '#bc05bc',
      cyan: '#0598bc',
      white: '#555555',
      brightBlack: '#666666',
      brightRed: '#cd3131',
      brightGreen: '#00bc00',
      brightYellow: '#949800',
      brightBlue: '#0451a5',
      brightMagenta: '#bc05bc',
      brightCyan: '#0598bc',
      brightWhite: '#a5a5a5'
    }
  });

  const fitAddon = new FitAddon();
  const webLinksAddon = new WebLinksAddon();

  xterm.loadAddon(fitAddon);
  xterm.loadAddon(webLinksAddon);
  xterm.open(wrapper);

  xterm.onData((data: string) => {
    sendInput(terminalId, data);
  });

  xterm.onResize(({ cols, rows }: { cols: number; rows: number }) => {
    resizeTerminal(terminalId, cols, rows);
  });

  term.xterm = xterm;
  term.fitAddon = fitAddon;
  term.wrapperEl = wrapper;
}

/**
 * 显示指定终端、隐藏其它终端的 wrapper
 */
function showTerminal(terminalId: string): void {
  for (const t of terminals.value) {
    if (t.wrapperEl) {
      t.wrapperEl.style.display = t.id === terminalId ? 'block' : 'none';
    }
  }
  const term = terminals.value.find((t) => t.id === terminalId);
  if (term?.fitAddon) {
    // 使用两个 requestAnimationFrame 确保 DOM 已经完全渲染
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          term.fitAddon.fit();
          // 再次调用确保尺寸正确
          term.fitAddon.fit();
        } catch {
          // ignore
        }
        term.xterm?.focus();
      });
    });
  }
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
    attachToContainer,
    showTerminal,
    fitTerminal,
    fitAllTerminals,
    initTerminalWs,
    cleanupTerminalWs
  };
}
