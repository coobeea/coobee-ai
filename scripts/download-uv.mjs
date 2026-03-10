/**
 * 下载 uv 工具 - Python 包管理器
 *
 * 用途：自动下载所有平台的 uv 二进制文件到 runtime/ 目录
 * 时机：npm install 时通过 postinstall 自动执行
 */

import fetch from 'node-fetch';
import { createWriteStream, existsSync, mkdirSync, unlinkSync, renameSync, rmSync } from 'fs';
import { join } from 'path';
import fs from 'fs';
import { pipeline } from 'stream';
import { promisify } from 'util';
import { extract } from 'tar';
import AdmZip from 'adm-zip';

const streamPipeline = promisify(pipeline);

// ==================== 配置区 ====================

const UV_VERSION = '0.7.13';
// 支持镜像源（通过环境变量覆盖）
const BASE_URL = process.env.UV_MIRROR_URL || `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}`;
const RUNTIME_DIR = './runtime';
const MAX_RETRIES = 3; // 最大重试次数
const RETRY_DELAY = 2000; // 重试延迟（毫秒）

// 目标平台配置
const TARGET_PLATFORMS = [
  {
    platform: 'linux',
    arch: 'x64',
    filename: 'uv-x86_64-unknown-linux-gnu.tar.gz',
    extractSubdir: 'linux-x64',
    exeName: 'uv'
  },
  {
    platform: 'linux',
    arch: 'arm64',
    filename: 'uv-aarch64-unknown-linux-gnu.tar.gz',
    extractSubdir: 'linux-arm64',
    exeName: 'uv'
  },
  {
    platform: 'darwin',
    arch: 'x64',
    filename: 'uv-x86_64-apple-darwin.tar.gz',
    extractSubdir: 'macos-x64',
    exeName: 'uv'
  },
  {
    platform: 'darwin',
    arch: 'arm64',
    filename: 'uv-aarch64-apple-darwin.tar.gz',
    extractSubdir: 'macos-arm64',
    exeName: 'uv'
  },
  {
    platform: 'win32',
    arch: 'x64',
    filename: 'uv-x86_64-pc-windows-msvc.zip',
    extractSubdir: 'win',
    exeName: 'uv.exe'
  }
];

// ==================== 核心函数 ====================

/**
 * 下载并解压 uv 工具
 * @param {object} target - 目标平台配置
 */
async function downloadAndExtractUV(target) {
  const { platform, arch, filename, extractSubdir, exeName } = target;
  const url = `${BASE_URL}/${filename}`;
  const extractPath = join(RUNTIME_DIR, extractSubdir);
  const destPath = join(extractPath, exeName);

  // 1. 确保目录存在
  if (!existsSync(extractPath)) {
    mkdirSync(extractPath, { recursive: true });
  }

  // 2. 检查是否已存在
  if (existsSync(destPath)) {
    console.log(`✓ uv for ${platform}-${arch} already exists, skipping.`);
    return;
  }

  const tempFilePath = join(RUNTIME_DIR, filename);
  console.log(`\n→ Downloading uv for ${platform}-${arch}...`);
  console.log(`  URL: ${url}`);

  try {
    // 3. 下载文件（带重试）
    await downloadWithRetry(url, tempFilePath, MAX_RETRIES);
    console.log(`  Downloaded ${filename}`);

    // 4. 解压文件
    if (filename.endsWith('.tar.gz')) {
      await extract({
        cwd: extractPath,
        file: tempFilePath,
        strip: 0
      });

      // 移动 uv 到根目录
      const extractedDirName = filename.replace('.tar.gz', '');
      const uvInExtractedDir = join(extractPath, extractedDirName, exeName);
      const uvAtTopLevel = join(extractPath, exeName);

      if (existsSync(uvInExtractedDir)) {
        // uv 在子目录中
        if (existsSync(destPath)) {
          unlinkSync(destPath);
        }
        renameSync(uvInExtractedDir, destPath);
        console.log(`  Extracted and moved ${exeName}`);

        // 删除临时目录
        rmSync(join(extractPath, extractedDirName), { recursive: true, force: true });
      } else if (existsSync(uvAtTopLevel)) {
        // uv 在顶层（某些版本的结构不同）
        if (existsSync(destPath)) {
          unlinkSync(destPath);
        }
        renameSync(uvAtTopLevel, destPath);
        console.log(`  Extracted and moved ${exeName}`);
      } else {
        throw new Error(`Could not find ${exeName} executable in the extracted archive for ${platform}-${arch}`);
      }
    } else if (filename.endsWith('.zip')) {
      const zip = new AdmZip(tempFilePath);
      zip.extractAllTo(extractPath, true);
      console.log(`  Extracted ${filename}`);
    }

    console.log(`✓ uv for ${platform}-${arch} installed successfully.`);
  } catch (error) {
    console.error(`✗ Error downloading uv for ${platform}-${arch}:`, error.message);
    console.error(`  Tip: 如果网络不稳定，可以手动下载后放入 ${extractPath}/`);
    // 不抛出错误，继续下载其他平台
    return false;
  } finally {
    // 5. 清理临时文件
    if (existsSync(tempFilePath)) {
      unlinkSync(tempFilePath);
    }
  }
}

