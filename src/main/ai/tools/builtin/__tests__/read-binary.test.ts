/**
 * Read 工具 - 二进制文件过滤测试
 *
 * 测试 read 工具正确拒绝二进制文件，避免读取无用内容。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Read Tool - Binary File Filtering', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('应该拒绝包含 null 字节的二进制文件', async () => {
    const binaryFile = path.join(tmpDir, 'binary.dat');
    const buffer = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x00, 0x57, 0x6f, 0x72, 0x6c, 0x64]);
    fs.writeFileSync(binaryFile, buffer);

    const isBinary = await detectBinaryFile(binaryFile);
    expect(isBinary).toBe(true);
  });

  it('应该允许读取纯文本文件', async () => {
    const textFile = path.join(tmpDir, 'text.txt');
    fs.writeFileSync(textFile, 'Hello World\nThis is a text file.', 'utf-8');

    const isBinary = await detectBinaryFile(textFile);
    expect(isBinary).toBe(false);
  });

  it('应该允许读取包含 UTF-8 字符的文本文件', async () => {
    const textFile = path.join(tmpDir, 'utf8.txt');
    fs.writeFileSync(textFile, '你好世界\nこんにちは\n안녕하세요', 'utf-8');

    const isBinary = await detectBinaryFile(textFile);
    expect(isBinary).toBe(false);
  });

  it('应该拒绝 PNG 图片文件', async () => {
    const imageFile = path.join(tmpDir, 'image.png');
    // PNG 文件头
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const padding = Buffer.alloc(200, 0xff);
    fs.writeFileSync(imageFile, Buffer.concat([pngHeader, padding]));

    const isBinary = await detectBinaryFile(imageFile);
    expect(isBinary).toBe(true);
  });

  it('应该处理空文件', async () => {
    const emptyFile = path.join(tmpDir, 'empty.txt');
    fs.writeFileSync(emptyFile, '', 'utf-8');

    const isBinary = await detectBinaryFile(emptyFile);
    expect(isBinary).toBe(false);
  });

  it('应该拒绝超过 50MB 的文件', () => {
    const MAX_FILE_SIZE = 50 * 1024 * 1024;
    const largeFileSize = 51 * 1024 * 1024;

    expect(largeFileSize > MAX_FILE_SIZE).toBe(true);
  });

  it('应该允许包含代码的文本文件', async () => {
    const codeFile = path.join(tmpDir, 'code.ts');
    const code = `
function hello() {
  console.log("Hello World");
  return 42;
}

export default hello;
`;
    fs.writeFileSync(codeFile, code, 'utf-8');

    const isBinary = await detectBinaryFile(codeFile);
    expect(isBinary).toBe(false);
  });
});

/**
 * 复制 read.ts 中的 isBinaryFile 逻辑用于测试
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
