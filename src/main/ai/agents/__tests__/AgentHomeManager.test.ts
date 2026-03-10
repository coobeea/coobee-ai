/**
 * AgentHomeManager 测试
 *
 * 覆盖：Home 目录初始化、默认文件生成、可注入文件读取、3 级 AGENTS.md 合并
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentHomeManager } from '../AgentHomeManager';

vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

let tmpDir: string;
let homesDir: string;
let manager: AgentHomeManager;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-home-test-'));
  homesDir = path.join(tmpDir, 'homes');
  manager = new AgentHomeManager(homesDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('AgentHomeManager', () => {
  describe('initHome', () => {
    it('should create home directory with all default files', () => {
      const homeDir = manager.initHome('test-agent');

      expect(fs.existsSync(homeDir)).toBe(true);
      expect(fs.existsSync(path.join(homeDir, 'memory'))).toBe(true);

      const expectedFiles = [
        'SOUL.md',
        'IDENTITY.md',
        'USER.md',
        'NOTES.md',
        'AGENTS.md',
        'HEARTBEAT.md',
        'MEMORY.md',
        'BOOTSTRAP.md'
      ];

      for (const file of expectedFiles) {
        expect(fs.existsSync(path.join(homeDir, file))).toBe(true);
      }
    });

    it('should include agentId in BOOTSTRAP.md', () => {
      const homeDir = manager.initHome('my-assistant');
      const bootstrap = fs.readFileSync(path.join(homeDir, 'BOOTSTRAP.md'), 'utf-8');
      expect(bootstrap).toContain('my-assistant');
    });

    it('should not overwrite existing files on repeated calls', () => {
      const homeDir = manager.initHome('test-agent');
      const soulPath = path.join(homeDir, 'SOUL.md');

      fs.writeFileSync(soulPath, '# Custom Soul Content', 'utf-8');

      manager.initHome('test-agent');

      const content = fs.readFileSync(soulPath, 'utf-8');
      expect(content).toBe('# Custom Soul Content');
    });

    it('should not create BOOTSTRAP.md if standard files already exist', () => {
      const homeDir = path.join(homesDir, 'existing-agent');
      fs.mkdirSync(homeDir, { recursive: true });
      fs.writeFileSync(path.join(homeDir, 'SOUL.md'), '# My Soul', 'utf-8');

      manager.initHome('existing-agent');

      expect(fs.existsSync(path.join(homeDir, 'BOOTSTRAP.md'))).toBe(false);
    });
  });

  describe('initHomes', () => {
    it('should batch initialize homes for multiple agents', () => {
      manager.initHomes(['agent-a', 'agent-b', 'agent-c']);

      expect(fs.existsSync(path.join(homesDir, 'agent-a'))).toBe(true);
      expect(fs.existsSync(path.join(homesDir, 'agent-b'))).toBe(true);
      expect(fs.existsSync(path.join(homesDir, 'agent-c'))).toBe(true);
    });
  });

  describe('hasHome', () => {
    it('should return false for non-existent agent', () => {
      expect(manager.hasHome('nonexistent')).toBe(false);
    });

    it('should return true after init', () => {
      manager.initHome('test-agent');
      expect(manager.hasHome('test-agent')).toBe(true);
    });
  });

  describe('readInjectableFiles', () => {
    it('should return undefined when home does not exist', () => {
      expect(manager.readInjectableFiles('nonexistent')).toBeUndefined();
    });

    it('should return BOOTSTRAP content for a fresh agent', () => {
      manager.initHome('fresh-agent');
      const result = manager.readInjectableFiles('fresh-agent');
      expect(result).toBeDefined();
      expect(result).toContain('BOOTSTRAP.md');
    });

    it('should return undefined when only template-only files remain (no bootstrap)', () => {
      const homeDir = manager.initHome('no-bootstrap');
      // Remove BOOTSTRAP.md to simulate a post-bootstrap state
      fs.unlinkSync(path.join(homeDir, 'BOOTSTRAP.md'));
      const result = manager.readInjectableFiles('no-bootstrap');
      expect(result).toBeUndefined();
    });

    it('should include files with real content', () => {
      const homeDir = manager.initHome('test-agent');
      fs.writeFileSync(path.join(homeDir, 'SOUL.md'), '# Soul\n\nI am a helpful and curious assistant.', 'utf-8');
      fs.writeFileSync(path.join(homeDir, 'USER.md'), '# User\n\nName: Alice\nPreferences: concise answers', 'utf-8');

      const result = manager.readInjectableFiles('test-agent');
      expect(result).toBeDefined();
      expect(result).toContain('<agent_home');
      expect(result).toContain('SOUL.md');
      expect(result).toContain('helpful and curious');
      expect(result).toContain('USER.md');
      expect(result).toContain('Alice');
    });

    it('should include MEMORY.md when includeMemory is true', () => {
      const homeDir = manager.initHome('test-agent');
      fs.writeFileSync(path.join(homeDir, 'MEMORY.md'), '# Memory\n\nUser prefers dark mode.', 'utf-8');

      const withMemory = manager.readInjectableFiles('test-agent', true);
      expect(withMemory).toContain('MEMORY.md');

      const withoutMemory = manager.readInjectableFiles('test-agent', false);
      if (withoutMemory) {
        expect(withoutMemory).not.toContain('MEMORY.md');
      }
    });

    it('should include BOOTSTRAP.md when it exists', () => {
      manager.initHome('new-agent');
      const result = manager.readInjectableFiles('new-agent');
      expect(result).toBeDefined();
      expect(result).toContain('BOOTSTRAP.md');
      expect(result).toContain('首次引导');
    });

    it('should truncate content exceeding 8000 characters', () => {
      const homeDir = manager.initHome('verbose-agent');
      const longContent = '# Soul\n\n' + 'A'.repeat(9000);
      fs.writeFileSync(path.join(homeDir, 'SOUL.md'), longContent, 'utf-8');

      const result = manager.readInjectableFiles('verbose-agent');
      expect(result).toBeDefined();
      expect(result).toContain('(truncated)');
    });
  });

  describe('readAgentsMd', () => {
    it('should return undefined when file has only template comments', () => {
      manager.initHome('test-agent');
      expect(manager.readAgentsMd('test-agent')).toBeUndefined();
    });

    it('should return content when AGENTS.md has real rules', () => {
      const homeDir = manager.initHome('test-agent');
      fs.writeFileSync(
        path.join(homeDir, 'AGENTS.md'),
        '# Agent Rules\n\n- Always respond in English\n- Use formal tone',
        'utf-8'
      );

      const result = manager.readAgentsMd('test-agent');
      expect(result).toBeDefined();
      expect(result).toContain('Always respond in English');
    });
  });
});
