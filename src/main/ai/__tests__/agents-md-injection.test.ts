/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AGENTS.md 协议文件注入测试
 *
 * 测试覆盖：
 *   1. 全局 AGENTS.md 存在时正确注入到 appendInstructions
 *   2. 工作空间 AGENTS.md 与全局合并
 *   3. 文件不存在时不注入
 *   4. 内容过长时截断
 *   5. 工作空间初始化时从全局复制
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

vi.mock('@main/common/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

vi.mock('@main/common/env', () => ({
  Env: {
    main: { logLevel: 'info' },
    paths: {
      configDir: '/mock/config',
      userHome: '/mock/home',
      memoryDir: '/mock/memory',
      temp: '/mock/temp',
      agentsMdPath: '' // set in beforeEach
    },
    getAgentWorkspaceDir: vi.fn().mockResolvedValue('/mock/workspace')
  }
}));

import * as agentEnvModule from '../AgentEnv';

vi.mock('../AgentEnv', () => ({
  buildAgentEnv: vi.fn().mockResolvedValue({
    workspace: '/mock/workspace',
    skillPaths: ['/mock/skills'],
    sessionId: 'session-123',
    configDir: '/mock/config',
    userHome: '/mock/home',
    memoryDir: '/mock/memory'
  }),
  formatRuntimePaths: vi.fn().mockReturnValue('<runtime_paths />')
}));

vi.mock('../skills', () => ({
  SkillManager: class {
    size = 0;
    scanSkills = vi.fn();
    getByName = vi.fn().mockReturnValue(undefined);
    static setCurrent = vi.fn();
  }
}));

vi.mock('../skills/CoreSkills', () => ({
  CORE_SKILLS: []
}));

vi.mock('../sandbox', () => ({
  createPathOnlyContext: vi.fn().mockReturnValue({ mode: 'path-only' }),
  resolveSandboxContext: vi.fn()
}));

vi.mock('../agents/AgentStore', () => ({
  AgentStore: {
    getInstance: vi.fn().mockResolvedValue({
      list: vi.fn().mockResolvedValue([])
    })
  }
}));

vi.mock('@main/common/config/ConfigStore', () => ({
  configStoreInstance: null
}));

import { injectEnv } from '../AgentEnvInjector';
import * as envModule from '@main/common/env';

describe('AGENTS.md injection', () => {
  let tmpDir: string;
  let globalAgentsMdPath: string;
  let workspaceDir: string;

  let mockBuilder: any;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-md-test-'));
    globalAgentsMdPath = path.join(tmpDir, 'AGENTS.md');
    workspaceDir = path.join(tmpDir, 'workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, '.runtime', 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, '.runtime', 'contexts'), { recursive: true });

    (envModule.Env.paths as any).agentsMdPath = globalAgentsMdPath;
    (envModule.Env.getAgentWorkspaceDir as any).mockResolvedValue(workspaceDir);

    vi.mocked(agentEnvModule.buildAgentEnv).mockResolvedValue({
      workspace: workspaceDir,
      skillPaths: ['/mock/skills'],
      sessionId: 'session-123',
      configDir: '/mock/config',
      userHome: tmpDir,
      memoryDir: '/mock/memory'
    } as any);

    mockBuilder = {
      getMode: vi.fn().mockReturnValue('agent'),
      getName: vi.fn().mockReturnValue('test-agent'),
      appendInstructions: vi.fn(),
      skills: vi.fn(),
      sandboxContext: vi.fn(),
      sessionDir: vi.fn(),
      workspaceRoot: vi.fn(),
      contextDir: vi.fn()
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should inject global AGENTS.md content into appendInstructions', async () => {
    const content = '# System Identity\n\n- **系统名称**: TestAI';
    fs.writeFileSync(globalAgentsMdPath, content, 'utf-8');

    await injectEnv('session-123', mockBuilder);

    expect(mockBuilder.appendInstructions).toHaveBeenCalled();
    const allArgs = mockBuilder.appendInstructions.mock.calls[0];
    const agentsMdArg = allArgs.find((a: string) => a.includes('<system_agents_md>'));
    expect(agentsMdArg).toBeDefined();
    expect(agentsMdArg).toContain('系统名称');
    expect(agentsMdArg).toContain('TestAI');
    expect(agentsMdArg).toContain('</system_agents_md>');
  });

  it('should not inject when no AGENTS.md files exist', async () => {
    await injectEnv('session-123', mockBuilder);

    expect(mockBuilder.appendInstructions).toHaveBeenCalled();
    const allArgs = mockBuilder.appendInstructions.mock.calls[0];
    const agentsMdArg = allArgs.find((a: string) => a.includes('<system_agents_md>'));
    expect(agentsMdArg).toBeUndefined();
  });

  it('should merge global and workspace AGENTS.md', async () => {
    const globalContent = '# System Identity\n\n- **系统名称**: TestAI';
    const wsContent = '# Session Context\n\n当前任务: 代码审查';

    fs.writeFileSync(globalAgentsMdPath, globalContent, 'utf-8');
    fs.writeFileSync(path.join(workspaceDir, 'AGENTS.md'), wsContent, 'utf-8');

    await injectEnv('session-123', mockBuilder);

    const allArgs = mockBuilder.appendInstructions.mock.calls[0];
    const agentsMdArg = allArgs.find((a: string) => a.includes('<system_agents_md>'));
    expect(agentsMdArg).toBeDefined();
    expect(agentsMdArg).toContain('系统名称');
    expect(agentsMdArg).toContain('代码审查');
    expect(agentsMdArg).toContain('Session-level overrides');
  });

  it('should not duplicate content if workspace AGENTS.md is same as global', async () => {
    const content = '# System Identity\n\n- **系统名称**: TestAI';
    fs.writeFileSync(globalAgentsMdPath, content, 'utf-8');
    fs.writeFileSync(path.join(workspaceDir, 'AGENTS.md'), content, 'utf-8');

    await injectEnv('session-123', mockBuilder);

    const allArgs = mockBuilder.appendInstructions.mock.calls[0];
    const agentsMdArg = allArgs.find((a: string) => a.includes('<system_agents_md>'));
    expect(agentsMdArg).toBeDefined();
    // Should NOT contain session-level marker (identical content is deduplicated)
    expect(agentsMdArg).not.toContain('Session-level overrides');
  });

  it('should truncate content exceeding 4000 chars', async () => {
    const longContent = '# Rules\n\n' + 'A'.repeat(5000);
    fs.writeFileSync(globalAgentsMdPath, longContent, 'utf-8');

    await injectEnv('session-123', mockBuilder);

    const allArgs = mockBuilder.appendInstructions.mock.calls[0];
    const agentsMdArg = allArgs.find((a: string) => a.includes('<system_agents_md>'));
    expect(agentsMdArg).toBeDefined();
    expect(agentsMdArg).toContain('... (truncated)');
  });

  it('should not inject for chat mode', async () => {
    const content = '# System Identity\n\n- **系统名称**: TestAI';
    fs.writeFileSync(globalAgentsMdPath, content, 'utf-8');

    mockBuilder.getMode.mockReturnValue('chat');
    await injectEnv('session-123', mockBuilder);

    expect(mockBuilder.appendInstructions).not.toHaveBeenCalled();
  });
});
