import crypto from 'crypto'
import os from 'os'
import { getMachineId } from '../common/platform'
import { log } from '../common/logger'

/**
 * 生成机器指纹
 * @deprecated 推荐使用 @main/common 中的 getMachineId()
 * @returns 机器指纹的 SHA256 哈希值
 */
export async function generateMachineFingerprint(): Promise<string> {
  log.debug('生成机器指纹...')

  try {
    // 使用新的 getMachineId 方法，它基于硬件序列号更加稳定
    const machineId = await getMachineId()

    log.debug('生成的机器指纹哈希:', machineId.substring(0, 16) + '...')

    return machineId
  } catch (error) {
    log.error('生成机器指纹失败:', error)
    throw error
  }
}

/**
 * 同步版本的机器指纹生成（使用简化算法）
 * @deprecated 推荐使用异步的 generateMachineFingerprint() 或 @main/common 中的 getMachineId()
 * @returns 机器指纹的 SHA256 哈希值
 */
export function generateMachineFingerprintSync(): string {
  const features = [
    os.platform(),
    os.arch(),
    os.type(),
    process.env.USERNAME || process.env.USER || 'unknown'
  ]

  log.debug('机器指纹特征（同步）:', {
    platform: os.platform(),
    arch: os.arch(),
    type: os.type(),
    username: process.env.USERNAME || process.env.USER || 'unknown'
  })

  const hash = crypto.createHash('sha256')
  features.forEach((feature) => hash.update(String(feature)))

  const fingerprint = hash.digest('hex')
  log.debug('生成的机器指纹哈希（同步）:', fingerprint.substring(0, 16) + '...')

  return fingerprint
}
