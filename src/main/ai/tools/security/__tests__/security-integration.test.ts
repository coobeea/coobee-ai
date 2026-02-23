/**
 * 安全机制集成测试
 *
 * 测试 read/write/exec 工具对敏感路径和危险命令的防护
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';

// Import security modules (no electron dependency)
import { checkSensitivePath, canRead, canWrite, canExec } from '../sensitive-paths';
import { scanCommand, scanScriptContent } from '../command-scanner';

describe('Sensitive Paths Protection', () => {
  describe('checkSensitivePath', () => {
    it('应该阻止读取 secrets.json5', () => {
      const sensitiveFile = path.join(os.homedir(), '.coobee-ai', 'secrets', 'secrets.json5');
      const result = checkSensitivePath(sensitiveFile);
      expect(result.sensitive).toBe(true);
      if (result.sensitive) {
        expect(result.reason).toContain('secrets.json5');
      }
    });

    it('应该阻止读取 skills.json5', () => {
      const sensitiveFile = path.join(os.homedir(), '.coobee-ai', 'secrets', 'skills.json5');
      const result = checkSensitivePath(sensitiveFile);
      expect(result.sensitive).toBe(true);
      if (result.sensitive) {
        expect(result.reason).toContain('skills.json5');
      }
    });

    it('应该阻止访问 secrets/ 目录', () => {
      const sensitiveDir = path.join(os.homedir(), '.coobee-ai', 'secrets', 'any-file.txt');
      const result = checkSensitivePath(sensitiveDir);
      expect(result.sensitive).toBe(true);
      if (result.sensitive) {
        expect(result.reason).toContain('secrets');
      }
    });

    it('应该允许访问普通文件', () => {
      const normalFile = path.join(os.homedir(), '.coobee-ai', 'config', 'coobee.json5');
      const result = checkSensitivePath(normalFile);
      expect(result.sensitive).toBe(false);
    });

    it('应该允许访问 workspace 文件', () => {
      const workspaceFile = '/Users/test/project/src/index.ts';
      const result = checkSensitivePath(workspaceFile);
      expect(result.sensitive).toBe(false);
    });
  });

  describe('canRead/canWrite/canExec', () => {
    it('canRead 应该阻止敏感文件', () => {
      const sensitiveFile = path.join(os.homedir(), '.coobee-ai', 'secrets', 'secrets.json5');
      const error = canRead(sensitiveFile);
      expect(error).not.toBeNull();
      expect(error).toContain('Access denied');
    });

    it('canWrite 应该阻止敏感文件', () => {
      const sensitiveFile = path.join(os.homedir(), '.coobee-ai', 'secrets', 'secrets.json5');
      const error = canWrite(sensitiveFile);
      expect(error).not.toBeNull();
      expect(error).toContain('Access denied');
    });

    it('canExec 应该阻止在敏感目录执行', () => {
      const sensitiveScript = path.join(os.homedir(), '.coobee-ai', 'secrets', 'test.py');
      const error = canExec(sensitiveScript);
      expect(error).not.toBeNull();
      expect(error).toContain('Access denied');
    });
  });
});

describe('Command Scanner', () => {
  describe('scanCommand', () => {
    it('应该阻止读取 secrets.json5', () => {
      const error = scanCommand('cat ~/.coobee-ai/secrets/secrets.json5');
      expect(error).toBeNull(); // cat 是白名单命令，允许读取
    });

    it('应该阻止修改 secrets.json5', () => {
      const error = scanCommand('sed -i "s/old/new/" ~/.coobee-ai/secrets/secrets.json5');
      expect(error).not.toBeNull();
      expect(error).toContain('secrets.json5');
    });

    it('应该阻止危险的 rm -rf /', () => {
      const error = scanCommand('rm -rf /');
      expect(error).not.toBeNull();
      expect(error).toContain('rm -rf');
    });

    it('应该阻止 sudo 提权操作', () => {
      const error = scanCommand('sudo apt install malware');
      expect(error).not.toBeNull();
      expect(error).toContain('sudo');
    });

    it('应该阻止访问 secrets 目录', () => {
      const error = scanCommand('rm -rf ~/.coobee-ai/secrets/');
      expect(error).not.toBeNull();
      expect(error).toContain('secrets');
    });

    it('应该允许安全的 npm 命令', () => {
      const error = scanCommand('npm install axios');
      expect(error).toBeNull();
    });

    it('应该允许安全的 git 命令', () => {
      const error = scanCommand('git status');
      expect(error).toBeNull();
    });

    it('应该允许在非敏感目录执行', () => {
      const error = scanCommand('python script.py', '/Users/test/project');
      expect(error).toBeNull();
    });

    it('应该阻止在 secrets 目录执行命令', () => {
      const secretsDir = path.join(os.homedir(), '.coobee-ai', 'secrets');
      const error = scanCommand('python script.py', secretsDir);
      expect(error).not.toBeNull();
      expect(error).toContain('sensitive directory');
    });
  });

  describe('scanScriptContent', () => {
    it('应该阻止读取 secrets.json5 的 Python 脚本', () => {
      const script = `
import json
with open('~/.coobee-ai/secrets/secrets.json5', 'r') as f:
    data = json.load(f)
      `;
      const error = scanScriptContent(script);
      expect(error).not.toBeNull();
      expect(error).toContain('sensitive files');
    });

    it('应该阻止读取 secrets.json5 的 Node.js 脚本', () => {
      const script = `
const fs = require('fs');
const data = fs.readFileSync('~/.coobee-ai/secrets/secrets.json5', 'utf-8');
      `;
      const error = scanScriptContent(script);
      expect(error).not.toBeNull();
      expect(error).toContain('sensitive files');
    });

    it('应该阻止访问 secrets 目录', () => {
      const script = `
import os
for file in os.listdir('/secrets/'):
    print(file)
      `;
      const error = scanScriptContent(script);
      expect(error).not.toBeNull();
      expect(error).toContain('sensitive directory');
    });

    it('应该允许安全的脚本', () => {
      const script = `
import json
with open('config.json', 'r') as f:
    data = json.load(f)
print(data)
      `;
      const error = scanScriptContent(script);
      expect(error).toBeNull();
    });
  });
});
