/**
 * Agent Home HTTP 路由
 *
 * 为 Agent 持久化 Home 目录提供文件管理 REST API。
 * 挂载到 GatewayServer 的 Koa Router（prefix = /gateway），最终路径：
 *
 *   GET    /gateway/agents/homes              — 列出所有有 Home 的 Agent
 *   GET    /gateway/agents/:id/home/files     — 列出 Agent Home 下的文件
 *   GET    /gateway/agents/:id/home/file      — 读取指定文件内容
 *   PUT    /gateway/agents/:id/home/file      — 写入/更新文件
 *   DELETE /gateway/agents/:id/home/file      — 删除指定文件
 *
 * 安全：路径穿越防护 + 仅允许 .md 文件操作
 */

import fs from 'node:fs';
import path from 'node:path';
import type Router from '@koa/router';
import { createLogger } from '@main/common/logger';
import { Env } from '@main/common/env';
import { AgentStore } from '@main/ai/agents/AgentStore';

const log = createLogger('gateway-http-agent-home');

/**
 * 校验文件名安全性：
 * - 解析后不能逃出 homeDir
 * - 必须是 .md 文件
 */
function validateFileName(name: string, homeDir: string): { safe: boolean; resolved: string; error?: string } {
  if (!name || typeof name !== 'string') {
    return { safe: false, resolved: '', error: 'Missing file name' };
  }

  const resolved = path.resolve(homeDir, name);
  const resolvedHome = path.resolve(homeDir);

  const rel = path.relative(resolvedHome, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { safe: false, resolved, error: 'Path traversal denied' };
  }

  if (!resolved.endsWith('.md')) {
    return { safe: false, resolved, error: 'Only .md files are allowed' };
  }

  return { safe: true, resolved };
}

export function registerAgentHomeRoutes(router: Router): void {
  // ==================== LIST HOMES ====================

  router.get('/agents/homes', async (ctx) => {
    try {
      const homesDir = Env.paths.homesDir;
      if (!fs.existsSync(homesDir)) {
        ctx.body = { homes: [] };
        return;
      }

      const store = await AgentStore.getInstance();
      const agents = await store.list();
      const agentMap = new Map(agents.map((a) => [a.id, a.name]));

      const entries = fs.readdirSync(homesDir, { withFileTypes: true });
      const homes = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => ({
          id: e.name,
          name: agentMap.get(e.name) || e.name
        }));

      ctx.body = { homes };
    } catch (err) {
      log.error('[agent-home.listHomes] Error:', err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ==================== LIST FILES ====================

  router.get('/agents/:id/home/files', async (ctx) => {
    const agentId = ctx.params.id;
    if (!agentId) {
      ctx.status = 400;
      ctx.body = { error: 'agentId is required' };
      return;
    }

    try {
      const homeDir = path.join(Env.paths.homesDir, agentId);
      if (!fs.existsSync(homeDir)) {
        ctx.status = 404;
        ctx.body = { error: `Agent home "${agentId}" not found` };
        return;
      }

      interface FileInfo {
        name: string;
        size: number;
        mtime: string;
        category: 'config' | 'memory';
      }

      const files: FileInfo[] = [];

      // 扫描根目录的配置文件
      for (const entry of fs.readdirSync(homeDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        const fullPath = path.join(homeDir, entry.name);
        const stat = fs.statSync(fullPath);
        files.push({
          name: entry.name,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          category: 'config'
        });
      }

      // 扫描 memory/ 子目录
      const memoryDir = path.join(homeDir, 'memory');
      if (fs.existsSync(memoryDir)) {
        for (const entry of fs.readdirSync(memoryDir, { withFileTypes: true })) {
          if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
          const fullPath = path.join(memoryDir, entry.name);
          const stat = fs.statSync(fullPath);
          files.push({
            name: `memory/${entry.name}`,
            size: stat.size,
            mtime: stat.mtime.toISOString(),
            category: 'memory'
          });
        }
      }

      // 记忆文件按日期倒序
      const configFiles = files.filter((f) => f.category === 'config');
      const memoryFiles = files.filter((f) => f.category === 'memory').sort((a, b) => b.name.localeCompare(a.name));

      ctx.body = { files: [...configFiles, ...memoryFiles] };
    } catch (err) {
      log.error(`[agent-home.listFiles] Error (${agentId}):`, err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ==================== READ FILE ====================

  router.get('/agents/:id/home/file', async (ctx) => {
    const agentId = ctx.params.id;
    const fileName = ctx.query.name as string | undefined;

    if (!agentId) {
      ctx.status = 400;
      ctx.body = { error: 'agentId is required' };
      return;
    }

    const homeDir = path.join(Env.paths.homesDir, agentId);
    const validation = validateFileName(fileName || '', homeDir);
    if (!validation.safe) {
      ctx.status = 400;
      ctx.body = { error: validation.error };
      return;
    }

    try {
      if (!fs.existsSync(validation.resolved)) {
        ctx.status = 404;
        ctx.body = { error: 'File not found' };
        return;
      }

      const content = fs.readFileSync(validation.resolved, 'utf-8');
      const stat = fs.statSync(validation.resolved);

      ctx.body = {
        name: fileName,
        content,
        size: stat.size,
        mtime: stat.mtime.toISOString()
      };
    } catch (err) {
      log.error(`[agent-home.readFile] Error (${agentId}/${fileName}):`, err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ==================== WRITE FILE ====================

  router.put('/agents/:id/home/file', async (ctx) => {
    const agentId = ctx.params.id;
    if (!agentId) {
      ctx.status = 400;
      ctx.body = { error: 'agentId is required' };
      return;
    }

    const body = ctx.request.body as Record<string, unknown> | undefined;
    const fileName = body?.name as string | undefined;
    const content = body?.content as string | undefined;

    if (!fileName || content === undefined || content === null) {
      ctx.status = 400;
      ctx.body = { error: 'name and content are required' };
      return;
    }

    const homeDir = path.join(Env.paths.homesDir, agentId);
    const validation = validateFileName(fileName, homeDir);
    if (!validation.safe) {
      ctx.status = 400;
      ctx.body = { error: validation.error };
      return;
    }

    try {
      // 确保父目录存在
      const parentDir = path.dirname(validation.resolved);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      fs.writeFileSync(validation.resolved, content, 'utf-8');

      ctx.body = { name: fileName, saved: true };
    } catch (err) {
      log.error(`[agent-home.writeFile] Error (${agentId}/${fileName}):`, err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ==================== DELETE FILE ====================

  router.delete('/agents/:id/home/file', async (ctx) => {
    const agentId = ctx.params.id;
    const fileName = ctx.query.name as string | undefined;

    if (!agentId) {
      ctx.status = 400;
      ctx.body = { error: 'agentId is required' };
      return;
    }

    const homeDir = path.join(Env.paths.homesDir, agentId);
    const validation = validateFileName(fileName || '', homeDir);
    if (!validation.safe) {
      ctx.status = 400;
      ctx.body = { error: validation.error };
      return;
    }

    try {
      if (!fs.existsSync(validation.resolved)) {
        ctx.status = 404;
        ctx.body = { error: 'File not found' };
        return;
      }

      fs.unlinkSync(validation.resolved);
      ctx.body = { name: fileName, deleted: true };
    } catch (err) {
      log.error(`[agent-home.deleteFile] Error (${agentId}/${fileName}):`, err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  log.info('[agent-home] HTTP routes registered');
}