/**
 * 下载文件（带重试）
 * @param {string} url - 下载 URL
 * @param {string} destPath - 目标路径
 * @param {number} maxRetries - 最大重试次数
 */
async function downloadWithRetry(url, destPath, maxRetries) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        timeout: 60000 // 60 秒超时
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      await streamPipeline(response.body, createWriteStream(destPath));
      return; // 下载成功
    } catch (error) {
      console.error(`  Attempt ${attempt}/${maxRetries} failed: ${error.message}`);

      if (attempt < maxRetries) {
        console.log(`  Retrying in ${RETRY_DELAY / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      } else {
        throw error; // 所有重试都失败
      }
    }
  }
}

/**
 * 下载所有平台的 uv
 */
async function downloadAllUVs() {
  console.log('================================================================================');
  console.log('  Downloading uv (Python package manager) for all platforms');
  console.log('================================================================================');

  // 确保 runtime 目录存在
  if (!existsSync(RUNTIME_DIR)) {
    mkdirSync(RUNTIME_DIR, { recursive: true });
  }

  // 下载所有平台
  let successCount = 0;
  let failCount = 0;

  for (const target of TARGET_PLATFORMS) {
    const result = await downloadAndExtractUV(target);
    if (result === false) {
      failCount++;
    } else {
      successCount++;
    }
  }

  console.log(`\nSummary: ${successCount} succeeded, ${failCount} failed`);

  console.log('\n================================================================================');
  console.log('  Preparing for local development');
  console.log('================================================================================');

  // 为本地开发复制当前平台的二进制
  await copyForLocalDevelopment();

  if (failCount > 0) {
    console.log('\n⚠ Warning: Some platforms failed to download.');
    console.log('  You can manually download from: https://github.com/astral-sh/uv/releases');
    console.log('  Or set UV_MIRROR_URL environment variable to use a mirror.');
  } else {
    console.log('\n✓ All uv executables processed successfully.');
  }
  console.log('================================================================================\n');
}

/**
 * 为本地开发复制当前平台的二进制
 */
async function copyForLocalDevelopment() {
  if (process.platform === 'darwin' || process.platform === 'linux') {
    const osDir = process.platform === 'darwin' ? 'macos' : 'linux';
    const arch = process.arch;
    const sourceDir = join(RUNTIME_DIR, `${osDir}-${arch}`);
    const targetDir = join(RUNTIME_DIR, osDir);
    const sourceFile = join(sourceDir, 'uv');
    const targetFile = join(targetDir, 'uv');

    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    if (existsSync(sourceFile)) {
      console.log(`\n→ Copying uv for local development (${osDir} ${arch})...`);
      fs.copyFileSync(sourceFile, targetFile);
      console.log(`✓ uv copied to ${targetDir}/`);
    } else {
      console.warn(`⚠ Warning: Source file not found: ${sourceFile}`);
    }
  } else if (process.platform === 'win32') {
    // Windows 使用 win 目录，不需要复制
    console.log(`\n✓ Windows uses runtime/win/ directly.`);
  }
}

// ==================== 执行 ====================

void downloadAllUVs().catch((error) => {
  console.error('\n✗ Download failed:', error);
  process.exit(1);
});
