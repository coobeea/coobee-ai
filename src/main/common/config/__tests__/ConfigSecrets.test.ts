import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }));
vi.mock('@main/common/logger', () => ({
  createLogger: vi.fn(() => ({ warn: mockWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }))
}));

import { loadSecrets, mergeSecrets, secretsPath } from '../ConfigSecrets';

describe('ConfigSecrets', () => {
  let tmpDir: string;
  const isWindows = process.platform === 'win32';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coobee-secrets-test-'));
    mockWarn.mockClear();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('loadSecrets', () => {
    it('should return empty object when file does not exist', () => {
      const result = loadSecrets(tmpDir);
      expect(result).toEqual({});
      expect(mockWarn).not.toHaveBeenCalled();
    });

    it.skipIf(isWindows)('should load valid secrets and not warn when permission is 600 (Unix only)', () => {
      const filePath = path.join(tmpDir, 'secrets.json5');
      fs.writeFileSync(filePath, '{ dashscope: "sk-xxx" }', { mode: 0o600, encoding: 'utf-8' });

      const result = loadSecrets(tmpDir);
      expect(result).toEqual({ dashscope: 'sk-xxx' });
      expect(mockWarn).not.toHaveBeenCalled();
    });

    it.skipIf(isWindows)('should warn when permission is not 600 (Unix only)', () => {
      const filePath = path.join(tmpDir, 'secrets.json5');
      fs.writeFileSync(filePath, '{ dashscope: "sk-xxx" }', { mode: 0o644, encoding: 'utf-8' });

      const result = loadSecrets(tmpDir);
      expect(result).toEqual({ dashscope: 'sk-xxx' });
      expect(mockWarn).toHaveBeenCalledTimes(1);
      expect(mockWarn).toHaveBeenCalledWith(expect.stringMatching(/secrets\.json5 文件权限为 644.*建议改为 600/));
    });

    it.skipIf(!isWindows)('should skip permission check on Windows', () => {
      const filePath = path.join(tmpDir, 'secrets.json5');
      fs.writeFileSync(filePath, '{ dashscope: "sk-xxx" }', { encoding: 'utf-8' });

      const result = loadSecrets(tmpDir);
      expect(result).toEqual({ dashscope: 'sk-xxx' });
      expect(mockWarn).not.toHaveBeenCalled();
    });

    it('should load and parse JSON5 format', () => {
      const filePath = path.join(tmpDir, 'secrets.json5');
      fs.writeFileSync(filePath, '{ dashscope: "sk-1", silicon: "sk-2" }', {
        mode: 0o600,
        encoding: 'utf-8'
      });

      const result = loadSecrets(tmpDir);
      expect(result).toEqual({ dashscope: 'sk-1', silicon: 'sk-2' });
    });

    it('should return empty object on parse error', () => {
      const filePath = path.join(tmpDir, 'secrets.json5');
      fs.writeFileSync(filePath, 'invalid json {', { mode: 0o600, encoding: 'utf-8' });

      const result = loadSecrets(tmpDir);
      expect(result).toEqual({});
    });
  });

  describe('mergeSecrets', () => {
    it('should merge secrets into provider apiKey', () => {
      const config = {
        models: {
          providers: {
            dashscope: { apiKey: 'old', baseURL: 'https://api.dashscope.com' },
            silicon: {}
          }
        }
      };
      const secrets = { dashscope: 'sk-new', silicon: 'sk-silicon' };
      const result = mergeSecrets(config, secrets);
      const providers = (result as Record<string, unknown> & typeof config).models.providers;
      expect((providers.dashscope as Record<string, unknown>).apiKey).toBe('sk-new');
      expect((providers.silicon as Record<string, unknown>).apiKey).toBe('sk-silicon');
    });
  });

  describe('secretsPath', () => {
    it('should return correct path', () => {
      expect(secretsPath('/foo/bar')).toBe(path.join('/foo/bar', 'secrets.json5'));
    });
  });
});
