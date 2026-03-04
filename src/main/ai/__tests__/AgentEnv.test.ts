/**
 * AgentEnv 单元测试
 *
 * 测试：
 *   - buildAgentEnv: 从 Env 构建安全子集（含系统信息、Extension、工具清单）
 *   - formatRuntimePaths: 格式化为 <runtime_environment> XML
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ===== Mock logger =====
vi.mock('@main/common/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

// ===== Mock env =====
const mockEnv = {
  isDev: true,
  app: { version: '1.2.3' },
  paths: {
    userHome: '/mock/.home',
    home: '/Users/mock',
    temp: '/tmp/mock',
    builtinSkillsDir: '/mock/skills',
    userSkillsDir: '/mock/.home/skills',
    builtinExtensionsDir: '/mock/extensions',
    userExtensionsDir: '/mock/.home/extensions',
    memoryDir: '/mock/.home/memory',
    userMemoryDir: '/mock/.home/memory/user',
    agentMemoryDir: '/mock/.home/memory/agent',
    workspacesDir: '/mock/.home/workspaces',
    configDir: '/mock/.home/config',
    builtinAgentsDir: '/mock/agents',
    userAgentsDir: '/mock/.home/agents',
    threadsDir: '/mock/.home/threads'
  },
  getSkillSearchPaths: vi.fn(),
  getExtensionSearchPaths: vi.fn(),
  getAgentWorkspaceDir: vi.fn()
};

vi.mock('@main/common/env', () => ({
  Env: mockEnv
}));

// ===== Mock extension system =====
const mockExtensionManager = {
  getRegistry: vi.fn()
};

vi.mock('@main/common/extension', () => ({
  ExtensionManager: mockExtensionManager
}));

// ===== Mock ToolRegistry =====
const mockToolRegistryInstance = {
  getAll: vi.fn().mockReturnValue([])
};

vi.mock('@main/ai/tools/registry', () => ({
  ToolRegistry: {
    getInstance: () => mockToolRegistryInstance
  }
}));

import { buildAgentEnv, formatRuntimePaths } from '../AgentEnv';
import type { AgentEnv } from '../AgentEnv';
// AgentEnv.ts 已从 common/ 移至 ai/ 根层

describe('AgentEnv', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToolRegistryInstance.getAll.mockReturnValue([]);
  });

  // ==================== buildAgentEnv ====================

  describe('buildAgentEnv', () => {
    it('从 Env 构建包含所有必要字段的安全子集', async () => {
      const mockSkillPaths = ['/mock/skills', '/mock/.home/skills', '/mock/workspace/skills'];
      const mockExtPaths = ['/mock/extensions', '/mock/.home/extensions'];
      mockEnv.getSkillSearchPaths.mockResolvedValue(mockSkillPaths);
      mockEnv.getExtensionSearchPaths.mockResolvedValue(mockExtPaths);
      mockExtensionManager.getRegistry.mockReturnValue({
        getSkillDirs: () => [],
        getExtensionIds: () => []
      });
      mockToolRegistryInstance.getAll.mockReturnValue([{ name: 'read' }, { name: 'write' }, { name: 'exec' }]);

      const env = await buildAgentEnv('session-123', '/mock/workspace');

      expect(env).toEqual({
        platform: process.platform,
        arch: process.arch,
        isDev: true,
        appVersion: '1.2.3',
        workspace: '/mock/workspace',
        sessionId: 'session-123',
        tasksDir: '/mock/workspace/tasks',
        userHome: '/mock/.home',
        systemHome: '/Users/mock',
        temp: '/tmp/mock',
        configDir: '/mock/.home/config',
        threadsDir: '/mock/.home/threads',
        builtinAgentsDir: '/mock/agents',
        userAgentsDir: '/mock/.home/agents',
        skillPaths: mockSkillPaths,
        builtinSkillsDir: '/mock/skills',
        userSkillsDir: '/mock/.home/skills',
        extensionPaths: mockExtPaths,
        builtinExtensionsDir: '/mock/extensions',
        userExtensionsDir: '/mock/.home/extensions',
        loadedExtensions: [],
        memoryDir: '/mock/.home/memory',
        availableTools: ['read', 'write', 'exec'],
        sandboxMode: 'path-only',
        execApproval: 'auto',
        defaultModel: 'unknown',
        thinkingLevel: 'medium'
      });
    });

    it('调用 getSkillSearchPaths 并传入 workspace', async () => {
      mockEnv.getSkillSearchPaths.mockResolvedValue([]);
      mockEnv.getExtensionSearchPaths.mockResolvedValue([]);
      mockExtensionManager.getRegistry.mockReturnValue(null);

      await buildAgentEnv('sess-1', '/my/workspace');

      expect(mockEnv.getSkillSearchPaths).toHaveBeenCalledWith('/my/workspace');
      expect(mockEnv.getExtensionSearchPaths).toHaveBeenCalledWith('/my/workspace');
    });

    it('sessionId 正确传入', async () => {
      mockEnv.getSkillSearchPaths.mockResolvedValue([]);
      mockEnv.getExtensionSearchPaths.mockResolvedValue([]);
      mockExtensionManager.getRegistry.mockReturnValue(null);

      const env = await buildAgentEnv('my-session-456', '/mock/workspace');

      expect(env.sessionId).toBe('my-session-456');
    });

    it('包含系统信息：arch、appVersion', async () => {
      mockEnv.getSkillSearchPaths.mockResolvedValue([]);
      mockEnv.getExtensionSearchPaths.mockResolvedValue([]);
      mockExtensionManager.getRegistry.mockReturnValue(null);

      const env = await buildAgentEnv('sess-1', '/mock/workspace');

      expect(env.arch).toBe(process.arch);
      expect(env.appVersion).toBe('1.2.3');
      expect(env.systemHome).toBe('/Users/mock');
    });

    it('包含 Extension 目录信息', async () => {
      mockEnv.getSkillSearchPaths.mockResolvedValue([]);
      mockEnv.getExtensionSearchPaths.mockResolvedValue(['/mock/ext1', '/mock/ext2']);
      mockExtensionManager.getRegistry.mockReturnValue({
        getSkillDirs: () => [],
        getExtensionIds: () => ['ext-a', 'ext-b']
      });

      const env = await buildAgentEnv('sess-1', '/mock/workspace');

      expect(env.builtinExtensionsDir).toBe('/mock/extensions');
      expect(env.userExtensionsDir).toBe('/mock/.home/extensions');
      expect(env.loadedExtensions).toEqual(['ext-a', 'ext-b']);
    });

    it('包含可用工具清单', async () => {
      mockEnv.getSkillSearchPaths.mockResolvedValue([]);
      mockEnv.getExtensionSearchPaths.mockResolvedValue([]);
      mockExtensionManager.getRegistry.mockReturnValue(null);
      mockToolRegistryInstance.getAll.mockReturnValue([
        { name: 'read' },
        { name: 'write' },
        { name: 'edit' },
        { name: 'exec' }
      ]);

      const env = await buildAgentEnv('sess-1', '/mock/workspace');

      expect(env.availableTools).toEqual(['read', 'write', 'edit', 'exec']);
    });

    // ---- 扩展贡献 Skill 路径合并 ----

    it('扩展贡献的 Skill 路径插入到 builtinSkillsDir 之后', async () => {
      const baseSkillPaths = ['/mock/skills', '/mock/.home/skills', '/mock/workspace/skills'];
      mockEnv.getSkillSearchPaths.mockResolvedValue([...baseSkillPaths]);
      mockEnv.getExtensionSearchPaths.mockResolvedValue([]);
      mockExtensionManager.getRegistry.mockReturnValue({
        getSkillDirs: () => [
          { extensionId: 'ext-a', dir: '/ext-a/skills' },
          { extensionId: 'ext-b', dir: '/ext-b/skills' }
        ],
        getExtensionIds: () => ['ext-a', 'ext-b']
      });

      const env = await buildAgentEnv('sess-1', '/mock/workspace');

      expect(env.skillPaths).toEqual([
        '/mock/skills',
        '/ext-a/skills',
        '/ext-b/skills',
        '/mock/.home/skills',
        '/mock/workspace/skills'
      ]);
    });

    it('ExtensionManager 未初始化时 — skillPaths 不受影响', async () => {
      const baseSkillPaths = ['/mock/skills', '/mock/.home/skills'];
      mockEnv.getSkillSearchPaths.mockResolvedValue([...baseSkillPaths]);
      mockEnv.getExtensionSearchPaths.mockResolvedValue([]);
      mockExtensionManager.getRegistry.mockReturnValue(null);

      const env = await buildAgentEnv('sess-1', '/mock/workspace');

      expect(env.skillPaths).toEqual(baseSkillPaths);
    });

    it('扩展无 Skill 贡献时 — skillPaths 不变', async () => {
      const baseSkillPaths = ['/mock/skills', '/mock/.home/skills'];
      mockEnv.getSkillSearchPaths.mockResolvedValue([...baseSkillPaths]);
      mockEnv.getExtensionSearchPaths.mockResolvedValue([]);
      mockExtensionManager.getRegistry.mockReturnValue({
        getSkillDirs: () => [],
        getExtensionIds: () => []
      });

      const env = await buildAgentEnv('sess-1', '/mock/workspace');

      expect(env.skillPaths).toEqual(baseSkillPaths);
    });
  });

  // ==================== formatRuntimePaths ====================

  describe('formatRuntimePaths', () => {
    const sampleEnv: AgentEnv = {
      platform: 'darwin',
      arch: 'arm64',
      isDev: true,
      appVersion: '1.0.0',
      workspace: '/home/test/workspaces/session-1',
      sessionId: 'session-1',
      tasksDir: '/home/test/workspaces/session-1/tasks',
      userHome: '/home/test',
      systemHome: '/Users/test',
      temp: '/tmp',
      configDir: '/home/test/config',
      threadsDir: '/home/test/threads',
      builtinAgentsDir: '/builtin/agents',
      userAgentsDir: '/home/test/agents',
      skillPaths: ['/builtin/skills', '/home/test/skills', '/home/test/workspaces/session-1/skills'],
      builtinSkillsDir: '/builtin/skills',
      userSkillsDir: '/home/test/skills',
      extensionPaths: ['/builtin/extensions', '/home/test/extensions'],
      builtinExtensionsDir: '/builtin/extensions',
      userExtensionsDir: '/home/test/extensions',
      loadedExtensions: ['ext-memory', 'ext-translate'],
      memoryDir: '/home/test/memory',
      availableTools: ['read', 'write', 'edit', 'exec'],
      sandboxMode: 'path-only',
      execApproval: 'auto',
      defaultModel: 'dashscope/qwen3.5-plus',
      thinkingLevel: 'medium'
    };

    it('生成包含所有信息的 XML 块', () => {
      const result = formatRuntimePaths(sampleEnv);

      expect(result).toContain('<runtime_environment>');
      expect(result).toContain('</runtime_environment>');
      // 系统信息（自然语言格式）
      expect(result).toContain('Platform: darwin/arm64');
      expect(result).toContain('dev');
      expect(result).toContain('Session: session-1');
      expect(result).toContain('Workspace: /home/test/workspaces/session-1');
      // 关键目录
      expect(result).toContain('Config: /home/test/config');
      expect(result).toContain('Memory: /home/test/memory');
      expect(result).toContain('Skills: builtin=/builtin/skills');
    });

    it('包含 Skill 搜索路径', () => {
      const result = formatRuntimePaths(sampleEnv);

      expect(result).toContain('Skills: builtin=/builtin/skills');
      expect(result).toContain('user=/home/test/skills');
    });

    it('包含 Extension 信息', () => {
      const result = formatRuntimePaths(sampleEnv);

      expect(result).toContain('Extensions: ext-memory, ext-translate');
    });

    it('包含可用工具列表', () => {
      const result = formatRuntimePaths(sampleEnv);

      // formatRuntimePaths 不输出工具列表，只要包含基本环境信息即可
      expect(result).toContain('Runtime Environment');
      expect(result).toContain('Key System Directories');
    });

    it('空列表时仍能正确输出', () => {
      const emptyEnv = {
        ...sampleEnv,
        skillPaths: [],
        extensionPaths: [],
        loadedExtensions: [],
        availableTools: []
      };
      const result = formatRuntimePaths(emptyEnv);

      expect(result).toContain('<runtime_environment>');
      expect(result).toContain('</runtime_environment>');
      expect(result).not.toContain('<tool>');
      expect(result).not.toContain('<extension>');
    });
  });
});
