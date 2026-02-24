import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CompressionService } from '../CompressionService';
import { FileSession } from '../../openai/FileSession';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('CompressionService', () => {
  let tempDir: string;
  let sessionPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'compression-test-'));
    sessionPath = tempDir;
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('应该在未启用时返回 null', async () => {
    const service = new CompressionService({ enabled: false });
    const session = new FileSession('test-session', sessionPath);

    const status = await service.getCompressionStatus(session);
    expect(status).toBeNull();
  });

  it('应该在未启用时返回空数组', async () => {
    const service = new CompressionService({ enabled: false });
    const session = new FileSession('test-session', sessionPath);

    const chunks = await service.compressWithChunks(session, 'gpt-4o');
    expect(chunks).toHaveLength(0);
  });

  it('应该正确报告启用状态', () => {
    const enabled = new CompressionService({ enabled: true });
    const disabled = new CompressionService({ enabled: false });

    expect(enabled.isEnabled()).toBe(true);
    expect(disabled.isEnabled()).toBe(false);
  });

  it('应该提供强制压缩方法', async () => {
    const service = new CompressionService({ enabled: true });
    const session = new FileSession('test-session', sessionPath);

    // 强制压缩不应抛出错误（即使 session 为空）
    const result = await service.forceCompress(session, 'gpt-4o-mini');
    expect(result).toBeDefined();
    expect(result.compressed).toBeDefined();
  });
});
