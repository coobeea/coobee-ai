/**
 * Process 领域 WebSocket 组合式
 *
 * 监听 Gateway 推送的 process.* 事件，实时同步后台进程的输出和状态。
 *   process.output — 进程有新的 stdout/stderr 输出
 *   process.exit   — 进程退出
 */

import { ref } from 'vue';
import { gateway } from '@/plugins/gatewaySetup';
import configManager from '@/config';

export interface ProcessInfo {
  processId: string;
  command: string;
  cwd: string;
  pid: number | undefined;
  status: 'running' | 'exited' | 'killed' | 'error';
  startedAt: number;
  exitCode?: number | null;
}

export interface ProcessOutputLine {
  processId: string;
  text: string;
  timestamp: number;
}

const processes = ref<ProcessInfo[]>([]);
const outputBuffer = ref<ProcessOutputLine[]>([]);
const MAX_OUTPUT_LINES = 500;

let initialized = false;
let cleanups: (() => void)[] = [];

export function useProcessState(): { processes: typeof processes; outputBuffer: typeof outputBuffer } {
  return { processes, outputBuffer };
}

export function initProcessWs(): void {
  if (initialized) return;
  initialized = true;

  cleanups.push(
    gateway.on('process.output', (payload) => {
      const { processId, text } = payload as { processId: string; text: string };
      if (!processId || !text) return;

      outputBuffer.value.push({ processId, text, timestamp: Date.now() });
      if (outputBuffer.value.length > MAX_OUTPUT_LINES) {
        outputBuffer.value = outputBuffer.value.slice(-MAX_OUTPUT_LINES);
      }
    })
  );

  cleanups.push(
    gateway.on('process.exit', (payload) => {
      const { processId, status, exitCode } = payload as {
        processId: string;
        status: string;
        exitCode: number | null;
      };
      const proc = processes.value.find((p) => p.processId === processId);
      if (proc) {
        proc.status = status as ProcessInfo['status'];
        proc.exitCode = exitCode;
      }
    })
  );

  fetchProcessList();
}

async function fetchProcessList(): Promise<void> {
  try {
    const baseUrl = configManager.getBaseUrl();
    const res = await fetch(`${baseUrl}/gateway/processes`);
    if (res.ok) {
      const data = await res.json();
      processes.value = data.processes || [];
    }
  } catch {
    // Silent fail on startup
  }
}

export function refreshProcessList(): void {
  fetchProcessList();
}

export function cleanupProcessWs(): void {
  for (const fn of cleanups) fn();
  cleanups = [];
  initialized = false;
}
