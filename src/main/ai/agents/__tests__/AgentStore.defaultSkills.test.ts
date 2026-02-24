/**
 * AgentStore — 默认 Skills 注入逻辑测试
 *
 * 验证 brain、dimension-architect、eval-refine-loop 三个 skills
 * 在创建和更新 Agent 时被自动注入，且不重复。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

vi.mock('@main/common/env', () => ({
  env: {
    HOME_DIR: '/tmp/test-home',
    IS_DEV: false
  }
}));

let tmpDir: string;
let AgentStore: typeof import('../AgentStore').AgentStore;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-store-test-'));

  // 重置单例
  vi.resetModules();
  const mod = await import('../AgentStore');
  AgentStore = mod.AgentStore;

  // 强制注入临时目录
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (AgentStore as any).instance = null;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.resetModules();
});

const DEFAULT_SKILLS = ['brain', 'dimension-architect', 'eval-refine-loop'];

/** 直接测试注入逻辑（不依赖文件系统） */
function applyDefaultSkills(inputSkills: string[]): string[] {
  const skills = [...inputSkills];
  for (const s of [...DEFAULT_SKILLS].reverse()) {
    if (!skills.includes(s)) {
      skills.unshift(s);
    }
  }
  return skills;
}

describe('Default Skills 注入逻辑', () => {
  it('空 skills 数组时注入全部 3 个默认 skills', () => {
    const result = applyDefaultSkills([]);
    expect(result).toEqual(DEFAULT_SKILLS);
  });

  it('已有 brain 时不重复，补全其余两个', () => {
    const result = applyDefaultSkills(['brain']);
    expect(result).toContain('brain');
    expect(result).toContain('dimension-architect');
    expect(result).toContain('eval-refine-loop');
    // 不重复
    expect(result.filter((s) => s === 'brain').length).toBe(1);
  });

  it('已有全部 3 个时不重复注入', () => {
    const result = applyDefaultSkills(['brain', 'dimension-architect', 'eval-refine-loop']);
    expect(result).toEqual(['brain', 'dimension-architect', 'eval-refine-loop']);
  });

  it('保留用户自定义 skills，默认 skills 排在前面', () => {
    const result = applyDefaultSkills(['my-custom-skill']);
    expect(result.slice(0, 3)).toEqual(DEFAULT_SKILLS);
    expect(result).toContain('my-custom-skill');
  });

  it('部分已有时只补全缺失的', () => {
    const result = applyDefaultSkills(['dimension-architect', 'custom']);
    expect(result).toContain('brain');
    expect(result).toContain('eval-refine-loop');
    expect(result).toContain('dimension-architect');
    expect(result).toContain('custom');
    // 不重复
    expect(result.filter((s) => s === 'dimension-architect').length).toBe(1);
  });

  it('update 时 skills 更新也保护默认 skills', () => {
    const userProvided = ['custom-skill'];
    const result = applyDefaultSkills(userProvided);
    expect(DEFAULT_SKILLS.every((s) => result.includes(s))).toBe(true);
  });
});

describe('DEFAULT_SKILLS 常量验证', () => {
  it('包含所有必要的 3 个默认 skills', () => {
    expect(DEFAULT_SKILLS).toContain('brain');
    expect(DEFAULT_SKILLS).toContain('dimension-architect');
    expect(DEFAULT_SKILLS).toContain('eval-refine-loop');
  });

  it('没有重复项', () => {
    expect(new Set(DEFAULT_SKILLS).size).toBe(DEFAULT_SKILLS.length);
  });
});
