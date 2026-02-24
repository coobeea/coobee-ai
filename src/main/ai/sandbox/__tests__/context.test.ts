/**
 * 沙箱上下文构建全面测试
 *
 * 覆盖：
 *   - createPathOnlyContext: 各种选项组合
 *   - resolveSandboxContext:
 *     - mode=off
 *     - mode=path-only
 *     - mode=docker + Docker 可用
 *     - mode=docker + Docker 不可用 → 降级
 *     - mode=docker + 容器创建失败 → 降级
 *     - 工具策略传递
 *     - sessionId 传递
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger（context.ts 使用 createLogger）
const { mockLogWarn } = vi.hoisted(() => ({
  mockLogWarn: vi.fn()
}));
vi.mock('@main/common/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: mockLogWarn,
    error: vi.fn(),
    debug: vi.fn()
  }))
}));

import { createPathOnlyContext, resolveSandboxContext } from '../context';

// Mock docker 模块
vi.mock('../docker', () => ({
  isDockerAvailable: vi.fn(),
  ensureContainer: vi.fn()
}));

import { isDockerAvailable, ensureContainer } from '../docker';

// ========== createPathOnlyContext ==========

describe('createPathOnlyContext', () => {
  it('创建最小 path-only 上下文', () => {
    const ctx = createPathOnlyContext('/home/user/project');
    expect(ctx.mode).toBe('path-only');
    expect(ctx.workspaceRoot).toBe('/home/user/project');
    expect(ctx.toolPolicy).toEqual({ allow: [], deny: [], confirm: [] });
    expect(ctx.docker).toBeUndefined();
    expect(ctx.sandboxRoot).toBeUndefined();
    expect(ctx.sessionId).toBeUndefined();
  });

  it('支持 sandboxRoot', () => {
    const ctx = createPathOnlyContext('/home/user/project', {
      sandboxRoot: '/home/user/project/src'
    });
    expect(ctx.sandboxRoot).toBe('/home/user/project/src');
  });

  it('支持 toolPolicy', () => {
    const ctx = createPathOnlyContext('/home/user/project', {
      toolPolicy: { allow: ['read'], deny: ['exec'] }
    });
    expect(ctx.toolPolicy.allow).toEqual(['read']);
    expect(ctx.toolPolicy.deny).toEqual(['exec']);
  });

  it('支持 sessionId', () => {
    const ctx = createPathOnlyContext('/home/user/project', {
      sessionId: 'test-session-123'
    });
    expect(ctx.sessionId).toBe('test-session-123');
  });

  it('支持所有选项组合', () => {
    const ctx = createPathOnlyContext('/workspace', {
      sandboxRoot: '/workspace/src',
      toolPolicy: { deny: ['exec', 'read'] },
      sessionId: 'full-options'
    });
    expect(ctx.mode).toBe('path-only');
    expect(ctx.workspaceRoot).toBe('/workspace');
    expect(ctx.sandboxRoot).toBe('/workspace/src');
    expect(ctx.toolPolicy.deny).toEqual(['exec', 'read']);
    expect(ctx.sessionId).toBe('full-options');
  });

  it('toolPolicy 缺少 allow/deny 时默认为空数组', () => {
    const ctx1 = createPathOnlyContext('/workspace', {
      toolPolicy: { allow: ['read'] }
    });
    expect(ctx1.toolPolicy.allow).toEqual(['read']);
    expect(ctx1.toolPolicy.deny).toEqual([]);

    const ctx2 = createPathOnlyContext('/workspace', {
      toolPolicy: { deny: ['exec'] }
    });
    expect(ctx2.toolPolicy.allow).toEqual([]);
    expect(ctx2.toolPolicy.deny).toEqual(['exec']);
  });
});

// ========== resolveSandboxContext ==========

describe('resolveSandboxContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- mode=off ---

  describe('mode=off', () => {
    it('返回 off 模式上下文', async () => {
      const ctx = await resolveSandboxContext({
        mode: 'off',
        workspaceRoot: '/home/user/project'
      });
      expect(ctx.mode).toBe('off');
      expect(ctx.workspaceRoot).toBe('/home/user/project');
      expect(ctx.docker).toBeUndefined();
    });

    it('传递 toolPolicy', async () => {
      const ctx = await resolveSandboxContext({
        mode: 'off',
        workspaceRoot: '/workspace',
        toolPolicy: { deny: ['exec'] }
      });
      expect(ctx.toolPolicy.deny).toEqual(['exec']);
    });

    it('传递 sandboxRoot', async () => {
      const ctx = await resolveSandboxContext({
        mode: 'off',
        workspaceRoot: '/workspace',
        sandboxRoot: '/workspace/src'
      });
      expect(ctx.sandboxRoot).toBe('/workspace/src');
    });

    it('传递 sessionId', async () => {
      const ctx = await resolveSandboxContext({ mode: 'off', workspaceRoot: '/workspace' }, 'session-off');
      expect(ctx.sessionId).toBe('session-off');
    });

    it('不调用 Docker 相关函数', async () => {
      await resolveSandboxContext({
        mode: 'off',
        workspaceRoot: '/workspace'
      });
      expect(isDockerAvailable).not.toHaveBeenCalled();
      expect(ensureContainer).not.toHaveBeenCalled();
    });
  });

  // --- mode=path-only ---

  describe('mode=path-only', () => {
    it('返回 path-only 模式上下文', async () => {
      const ctx = await resolveSandboxContext({
        mode: 'path-only',
        workspaceRoot: '/home/user/project'
      });
      expect(ctx.mode).toBe('path-only');
      expect(ctx.docker).toBeUndefined();
    });

    it('传递 toolPolicy', async () => {
      const ctx = await resolveSandboxContext({
        mode: 'path-only',
        workspaceRoot: '/workspace',
        toolPolicy: { allow: ['read', 'write'], deny: ['exec'] }
      });
      expect(ctx.toolPolicy.allow).toEqual(['read', 'write']);
      expect(ctx.toolPolicy.deny).toEqual(['exec']);
    });

    it('不调用 Docker 相关函数', async () => {
      await resolveSandboxContext({
        mode: 'path-only',
        workspaceRoot: '/workspace'
      });
      expect(isDockerAvailable).not.toHaveBeenCalled();
      expect(ensureContainer).not.toHaveBeenCalled();
    });
  });

  // --- mode=docker ---

  describe('mode=docker', () => {
    it('Docker 可用时返回 Docker 上下文', async () => {
      vi.mocked(isDockerAvailable).mockResolvedValue(true);
      vi.mocked(ensureContainer).mockResolvedValue({
        containerName: 'coobee-sbx-session-123',
        workdir: '/workspace',
        running: true
      });

      const ctx = await resolveSandboxContext({ mode: 'docker', workspaceRoot: '/home/user/project' }, 'session-123');

      expect(ctx.mode).toBe('docker');
      expect(ctx.docker).toBeDefined();
      expect(ctx.docker!.containerName).toBe('coobee-sbx-session-123');
      expect(ctx.docker!.workdir).toBe('/workspace');
      expect(ctx.docker!.running).toBe(true);
    });

    it('Docker 不可用时降级为 path-only', async () => {
      vi.mocked(isDockerAvailable).mockResolvedValue(false);
      mockLogWarn.mockClear();

      const ctx = await resolveSandboxContext({ mode: 'docker', workspaceRoot: '/home/user/project' }, 'session-123');

      expect(ctx.mode).toBe('path-only');
      expect(ctx.docker).toBeUndefined();
      // M-3 改进：现在使用 log.warn 而非 console.warn
      expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('Docker not available'));
    });

    it('容器创建失败时降级为 path-only', async () => {
      vi.mocked(isDockerAvailable).mockResolvedValue(true);
      vi.mocked(ensureContainer).mockRejectedValue(new Error('container create failed'));
      mockLogWarn.mockClear();

      const ctx = await resolveSandboxContext({ mode: 'docker', workspaceRoot: '/home/user/project' }, 'session-123');

      expect(ctx.mode).toBe('path-only');
      expect(ctx.docker).toBeUndefined();
      expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('container create failed'));
    });

    it('将 sessionId 传递给 ensureContainer', async () => {
      vi.mocked(isDockerAvailable).mockResolvedValue(true);
      vi.mocked(ensureContainer).mockResolvedValue({
        containerName: 'coobee-sbx-my-session',
        workdir: '/workspace',
        running: true
      });

      await resolveSandboxContext({ mode: 'docker', workspaceRoot: '/workspace' }, 'my-session');

      expect(ensureContainer).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'my-session' }));
    });

    it('将 workspaceRoot 传递给 ensureContainer', async () => {
      vi.mocked(isDockerAvailable).mockResolvedValue(true);
      vi.mocked(ensureContainer).mockResolvedValue({
        containerName: 'test',
        workdir: '/workspace',
        running: true
      });

      await resolveSandboxContext({ mode: 'docker', workspaceRoot: '/my/project' }, 'session');

      expect(ensureContainer).toHaveBeenCalledWith(expect.objectContaining({ workspaceDir: '/my/project' }));
    });

    it('将 docker 配置传递给 ensureContainer', async () => {
      vi.mocked(isDockerAvailable).mockResolvedValue(true);
      vi.mocked(ensureContainer).mockResolvedValue({
        containerName: 'test',
        workdir: '/app',
        running: true
      });

      const dockerCfg = {
        image: 'ubuntu:22.04',
        workdir: '/app'
      };

      await resolveSandboxContext(
        {
          mode: 'docker',
          workspaceRoot: '/workspace',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          docker: dockerCfg as any
        },
        'session'
      );

      expect(ensureContainer).toHaveBeenCalledWith(expect.objectContaining({ config: dockerCfg }));
    });

    it('无 sessionId 时生成默认的', async () => {
      vi.mocked(isDockerAvailable).mockResolvedValue(true);
      vi.mocked(ensureContainer).mockResolvedValue({
        containerName: 'test',
        workdir: '/workspace',
        running: true
      });

      await resolveSandboxContext({
        mode: 'docker',
        workspaceRoot: '/workspace'
      });

      expect(ensureContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: expect.stringContaining('default-')
        })
      );
    });

    it('Docker 模式也传递 toolPolicy', async () => {
      vi.mocked(isDockerAvailable).mockResolvedValue(true);
      vi.mocked(ensureContainer).mockResolvedValue({
        containerName: 'test',
        workdir: '/workspace',
        running: true
      });

      const ctx = await resolveSandboxContext(
        {
          mode: 'docker',
          workspaceRoot: '/workspace',
          toolPolicy: { allow: ['read'], deny: ['exec'] }
        },
        'session'
      );

      expect(ctx.toolPolicy.allow).toEqual(['read']);
      expect(ctx.toolPolicy.deny).toEqual(['exec']);
    });

    it('非 Error 类型的容器错误也能正确降级', async () => {
      vi.mocked(isDockerAvailable).mockResolvedValue(true);
      vi.mocked(ensureContainer).mockRejectedValue('string error');

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const ctx = await resolveSandboxContext({ mode: 'docker', workspaceRoot: '/workspace' }, 'session');

      expect(ctx.mode).toBe('path-only');
      consoleSpy.mockRestore();
    });
  });
});
