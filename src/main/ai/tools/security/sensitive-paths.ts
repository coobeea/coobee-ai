/**
 * 敏感路径检测模块
 *
 * 提供敏感文件和目录的黑名单检查，防止 Agent 直接读取或修改敏感信息
 */

import { Env } from '@main/common/env';
import path from 'path';

/**
 * 敏感文件黑名单（相对于用户目录的路径）
 */
const SENSITIVE_FILES = [
  'secrets/secrets.json5', // API Keys
  'secrets/skills.json5', // Skill 配置（可能含 Key/Token）
  '.env', // 环境变量
  '.env.local' // 本地环境变量
];

/**
 * 敏感目录黑名单（相对于用户目录的路径）
 */
const SENSITIVE_DIRS = [
  'secrets' // 整个敏感信息目录
];

/**
 * 检查路径是否为敏感路径
 *
 * @param absolutePath 要检查的绝对路径
 * @returns 如果是敏感路径，返回 { sensitive: true, reason: string }；否则返回 { sensitive: false }
 */
export function checkSensitivePath(absolutePath: string): { sensitive: false } | { sensitive: true; reason: string } {
  const userHome = Env.paths.userHome;

  // 如果路径不在用户目录下，不做限制（例如 workspace 内的文件）
  if (!absolutePath.startsWith(userHome)) {
    return { sensitive: false };
  }

  // 获取相对于用户目录的路径
  const relativePath = path.relative(userHome, absolutePath);

  // 检查是否匹配敏感文件
  for (const sensitiveFile of SENSITIVE_FILES) {
    if (relativePath === sensitiveFile || relativePath.startsWith(sensitiveFile + path.sep)) {
      return {
        sensitive: true,
        reason: `Sensitive file: ${sensitiveFile} (contains API Keys or credentials)`
      };
    }
  }

  // 检查是否在敏感目录下
  for (const sensitiveDir of SENSITIVE_DIRS) {
    if (relativePath.startsWith(sensitiveDir + path.sep) || relativePath === sensitiveDir) {
      return {
        sensitive: true,
        reason: `Sensitive directory: ${sensitiveDir}/ (restricted access)`
      };
    }
  }

  return { sensitive: false };
}

/**
 * 检查路径是否可以被 read 工具访问
 *
 * @param absolutePath 要检查的绝对路径
 * @returns 如果可以访问返回 null，否则返回错误消息
 */
export function canRead(absolutePath: string): string | null {
  const check = checkSensitivePath(absolutePath);
  if (check.sensitive) {
    return `Access denied: ${check.reason}. Use official config APIs instead.`;
  }
  return null;
}

/**
 * 检查路径是否可以被 write 工具访问
 *
 * @param absolutePath 要检查的绝对路径
 * @returns 如果可以访问返回 null，否则返回错误消息
 */
export function canWrite(absolutePath: string): string | null {
  const check = checkSensitivePath(absolutePath);
  if (check.sensitive) {
    return `Access denied: ${check.reason}. Use official config APIs instead.`;
  }
  return null;
}

/**
 * 检查路径是否可以被 exec 工具的脚本访问
 *
 * @param absolutePath 要检查的绝对路径
 * @returns 如果可以访问返回 null，否则返回错误消息
 */
export function canExec(absolutePath: string): string | null {
  const check = checkSensitivePath(absolutePath);
  if (check.sensitive) {
    return `Access denied: ${check.reason}. Cannot execute scripts in sensitive directories.`;
  }
  return null;
}
