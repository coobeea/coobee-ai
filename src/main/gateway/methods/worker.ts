/**
 * Gateway Worker 方法组
 *
 * 方法：
 *   worker.list       — 获取所有 Worker 状态
 *   worker.start      — 启动指定 Worker
 *   worker.stop       — 停止指定 Worker
 *   worker.configGet  — 获取 Worker 的 local_config.json
 *   worker.configUpdate — 更新 Worker 的 local_config.json（合并写入）
 */

import fs from 'node:fs';
import path from 'node:path';
import { log } from '@main/common/logger';
import { Env } from '@main/common/env';
import { WorkerManager } from '@main/common/worker';
import { GatewayErrorCode, GatewayMethodError } from '../protocol';
import type { MethodGroup } from '../protocol';

function getLocalConfigPath(workerName: string): string {
  return path.join(Env.paths.workersDir, workerName, 'local_config.json');
}

function readLocalConfig(workerName: string): Record<string, unknown> {
  const configPath = getLocalConfigPath(workerName);
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeLocalConfig(workerName: string, config: Record<string, unknown>): void {
  const configPath = getLocalConfigPath(workerName);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

export const workerMethods: MethodGroup = {
  namespace: 'worker',
  methods: {
    list: async () => {
      const allWorkers = WorkerManager.getInstance().getAllWorkerInfo();

      // 转换为前端期望的格式
      const workers = allWorkers.map((w) => ({
        name: w.name,
        label: w.label,
        running: w.status === 'ready' || w.status === 'starting',
        healthy: w.status === 'ready',
        port: w.port,
        pid: w.pid,
        uptime: w.metrics?.uptimeSeconds ? w.metrics.uptimeSeconds * 1000 : undefined,
        error: w.error,
        status: w.status
      }));

      return { workers };
    },

    start: async (params) => {
      const { name } = params as { name?: string };
      if (!name) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'Worker name is required');
      }

      log.info(`[worker.start] Starting worker: ${name}`);
      try {
        await WorkerManager.getInstance().start(name);
        return { ok: true, name };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        log.error(`[worker.start] Failed: ${name}`, error);
        throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, msg);
      }
    },

    stop: async (params) => {
      const { name } = params as { name?: string };
      if (!name) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'Worker name is required');
      }

      log.info(`[worker.stop] Stopping worker: ${name}`);
      try {
        await WorkerManager.getInstance().stop(name);
        return { ok: true, name };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        log.error(`[worker.stop] Failed: ${name}`, error);
        throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, msg);
      }
    },

    configGet: async (params) => {
      const { name } = params as { name?: string };
      if (!name) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'Worker name is required');
      }

      const workerDir = path.join(Env.paths.workersDir, name);
      if (!fs.existsSync(workerDir)) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, `Worker "${name}" not found`);
      }

      const config = readLocalConfig(name);
      log.info(`[worker.configGet] ${name}:`, JSON.stringify(config));
      return { name, config };
    },

    configUpdate: async (params) => {
      const { name, config: updates } = params as { name?: string; config?: Record<string, unknown> };
      if (!name) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'Worker name is required');
      }
      if (!updates || typeof updates !== 'object') {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'config object is required');
      }

      const workerDir = path.join(Env.paths.workersDir, name);
      if (!fs.existsSync(workerDir)) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, `Worker "${name}" not found`);
      }

      const existing = readLocalConfig(name);
      const merged = { ...existing, ...updates };
      writeLocalConfig(name, merged);

      log.info(`[worker.configUpdate] ${name}: updated`, JSON.stringify(merged));
      return { name, config: merged };
    }
  }
};
