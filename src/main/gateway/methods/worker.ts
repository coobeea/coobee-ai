/**
 * Gateway Worker 方法组
 *
 * 方法：
 *   worker.list         — 获取所有 Worker 状态
 *   worker.start        — 启动指定 Worker
 *   worker.stop         — 停止指定 Worker
 *   worker.configGet    — 获取 Worker 的 local_config.json
 *   worker.configUpdate — 更新 Worker 的 local_config.json（合并写入）
 *   worker.modelsGet    — 获取 Worker 的 models.json（可选模型列表）
 */

import fs from 'node:fs';
import path from 'node:path';
import { log } from '@main/common/logger';
import { Env } from '@main/common/env';
import { WorkerManager } from '@main/common/worker';
import { GatewayErrorCode, GatewayMethodError } from '../protocol';
import type { MethodGroup } from '../protocol';

const WORKER_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const SENSITIVE_KEYS = new Set(['api_key', 'password', 'secret', 'token']);

function validateWorkerName(name: unknown): asserts name is string {
  if (!name || typeof name !== 'string') {
    throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'Worker name is required');
  }
  if (!WORKER_NAME_RE.test(name)) {
    throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'Worker name must be 1-64 chars of [a-zA-Z0-9_-]');
  }
}

function getLocalConfigPath(workerName: string): string {
  const resolved = path.resolve(Env.paths.workersDir, workerName, 'local_config.json');
  const base = path.resolve(Env.paths.workersDir);
  if (!resolved.startsWith(base + path.sep)) {
    throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'Invalid worker name');
  }
  return resolved;
}

function readLocalConfig(workerName: string): Record<string, unknown> {
  const configPath = getLocalConfigPath(workerName);
  if (!fs.existsSync(configPath)) return {};
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch (err) {
    log.warn(`[worker] Failed to read config for ${workerName}:`, err);
    return {};
  }
}

function writeLocalConfig(workerName: string, config: Record<string, unknown>): void {
  const configPath = getLocalConfigPath(workerName);
  const content = JSON.stringify(config, null, 2) + '\n';
  const tmpPath = configPath + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, configPath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* ignore cleanup error */
    }
    throw err;
  }
}

function redactConfig(config: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (SENSITIVE_KEYS.has(key) && typeof value === 'string' && value.length > 4) {
      result[key] = value.slice(0, 4) + '****';
    } else {
      result[key] = value;
    }
  }
  return result;
}

export const workerMethods: MethodGroup = {
  namespace: 'worker',
  methods: {
    list: async () => {
      const allWorkers = WorkerManager.getInstance().getAllWorkerInfo();

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
      validateWorkerName(name);

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
      validateWorkerName(name);

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
      validateWorkerName(name);

      const workerDir = path.join(Env.paths.workersDir, name);
      if (!fs.existsSync(workerDir)) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, `Worker "${name}" not found`);
      }

      const config = readLocalConfig(name);
      log.info(`[worker.configGet] ${name}:`, JSON.stringify(redactConfig(config)));
      return { name, config };
    },

    modelsGet: async (params) => {
      const { name } = params as { name?: string };
      validateWorkerName(name);

      const modelsFile = path.join(Env.paths.workersDir, name, 'models.json');
      if (!fs.existsSync(modelsFile)) {
        return { name, models: null };
      }

      try {
        const raw = fs.readFileSync(modelsFile, 'utf-8');
        const models = JSON.parse(raw);
        return { name, models };
      } catch (err) {
        log.warn(`[worker.modelsGet] Failed to read models.json for ${name}:`, err);
        return { name, models: null };
      }
    },

    configUpdate: async (params) => {
      const { name, config: updates } = params as {
        name?: string;
        config?: Record<string, unknown>;
      };
      validateWorkerName(name);

      if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'config must be a plain object');
      }

      const workerDir = path.join(Env.paths.workersDir, name);
      if (!fs.existsSync(workerDir)) {
        throw new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, `Worker "${name}" not found`);
      }

      try {
        const existing = readLocalConfig(name);
        const merged = { ...existing, ...updates };
        writeLocalConfig(name, merged);

        log.info(`[worker.configUpdate] ${name}: updated`, JSON.stringify(redactConfig(merged)));

        let restarted = false;
        const wm = WorkerManager.getInstance();
        const info = wm.getWorkerInfo(name);
        if (info && (info.status === 'ready' || info.status === 'starting')) {
          const modelChanged = updates.model_name !== undefined && existing.model_name !== updates.model_name;
          const apiChanged = updates.api_key !== undefined && existing.api_key !== updates.api_key;
          if (modelChanged || apiChanged) {
            log.info(`[worker.configUpdate] ${name}: key config changed, restarting...`);
            try {
              await wm.stop(name);
              await wm.start(name);
              restarted = true;
              log.info(`[worker.configUpdate] ${name}: restarted successfully`);
            } catch (err) {
              log.warn(`[worker.configUpdate] ${name}: auto-restart failed:`, err);
            }
          }
        }

        return { name, config: merged, restarted };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        log.error(`[worker.configUpdate] Failed to write config for ${name}:`, error);
        throw new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR, `Failed to save config: ${msg}`);
      }
    }
  }
};
