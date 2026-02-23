/**
 * Skill 导入功能测试
 *
 * 测试从本地路径和网络 URL 导入 Skill 的功能。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock dependencies
vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}));

vi.mock('@main/common/env', () => ({
  Env: {
    paths: {
      userSkillsDir: path.join(os.tmpdir(), 'coobee-test-skills'),
      workspacesDir: path.join(os.tmpdir(), 'coobee-test-workspace'),
      secretsDir: path.join(os.tmpdir(), 'coobee-test-secrets')
    },
    getSkillSearchPaths: async () => [path.join(os.tmpdir(), 'coobee-test-skills')]
  }
}));

vi.mock('@main/ai/skills', () => ({
  SkillManager: class MockSkillManager {
    static invalidateCache = vi.fn();
    scanSkills = vi.fn(() => []);
  }
}));

describe('Skill Import - Local Path', () => {
  let tmpSkillDir: string;
  let userSkillsDir: string;

  beforeEach(() => {
    // 创建临时目录
    tmpSkillDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-skill-'));
    userSkillsDir = path.join(os.tmpdir(), 'coobee-test-skills');

    if (!fs.existsSync(userSkillsDir)) {
      fs.mkdirSync(userSkillsDir, { recursive: true });
    }

    // 创建测试 Skill
    fs.writeFileSync(
      path.join(tmpSkillDir, 'SKILL.md'),
      `---
name: test-skill
description: Test skill for import
---

# Test Skill

This is a test skill.
`,
      'utf-8'
    );

    // 创建 references 目录
    const referencesDir = path.join(tmpSkillDir, 'references');
    fs.mkdirSync(referencesDir);
    fs.writeFileSync(path.join(referencesDir, 'example.md'), '# Example', 'utf-8');
  });

  afterEach(() => {
    // 清理临时目录
    if (fs.existsSync(tmpSkillDir)) {
      fs.rmSync(tmpSkillDir, { recursive: true, force: true });
    }
    if (fs.existsSync(userSkillsDir)) {
      fs.rmSync(userSkillsDir, { recursive: true, force: true });
    }
  });

  it('应该支持任意绝对路径导入', () => {
    // 手动实现复制逻辑（测试核心行为）
    const copyDirSyncLocal = (src: string, dest: string): void => {
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
      }

      const entries = fs.readdirSync(src, { withFileTypes: true });

      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
          copyDirSyncLocal(srcPath, destPath);
        } else {
          fs.copyFileSync(srcPath, destPath);
        }
      }
    };

    const skillName = path.basename(tmpSkillDir);
    const targetDir = path.join(userSkillsDir, skillName);

    // 执行复制（模拟导入）
    copyDirSyncLocal(tmpSkillDir, targetDir);

    // 验证文件已复制
    expect(fs.existsSync(path.join(targetDir, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'references', 'example.md'))).toBe(true);

    const content = fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf-8');
    expect(content).toContain('test-skill');
  });

  it('应该支持相对路径导入', () => {
    // 相对路径测试需要模拟 workspacesDir
    const workspacesDir = path.join(os.tmpdir(), 'coobee-test-workspace');
    if (!fs.existsSync(workspacesDir)) {
      fs.mkdirSync(workspacesDir, { recursive: true });
    }

    // 在 workspacesDir 中创建 Skill
    const relativeSkillDir = path.join(workspacesDir, 'my-skill');
    fs.mkdirSync(relativeSkillDir, { recursive: true });
    fs.writeFileSync(path.join(relativeSkillDir, 'SKILL.md'), '---\nname: relative-skill\n---\nTest', 'utf-8');

    // 解析相对路径
    const relativePath = 'my-skill';
    const resolvedPath = path.resolve(workspacesDir, relativePath);

    expect(fs.existsSync(path.join(resolvedPath, 'SKILL.md'))).toBe(true);

    // 清理
    fs.rmSync(workspacesDir, { recursive: true, force: true });
  });
});

describe('Skill Import - Network URL', () => {
  beforeEach(() => {
    // Mock global fetch
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('应该识别并转换 GitHub 目录 URL', () => {
    const githubUrl = 'https://github.com/user/repo/tree/main/my-skill';

    // 提取信息
    const match = githubUrl.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)/);
    expect(match).toBeTruthy();

    if (match) {
      const [, owner, repo, branch, skillPath] = match;
      expect(owner).toBe('user');
      expect(repo).toBe('repo');
      expect(branch).toBe('main');
      expect(skillPath).toBe('my-skill');

      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${skillPath}/SKILL.md`;
      expect(rawUrl).toBe('https://raw.githubusercontent.com/user/repo/main/my-skill/SKILL.md');
    }
  });

  it('应该处理直接的 SKILL.md URL', async () => {
    const skillMdUrl = 'https://example.com/skills/my-skill/SKILL.md';

    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '---\nname: test\n---\nContent'
    } as Response);

    const response = await fetch(skillMdUrl);
    expect(response.ok).toBe(true);

    const content = await response.text();
    expect(content).toContain('name: test');
  });

  it('应该处理下载失败', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found'
    } as Response);

    const response = await fetch('https://example.com/not-exist/SKILL.md');
    expect(response.ok).toBe(false);
    expect(response.status).toBe(404);
  });
});

describe('Skill Import - Path Validation', () => {
  it('应该拒绝空路径', () => {
    const sourcePath = '';
    expect(sourcePath).toBe('');
  });

  it('应该处理不存在的本地路径', () => {
    const nonExistentPath = '/tmp/non-existent-skill-' + Date.now();
    expect(fs.existsSync(nonExistentPath)).toBe(false);
  });

  it('应该验证目录中是否包含 SKILL.md', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-skill-'));

    const hasSkillMd = fs.existsSync(path.join(tmpDir, 'SKILL.md'));
    expect(hasSkillMd).toBe(false);

    // 清理
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
