/**
 * Skills HTTP 路由
 *
 * 为技能管理提供 HTTP 端点。
 *
 * 端点：
 *   GET    /gateway/skills           — 列出所有可用技能（name + description + source）
 *   POST   /gateway/skills/import    — 导入技能（从本地路径复制到 userSkillsDir）
 *   POST   /gateway/skills/ai-create — AI 驱动创建技能（SSE 流式进度）
 *   DELETE /gateway/skills/:name     — 删除用户技能
 *
 * 技能来源（按优先级从低到高）：
 *   1. builtinSkillsDir — 内置技能
 *   2. userSkillsDir — 用户技能
 *
 * 扫描逻辑复用 SkillManager，但不依赖 Agent 会话上下文。
 */

import fs from 'fs';
import path from 'path';
import type Router from '@koa/router';
import { createLogger } from '@main/common/logger';
import { SkillManager } from '@main/ai/skills';
import { aiCreateSkill } from '@main/ai/services/SkillCreatorService';

const log = createLogger('gateway-http-skills');

/** 技能摘要（返回给前端的精简信息） */
interface SkillSummary {
  name: string;
  description: string;
  source?: 'builtin' | 'user';
  filePath?: string;
}

/** 获取 Env（延迟导入，避免循环依赖） */
async function getEnv(): Promise<typeof import('@main/common/env').Env> {
  const { Env } = await import('@main/common/env');
  return Env;
}

export function registerSkillRoutes(router: Router): void {
  // ==================== LIST ====================

  router.get('/skills', async (ctx) => {
    try {
      const Env = await getEnv();
      const searchPaths = await Env.getSkillSearchPaths();

      const manager = new SkillManager();
      const allSkills = manager.scanSkills(searchPaths, Env.paths.configDir);

      const builtinDir = Env.paths.builtinSkillsDir;
      const userDir = Env.paths.userSkillsDir;

      const skills: SkillSummary[] = allSkills.map((s) => {
        let source: 'builtin' | 'user' = 'builtin';
        if (s.filePath && s.filePath.startsWith(userDir)) {
          source = 'user';
        } else if (s.filePath && !s.filePath.startsWith(builtinDir)) {
          source = 'user';
        }

        return {
          name: s.name,
          description: s.description,
          source,
          filePath: s.filePath
        };
      });

      ctx.body = { skills };
    } catch (err) {
      log.error('[skills.list] Error:', err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ==================== IMPORT ====================

  router.post('/skills/import', async (ctx) => {
    try {
      const body = ctx.request.body as { sourcePath?: string } | undefined;
      const sourcePath = body?.sourcePath;

      if (!sourcePath) {
        ctx.status = 400;
        ctx.body = { error: '缺少 sourcePath 参数' };
        return;
      }

      // 验证源路径存在
      if (!fs.existsSync(sourcePath)) {
        ctx.status = 400;
        ctx.body = { error: `路径不存在: ${sourcePath}` };
        return;
      }

      const Env = await getEnv();
      const userSkillsDir = Env.paths.userSkillsDir;

      // 确保用户技能目录存在
      if (!fs.existsSync(userSkillsDir)) {
        fs.mkdirSync(userSkillsDir, { recursive: true });
      }

      const stat = fs.statSync(sourcePath);

      if (stat.isDirectory()) {
        // 导入整个目录（如 my-skill/ → userSkillsDir/my-skill/）
        const skillMdPath = path.join(sourcePath, 'SKILL.md');
        if (!fs.existsSync(skillMdPath)) {
          ctx.status = 400;
          ctx.body = { error: '目录中未找到 SKILL.md 文件' };
          return;
        }

        const dirName = path.basename(sourcePath);
        const targetDir = path.join(userSkillsDir, dirName);

        // 递归复制目录
        copyDirSync(sourcePath, targetDir);

        // 清除缓存
        SkillManager.invalidateCache();

        ctx.body = { success: true, skillDir: targetDir };
      } else if (stat.isFile() && path.basename(sourcePath) === 'SKILL.md') {
        // 导入单个 SKILL.md 文件
        const dirName = path.basename(path.dirname(sourcePath));
        const targetDir = path.join(userSkillsDir, dirName);

        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        fs.copyFileSync(sourcePath, path.join(targetDir, 'SKILL.md'));

        SkillManager.invalidateCache();

        ctx.body = { success: true, skillDir: targetDir };
      } else {
        ctx.status = 400;
        ctx.body = { error: '请提供技能目录路径或 SKILL.md 文件路径' };
      }
    } catch (err) {
      log.error('[skills.import] Error:', err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ==================== AI CREATE (SSE) ====================

  router.post('/skills/ai-create', async (ctx) => {
    const body = ctx.request.body as { requirement?: string } | undefined;
    const requirement = body?.requirement?.trim();

    if (!requirement) {
      ctx.status = 400;
      ctx.body = { error: '缺少 requirement 参数' };
      return;
    }

    // 设置 SSE 响应头
    ctx.set('Content-Type', 'text/event-stream');
    ctx.set('Cache-Control', 'no-cache');
    ctx.set('Connection', 'keep-alive');
    ctx.status = 200;

    const stream = ctx.res;
    stream.flushHeaders?.();

    const sendEvent = (event: string, data: unknown): void => {
      stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const Env = await getEnv();
      const userSkillsDir = Env.paths.userSkillsDir;

      // 确保用户技能目录存在
      if (!fs.existsSync(userSkillsDir)) {
        fs.mkdirSync(userSkillsDir, { recursive: true });
      }

      const result = await aiCreateSkill(requirement, userSkillsDir, (progress) => {
        sendEvent('progress', progress);
      });

      sendEvent('result', result);
    } catch (err) {
      log.error('[skills.ai-create] Error:', err);
      sendEvent('error', {
        error: err instanceof Error ? err.message : String(err)
      });
    } finally {
      stream.end();
    }

    // 阻止 Koa 再次写入 body
    ctx.respond = false;
  });

  // ==================== DELETE ====================

  router.delete('/skills/:name', async (ctx) => {
    try {
      const skillName = ctx.params.name;

      if (!skillName) {
        ctx.status = 400;
        ctx.body = { error: '缺少技能名称' };
        return;
      }

      const Env = await getEnv();
      const userSkillsDir = Env.paths.userSkillsDir;

      // 先扫描获取完整信息
      const searchPaths = await Env.getSkillSearchPaths();
      const manager = new SkillManager();
      const allSkills = manager.scanSkills(searchPaths, Env.paths.configDir);

      const skill = allSkills.find((s) => s.name === skillName);

      if (!skill || !skill.filePath) {
        ctx.status = 404;
        ctx.body = { error: `技能 "${skillName}" 不存在` };
        return;
      }

      // 检查是否在用户目录下（只允许删除用户技能）
      if (!skill.filePath.startsWith(userSkillsDir)) {
        ctx.status = 403;
        ctx.body = { error: '内置技能不可删除' };
        return;
      }

      // 删除技能目录
      const skillDir = path.dirname(skill.filePath);
      fs.rmSync(skillDir, { recursive: true, force: true });

      // 清除缓存
      SkillManager.invalidateCache();

      log.info(`[skills.delete] 已删除技能: ${skillName} (${skillDir})`);

      ctx.body = { success: true, name: skillName };
    } catch (err) {
      log.error('[skills.delete] Error:', err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  log.info('[skills] HTTP routes registered');
}

// ==================== 辅助函数 ====================

/** 递归复制目录 */
function copyDirSync(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
