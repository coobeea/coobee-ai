/**
 * electron-builder 打包前处理脚本
 *
 * 作用：根据目标平台和架构，复制对应的运行时二进制到通用目录
 * 目的：减小最终打包体积，只包含目标平台的二进制文件
 */

const fs = require('fs')
const path = require('path')
const { Arch } = require('electron-builder')

/**
 * electron-builder beforePack hook
 *
 * @param {import('electron-builder').BeforeBuildContext} context
 * @returns {Promise<void>}
 */
exports.default = async function (context) {
  const arch = context.arch === Arch.x64 ? 'x64' : context.arch === Arch.arm64 ? 'arm64' : null
  const platform = context.packager.platform.name

  console.log(`\n[before-pack] Preparing runtime binaries for ${platform} ${arch}...`)

  if (platform === 'mac') {
    if (arch === 'x64' || arch === 'arm64') {
      copyRuntimeBinaries(`macos-${arch}`, 'macos', arch)
    }
  } else if (platform === 'linux') {
    if (arch === 'x64' || arch === 'arm64') {
      copyRuntimeBinaries(`linux-${arch}`, 'linux', arch)
    }
  } else if (platform === 'windows') {
    if (arch === 'x64') {
      copyRuntimeBinaries('win', 'win', arch)
    }
  }

  console.log('[before-pack] Runtime binaries prepared successfully.\n')
}

/**
 * 复制运行时二进制文件
 *
 * @param {string} sourceSubDir - 源子目录（如 macos-arm64）
 * @param {string} targetSubDir - 目标子目录（如 macos）
 * @param {string} arch - 架构（x64 或 arm64）
 */
function copyRuntimeBinaries(sourceSubDir, targetSubDir, arch) {
  const sourceDir = path.join(__dirname, '..', 'runtime', sourceSubDir)
  const targetDir = path.join(__dirname, '..', 'runtime', targetSubDir)

  // 检查源目录是否存在
  if (!fs.existsSync(sourceDir)) {
    console.warn(`[before-pack] Warning: Source directory not found: ${sourceDir}`)
    console.warn('[before-pack] Skipping binary copy. Runtime may not work in production.')
    return
  }

  // 创建目标目录
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true })
  }

  // 复制所有文件
  try {
    const files = fs.readdirSync(sourceDir)

    if (files.length === 0) {
      console.warn(`[before-pack] Warning: Source directory is empty: ${sourceDir}`)
      return
    }

    for (const file of files) {
      const sourceFile = path.join(sourceDir, file)
      const targetFile = path.join(targetDir, file)

      // 跳过目录
      if (fs.statSync(sourceFile).isDirectory()) {
        continue
      }

      fs.copyFileSync(sourceFile, targetFile)
      console.log(`[before-pack]   ✓ Copied ${file} for ${targetSubDir} ${arch}`)
    }

    console.log(`[before-pack] All binaries for ${targetSubDir} ${arch} copied successfully.`)
  } catch (error) {
    console.error(`[before-pack] Error copying binaries: ${error.message}`)
    throw error
  }
}
