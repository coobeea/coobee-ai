/**
 * PreviewRouter - 根据文件类型选择合适的预览组件
 */

export type PreviewMode = 'pdf' | 'image' | 'video' | 'html' | 'markdown' | 'code';

export interface PreviewRouterResult {
  mode: PreviewMode;
  mimeType?: string;
}

/**
 * 根据文件路径和 MIME 类型确定预览模式
 */
export function routePreview(filePath: string, mimeType?: string): PreviewRouterResult {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';

  // PDF
  if (ext === 'pdf' || mimeType === 'application/pdf') {
    return { mode: 'pdf', mimeType: 'application/pdf' };
  }

  // 图片
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext) || mimeType?.startsWith('image/')) {
    return { mode: 'image', mimeType: mimeType || `image/${ext}` };
  }

  // 视频
  if (['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'].includes(ext) || mimeType?.startsWith('video/')) {
    return { mode: 'video', mimeType: mimeType || `video/${ext}` };
  }

  // HTML
  if (ext === 'html' || ext === 'htm' || mimeType === 'text/html') {
    return { mode: 'html', mimeType: 'text/html' };
  }

  // Markdown
  if (['md', 'markdown', 'mdx'].includes(ext) || mimeType === 'text/markdown') {
    return { mode: 'markdown', mimeType: 'text/markdown' };
  }

  // 默认：代码编辑器
  return { mode: 'code', mimeType: mimeType || 'text/plain' };
}
