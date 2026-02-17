/**
 * Skills HTTP 路由
 *
 * 为技能管理提供 HTTP 端点。
 *
 * 端点：
 *   GET /gateway/skills — 列出所有可用技能（name + description）
 *
 * 技能来源（按优先级从低到高）：
 *   1. builtinSkillsDir — 内置技能
 *   2. userSkillsDir — 用户技能
 *
 * 扫描逻辑复用 SkillManager，但不依赖 Agent 会话上下文。
 */

import type Router from '@koa/router';
import { createLogger } from '@main/common/logger';
import { SkillManager } from '@main/ai/skills';

const log = createLogger('gateway-http-skills');

/** 技能摘要（返回给前端的精简信息） */
interface SkillSummary {
  name: string;
  description: string;
}

export function registerSkillRoutes(router: Router): void {
  // ==================== LIST ====================

  router.get('/skills', async (ctx) => {
    try {
      // 获取技能搜索路径（不需要 workspace，只用全局的内置 + 用户路径）
      const { Env } = await import('@main/common/env');
      const searchPaths = await Env.getSkillSearchPaths();

      // 扫描所有技能
      const manager = new SkillManager();
      const allSkills = manager.scanSkills(searchPaths, Env.paths.configDir);

      // 返回精简列表
      const skills: SkillSummary[] = allSkills.map((s) => ({
        name: s.name,
        description: s.description
      }));

      ctx.body = { skills };
    } catch (err) {
      log.error('[skills.list] Error:', err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  log.info('[skills] HTTP routes registered');
}
