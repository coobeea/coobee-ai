/**
 * 获取文件预览 URL
 *
 * 对于二进制文件（PDF、图片、视频等），通过 Gateway /files/serve 端点加载。
 * 支持文件路径和已有 content 的情况。
 */

import configManager from '@/config';
import { determinePreviewMode, type PreviewMode } from '@/utils/previewRouter';

const PREVIEWABLE_BINARY_MODES: PreviewMode[] = ['pdf', 'image', 'video'];

/**
 * 获取用于预览的 URL
 *
 * @param filePath 文件路径
 * @param content 文件内容（base64 或文本，可选）
 * @param mimeType MIME 类型（用于 data URL，可选）
 * @returns 可用于预览的 URL
 */
export function getFilePreviewUrl(filePath: string, content?: string, mimeType?: string): string {
  const mode = determinePreviewMode(filePath);

  // 有 content 时根据类型使用 data URL
  if (content) {
    if (mode === 'image') {
      return `data:image/png;base64,${content}`;
    }
    if (mode === 'video') {
      return `data:${mimeType || 'video/mp4'};base64,${content}`;
    }
    if (mode === 'html') {
      const blob = new Blob([content], { type: 'text/html' });
      return URL.createObjectURL(blob);
    }
  }

  // 二进制文件（无 content）：使用 Gateway serve 端点
  if (PREVIEWABLE_BINARY_MODES.includes(mode as (typeof PREVIEWABLE_BINARY_MODES)[number])) {
    const baseUrl = configManager.getBaseUrl();
    return `${baseUrl}/gateway/files/serve?path=${encodeURIComponent(filePath)}`;
  }

  // 文本文件：使用 file:// 协议（Electron 本地路径）
  return `file://${filePath.startsWith('/') ? '' : '/'}${filePath}`;
}
