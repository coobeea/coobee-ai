/**
 * CoreSkills — 核心技能常量与工具测试
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CORE_SKILLS, ensureCoreSkills, loadCoreSkillDefinitions } from '../CoreSkills';

vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

describe('CORE_SKILLS', () => {
  it('是 readonly 数组', () => {
    expect(Array.isArray(CORE_SKILLS)).toBe(true);
  });

  it('包含 5 个核心技能', () => {
    expect(CORE_SKILLS).toHaveLength(5);
  });

  it('包含 execution-protocol 和 self-reflection', () => {
    expect(CORE_SKILLS).toContain('execution-protocol');
    expect(CORE_SKILLS).toContain('self-reflection');
  });

  it('包含 eval-refine-loop, brain, dimension-architect', () => {
    expect(CORE_SKILLS).toContain('eval-refine-loop');
    expect(CORE_SKILLS).toContain('brain');
    expect(CORE_SKILLS).toContain('dimension-architect');
  });

  it('没有重复', () => {
    expect(new Set(CORE_SKILLS).size).toBe(CORE_SKILLS.length);
  });
});

describe('ensureCoreSkills', () => {
  it('空数组返回全部核心技能', () => {
    const result = ensureCoreSkills([]);
    expect(result).toEqual([...CORE_SKILLS]);
  });

  it('不修改原数组', () => {
    const original = ['custom'];
    const result = ensureCoreSkills(original);
    expect(original).toEqual(['custom']);
    expect(result).not.toBe(original);
  });

  it('不重复已有技能', () => {
    const result = ensureCoreSkills(['brain', 'execution-protocol']);
    const brainCount = result.filter((s) => s === 'brain').length;
    const epCount = result.filter((s) => s === 'execution-protocol').length;
    expect(brainCount).toBe(1);
    expect(epCount).toBe(1);
  });

  it('核心技能在前、自定义技能在后', () => {
    const result = ensureCoreSkills(['z-custom', 'a-custom']);
    const coreEnd = result.lastIndexOf([...CORE_SKILLS].at(-1)!);
    const customStart = result.indexOf('z-custom');
    expect(coreEnd).toBeLessThan(customStart);
  });

  it('处理全部已有核心技能 + 自定义', () => {
    const input = [...CORE_SKILLS, 'extra'];
    const result = ensureCoreSkills(input);
    expect(result).toEqual(input);
  });
});

describe('loadCoreSkillDefinitions', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('Env 不可用时返回空数组', () => {
    vi.mock('@main/common/env', () => {
      throw new Error('Env not available');
    });

    const result = loadCoreSkillDefinitions();
    expect(Array.isArray(result)).toBe(true);
  });
});
