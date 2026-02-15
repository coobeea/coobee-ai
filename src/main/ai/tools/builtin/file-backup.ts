/**
 * 文件版本备份 — 轻量级文件修改前自动备份
 *
 * 在 write/edit 工具修改文件前，将当前版本备份到 .versions/ 目录。
 * 备份策略：
 *   - 文件名格式：{相对路径}.{timestamp}
 *   - 仅备份已存在的文件（新建文件无需备份）
 *   - 备份失败不阻断写入操作（静默降级）
 *   - 自动清理：每个文件最多保留 10 个版本
 *
 * 目录结构示例：
 *   .versions/
 *     src/index.ts.2026-02-15T14-30-00-000
 *     src/index.ts.2026-02-15T15-00-00-000
 *     package.json.2026-02-15T14-30-00-000
 */

import fs from 'node:fs'
import path from 'node:path'

/** 每个文件最多保留的版本数量 */
const MAX_VERSIONS_PER_FILE = 10

/** .versions 目录名 */
const VERSIONS_DIR = '.versions'

/**
 * 在写入/编辑文件前备份当前版本
 *
 * @param absolutePath 要修改的文件的绝对路径
 * @param workspaceRoot 工作空间根目录
 * @returns 备份文件路径，或 null（文件不存在或备份失败）
 */
export function backupBeforeWrite(absolutePath: string, workspaceRoot: string): string | null {
  try {
    // 文件不存在（新建场景），无需备份
    if (!fs.existsSync(absolutePath)) return null

    // 计算相对路径和备份路径
    const relativePath = path.relative(workspaceRoot, absolutePath)

    // 安全检查：不备份 .versions 目录自身
    if (relativePath.startsWith(VERSIONS_DIR)) return null

    // 安全检查：不备份工作空间外的文件
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return null

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupRelPath = `${relativePath}.${timestamp}`
    const backupPath = path.join(workspaceRoot, VERSIONS_DIR, backupRelPath)

    // 确保备份目录存在
    fs.mkdirSync(path.dirname(backupPath), { recursive: true })

    // 复制文件
    fs.copyFileSync(absolutePath, backupPath)

    // 异步清理旧版本（不阻塞）
    cleanupOldVersions(workspaceRoot, relativePath).catch(() => {})

    return backupPath
  } catch {
    // 备份失败不阻断主流程
    return null
  }
}

/**
 * 清理旧版本，保留最新的 MAX_VERSIONS_PER_FILE 个
 */
async function cleanupOldVersions(workspaceRoot: string, relativePath: string): Promise<void> {
  const versionsDir = path.join(workspaceRoot, VERSIONS_DIR, path.dirname(relativePath))
  if (!fs.existsSync(versionsDir)) return

  const fileName = path.basename(relativePath)
  const entries = fs.readdirSync(versionsDir)

  // 筛选出同一文件的所有版本（格式：{filename}.{timestamp}）
  const versions = entries
    .filter((e) => e.startsWith(fileName + '.'))
    .map((name) => ({
      name,
      path: path.join(versionsDir, name),
      time: fs.statSync(path.join(versionsDir, name)).mtimeMs
    }))
    .sort((a, b) => b.time - a.time) // 最新的在前

  // 删除超出限制的旧版本
  if (versions.length > MAX_VERSIONS_PER_FILE) {
    const toDelete = versions.slice(MAX_VERSIONS_PER_FILE)
    for (const v of toDelete) {
      try {
        fs.unlinkSync(v.path)
      } catch {
        // 忽略清理失败
      }
    }
  }
}
