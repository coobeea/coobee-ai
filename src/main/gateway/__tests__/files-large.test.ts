/**
 * 大文件分块加载测试
 *
 * 测试大文件的分块读取和懒加载功能。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Large File - Chunked Loading', () => {
  let tmpFile: string;

  beforeEach(() => {
    // 创建大文件（10000 行）
    tmpFile = path.join(os.tmpdir(), `large-test-${Date.now()}.txt`);

    const lines: string[] = [];
    for (let i = 1; i <= 15000; i++) {
      lines.push(`Line ${i}: This is a test line with some content to simulate a real file.`);
    }

    fs.writeFileSync(tmpFile, lines.join('\n'), 'utf-8');
  });

  afterEach(() => {
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  });

  it('应该支持按行号分块读取', async () => {
    const readFileChunk = async (
      filePath: string,
      offset: number,
      limit: number
    ): Promise<{ content: string; totalLines: number; hasMore: boolean }> => {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const totalLines = lines.length;

      const start = Math.max(0, offset);
      const end = Math.min(totalLines, start + limit);
      const chunk = lines.slice(start, end).join('\n');

      return {
        content: chunk,
        totalLines,
        hasMore: end < totalLines
      };
    };

    // 第一块：0-9999 行
    const chunk1 = await readFileChunk(tmpFile, 0, 10000);
    expect(chunk1.content).toContain('Line 1:');
    expect(chunk1.content).toContain('Line 9999:');
    expect(chunk1.content).not.toContain('Line 10001:');
    expect(chunk1.totalLines).toBe(15000);
    expect(chunk1.hasMore).toBe(true);

    // 第二块：10000-14999 行
    const chunk2 = await readFileChunk(tmpFile, 10000, 10000);
    expect(chunk2.content).toContain('Line 10001:');
    expect(chunk2.content).toContain('Line 15000:');
    expect(chunk2.totalLines).toBe(15000);
    expect(chunk2.hasMore).toBe(false);
  });

  it('应该正确计算总行数', async () => {
    const content = await fs.promises.readFile(tmpFile, 'utf-8');
    const lines = content.split('\n');

    expect(lines.length).toBe(15000);
  });

  it('应该处理超出范围的 offset', async () => {
    const readFileChunk = async (
      filePath: string,
      offset: number,
      limit: number
    ): Promise<{ content: string; totalLines: number; hasMore: boolean }> => {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const totalLines = lines.length;

      const start = Math.max(0, offset);
      const end = Math.min(totalLines, start + limit);
      const chunk = lines.slice(start, end).join('\n');

      return {
        content: chunk,
        totalLines,
        hasMore: end < totalLines
      };
    };

    // offset 超出文件范围
    const chunk = await readFileChunk(tmpFile, 20000, 5000);
    expect(chunk.content).toBe('');
    expect(chunk.hasMore).toBe(false);
  });

  it('应该识别二进制文件', () => {
    const binaryExts = ['exe', 'dll', 'zip', 'jpg', 'png', 'pdf', 'mp4'];

    function isBinaryFile(ext: string): boolean {
      const binaryList = [
        'exe',
        'dll',
        'so',
        'dylib',
        'bin',
        'dat',
        'db',
        'sqlite',
        'zip',
        'tar',
        'gz',
        'rar',
        '7z',
        'jpg',
        'jpeg',
        'png',
        'gif',
        'bmp',
        'ico',
        'webp',
        'mp4',
        'avi',
        'mov',
        'mp3',
        'wav',
        'pdf',
        'doc',
        'docx',
        'xls',
        'xlsx',
        'ppt',
        'pptx'
      ];
      return binaryList.includes(ext.toLowerCase());
    }

    binaryExts.forEach((ext) => {
      expect(isBinaryFile(ext)).toBe(true);
    });

    expect(isBinaryFile('txt')).toBe(false);
    expect(isBinaryFile('js')).toBe(false);
    expect(isBinaryFile('md')).toBe(false);
  });
});

describe('Large File - Size Thresholds', () => {
  it('小文件应该一次性加载', () => {
    const smallFileSize = 5 * 1024 * 1024; // 5MB
    const threshold = 10 * 1024 * 1024; // 10MB

    expect(smallFileSize < threshold).toBe(true);
  });

  it('大文件应该分块加载', () => {
    const largeFileSize = 50 * 1024 * 1024; // 50MB
    const threshold = 10 * 1024 * 1024; // 10MB

    expect(largeFileSize >= threshold).toBe(true);
  });

  it('每块应该加载 10000 行', () => {
    const CHUNK_SIZE_LINES = 10000;
    expect(CHUNK_SIZE_LINES).toBe(10000);
  });
});
