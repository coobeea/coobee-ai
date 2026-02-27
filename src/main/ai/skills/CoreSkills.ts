/**
 * 核心技能常量与加载工具
 *
 * 定义所有智能体（包括子智能体）必须常驻的核心技能，
 * 并提供统一的加载函数供动态创建的 Agent 使用。
 *
 * 核心技能：
 *   - execution-protocol: 五步工作法执行协议，任务分解与目标管理
 *   - self-reflection:    自我评估与修复方法论，质量闭环保障
 *   - eval-refine-loop:   维度化评估与自动优化闭环
 *   - brain:              知识库搜索与经验沉淀
 *   - dimension-architect: 需求维度量化拆解
 */

import { createLogger } from '@main/common/logger';
import { SkillManager } from './SkillManager';
import type { SkillDefinition } from '../runtime/types';

const log = createLogger('core-skills');

/**
 * 所有智能体必须常驻的核心技能名称
 *
 * 注入顺序：执行协议 → 自我评估 → 质量闭环 → 知识库 → 维度量化
 */
export const CORE_SKILLS = [
  'execution-protocol',
  'self-reflection',
  'eval-refine-loop',
  'brain',
  'dimension-architect'
] as const;

/**
 * 确保 skills 数组包含所有核心技能（用于 AgentStore create/update）
 *
 * 核心技能排在最前面，用户自定义技能追加在后。
 */
export function ensureCoreSkills(skills: string[]): string[] {
  const result = [...skills];
  for (const s of [...CORE_SKILLS].reverse()) {
    if (!result.includes(s)) {
      result.unshift(s);
    }
  }
  return result;
}

/**
 * 加载核心技能定义（用于动态创建的子 Agent）
 *
 * 从 builtin + user 技能目录扫描并过滤出核心技能。
 * 结果可直接传给 builder.skills()。
 */
export function loadCoreSkillDefinitions(): SkillDefinition[] {
  try {
    // 延迟 require 避免循环依赖
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Env } = require('@main/common/env');
    const searchPaths = [Env.paths.builtinSkillsDir, Env.paths.userSkillsDir];
    const secretsDir = Env.paths.secretsDir;

    const manager = new SkillManager();
    manager.scanSkills(searchPaths, secretsDir);

    const result: SkillDefinition[] = [];
    for (const name of CORE_SKILLS) {
      const skill = manager.getByName(name);
      if (skill) {
        result.push(skill);
      } else {
        log.warn(`[CoreSkills] Core skill not found: ${name}`);
      }
    }

    log.info(`[CoreSkills] Loaded ${result.length}/${CORE_SKILLS.length} core skills`);
    return result;
  } catch (err) {
    log.error('[CoreSkills] Failed to load core skills:', err);
    return [];
  }
}
