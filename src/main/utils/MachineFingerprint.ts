import crypto from 'crypto'

import { log } from '../logger'

export function generateMachineFingerprint(): string {
  const os = require('os')

  const features = [
    os.platform(),
    os.arch(),
    os.type(),
    process.env.USERNAME || process.env.USER || 'unknown'
  ]

  log.debug('机器指纹特征:', {
    platform: os.platform(),
    arch: os.arch(),
    type: os.type(),
    username: process.env.USERNAME || process.env.USER || 'unknown'
  })

  const hash = crypto.createHash('sha256')
  features.forEach((feature) => hash.update(String(feature)))

  const fingerprint = hash.digest('hex')
  log.debug('生成的机器指纹哈希:', fingerprint.substring(0, 16) + '...')

  return fingerprint
}
