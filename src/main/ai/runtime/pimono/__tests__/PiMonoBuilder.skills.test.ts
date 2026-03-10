/**
 * PiMonoBuilder — skills() 方法去重测试
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }),
  log: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock('@main/common/env', () => ({
  Env: { paths: {} }
}));

import { PiMonoBuilder } from '../PiMonoBuilder';
import type { SkillDefinition } from '../../types';

function makeSkill(name: string): SkillDefinition {
  return { name, description: `${name} desc`, content: `${name} content` };
}

describe('PiMonoBuilder.skills() deduplication', () => {
  it('单次调用不去重', () => {
    const builder = new PiMonoBuilder();
    builder.skills([makeSkill('brain'), makeSkill('eval-refine-loop')]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const skills = (builder as any)._skills as SkillDefinition[];
    expect(skills).toHaveLength(2);
  });

  it('多次调用同名 skill 只保留首次', () => {
    const builder = new PiMonoBuilder();
    builder.skills([makeSkill('brain')]);
    builder.skills([makeSkill('brain'), makeSkill('eval-refine-loop')]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const skills = (builder as any)._skills as SkillDefinition[];
    expect(skills).toHaveLength(2);
    expect(skills.map((s) => s.name)).toEqual(['brain', 'eval-refine-loop']);
  });

  it('不同名 skill 正常累加', () => {
    const builder = new PiMonoBuilder();
    builder.skills([makeSkill('brain')]);
    builder.skills([makeSkill('self-reflection')]);
    builder.skills([makeSkill('execution-protocol')]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const skills = (builder as any)._skills as SkillDefinition[];
    expect(skills).toHaveLength(3);
  });

  it('完全重复的批次不增加任何 skill', () => {
    const builder = new PiMonoBuilder();
    const batch = [makeSkill('brain'), makeSkill('eval-refine-loop')];
    builder.skills(batch);
    builder.skills(batch);
    builder.skills(batch);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const skills = (builder as any)._skills as SkillDefinition[];
    expect(skills).toHaveLength(2);
  });

  it('混合场景：AgentStore skills + injectEnv core skills', () => {
    const builder = new PiMonoBuilder();
    builder.skills([makeSkill('brain'), makeSkill('dimension-architect'), makeSkill('eval-refine-loop')]);
    builder.skills([
      makeSkill('execution-protocol'),
      makeSkill('self-reflection'),
      makeSkill('eval-refine-loop'),
      makeSkill('brain'),
      makeSkill('dimension-architect')
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const skills = (builder as any)._skills as SkillDefinition[];
    expect(skills).toHaveLength(5);
    expect(skills.map((s) => s.name)).toEqual([
      'brain',
      'dimension-architect',
      'eval-refine-loop',
      'execution-protocol',
      'self-reflection'
    ]);
  });
});
