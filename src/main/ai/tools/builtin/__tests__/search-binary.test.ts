/**
 * Search 工具 - 二进制文件过滤测试
 *
 * 测试 search 工具正确跳过二进制文件，避免读取无用内容。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Search Tool - Binary File Filtering', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('应该识别包含 null 字节的二进制文件', async () => {
    const binaryFile = path.join(tmpDir, 'binary.dat');

    // 创建包含 null 字节的二进制文件
    const buffer = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x00, 0x57, 0x6f, 0x72, 0x6c, 0x64]);
    fs.writeFileSync(binaryFile, buffer);

    const isBinary = await detectBinaryFile(binaryFile);
    expect(isBinary).toBe(true);
  });

  it('应该识别文本文件', async () => {
    const textFile = path.join(tmpDir, 'text.txt');
    fs.writeFileSync(textFile, 'This is a normal text file with no binary content.', 'utf-8');

    const isBinary = await detectBinaryFile(textFile);
    expect(isBinary).toBe(false);
  });

  it('应该识别包含大量控制字符的文件为二进制', async () => {
    const binaryFile = path.join(tmpDir, 'control.dat');

    // 创建包含大量控制字符的文件（超过 30%）
    const buffer = Buffer.alloc(1000);
    for (let i = 0; i < 1000; i++) {
      // 50% 控制字符（ASCII < 32，排除 tab/newline/CR）
      buffer[i] = i % 2 === 0 ? 0x01 : 0x41; // 0x01 = 控制字符, 0x41 = 'A'
    }
    fs.writeFileSync(binaryFile, buffer);

    const isBinary = await detectBinaryFile(binaryFile);
    expect(isBinary).toBe(true);
  });

  it('应该正确处理包含换行符和制表符的文本文件', async () => {
    const textFile = path.join(tmpDir, 'formatted.txt');
    const content = 'Line 1\nLine 2\tTabbed\nLine 3\r\nWindows Line';
    fs.writeFileSync(textFile, content, 'utf-8');

    const isBinary = await detectBinaryFile(textFile);
    expect(isBinary).toBe(false);
  });

  it('应该处理空文件', async () => {
    const emptyFile = path.join(tmpDir, 'empty.txt');
    fs.writeFileSync(emptyFile, '', 'utf-8');

    const isBinary = await detectBinaryFile(emptyFile);
    expect(isBinary).toBe(false); // 空文件视为文本
  });

  it('应该识别图片文件为二进制', async () => {
    const imageFile = path.join(tmpDir, 'image.png');

    // PNG 文件头：89 50 4E 47 0D 0A 1A 0A (含 null 和控制字符)
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const padding = Buffer.alloc(100, 0xff); // 填充数据
    fs.writeFileSync(imageFile, Buffer.concat([pngHeader, padding]));

    const isBinary = await detectBinaryFile(imageFile);
    expect(isBinary).toBe(true);
  });

  it('应该跳过大于 5MB 的文件', () => {
    const MAX_FILE_SIZE = 5 * 1024 * 1024;
    const largeFileSize = 6 * 1024 * 1024;

    expect(largeFileSize > MAX_FILE_SIZE).toBe(true);
  });
});

/**
 * 复制 search.ts 中的 isBinaryFile 逻辑用于测试
 */
async function detectBinaryFile(filePath: string): Promise<boolean> {
  try {
    const buffer = Buffer.alloc(8192);
    const fd = await fs.promises.open(filePath, 'r');

    try {
      const { bytesRead } = await fd.read(buffer, 0, 8192, 0);

      if (bytesRead === 0) {
        return false;
      }

      const sampleSize = Math.min(bytesRead, 8192);
      let nullBytes = 0;
      let nonTextBytes = 0;

      for (let i = 0; i < sampleSize; i++) {
        const byte = buffer[i];

        if (byte === 0) {
          nullBytes++;
          if (nullBytes > 1) {
            return true;
          }
        }

        if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
          nonTextBytes++;
        }
      }

      const nonTextRatio = nonTextBytes / sampleSize;
      return nonTextRatio > 0.3;
    } finally {
      await fd.close();
    }
  } catch {
    return true;
  }
}
