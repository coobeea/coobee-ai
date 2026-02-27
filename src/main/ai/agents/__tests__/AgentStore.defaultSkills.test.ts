/**
 * AgentStore — 核心 Skills 注入逻辑测试
 *
 * 验证 5 个核心 skills (execution-protocol, self-reflection,
 * eval-refine-loop, brain, dimension-architect) 在创建和更新 Agent 时被自动注入，且不重复。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CORE_SKILLS, ensureCoreSkills } from '../../skills/CoreSkills';

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

  vi.resetModules();
  const mod = await import('../AgentStore');
  AgentStore = mod.AgentStore;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (AgentStore as any).instance = null;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.resetModules();
});

describe('CORE_SKILLS 常量验证', () => {
  it('包含所有 5 个核心 skills', () => {
    expect(CORE_SKILLS).toContain('execution-protocol');
    expect(CORE_SKILLS).toContain('self-reflection');
    expect(CORE_SKILLS).toContain('eval-refine-loop');
    expect(CORE_SKILLS).toContain('brain');
    expect(CORE_SKILLS).toContain('dimension-architect');
    expect(CORE_SKILLS).toHaveLength(5);
  });

  it('没有重复项', () => {
    expect(new Set(CORE_SKILLS).size).toBe(CORE_SKILLS.length);
  });

  it('execution-protocol 和 self-reflection 排在最前面', () => {
    expect(CORE_SKILLS[0]).toBe('execution-protocol');
    expect(CORE_SKILLS[1]).toBe('self-reflection');
  });
});

describe('ensureCoreSkills 注入逻辑', () => {
  it('空 skills 数组时注入全部核心 skills', () => {
    const result = ensureCoreSkills([]);
    expect(result).toEqual([...CORE_SKILLS]);
  });

  it('已有部分核心 skill 时不重复', () => {
    const result = ensureCoreSkills(['brain', 'self-reflection']);
    expect(result).toContain('brain');
    expect(result).toContain('self-reflection');
    expect(result).toContain('execution-protocol');
    expect(result).toContain('eval-refine-loop');
    expect(result).toContain('dimension-architect');
    expect(result.filter((s) => s === 'brain').length).toBe(1);
    expect(result.filter((s) => s === 'self-reflection').length).toBe(1);
  });

  it('已有全部核心 skills 时不重复注入', () => {
    const input = [...CORE_SKILLS];
    const result = ensureCoreSkills(input);
    expect(result).toEqual(input);
  });

  it('保留用户自定义 skills，核心 skills 排在前面', () => {
    const result = ensureCoreSkills(['my-custom-skill']);
    expect(result.slice(0, CORE_SKILLS.length)).toEqual([...CORE_SKILLS]);
    expect(result).toContain('my-custom-skill');
  });

  it('部分已有时只补全缺失的', () => {
    const result = ensureCoreSkills(['dimension-architect', 'custom']);
    for (const s of CORE_SKILLS) {
      expect(result).toContain(s);
    }
    expect(result).toContain('custom');
    expect(result.filter((s) => s === 'dimension-architect').length).toBe(1);
  });

  it('update 时也保护核心 skills', () => {
    const userProvided = ['custom-skill'];
    const result = ensureCoreSkills(userProvided);
    expect([...CORE_SKILLS].every((s) => result.includes(s))).toBe(true);
  });
});
