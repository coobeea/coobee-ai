/**
 * 预览模式类型定义
 */

export type PreviewMode = 'code' | 'pdf' | 'image' | 'video' | 'html' | 'markdown' | 'web';

export interface PreviewItem {
  path: string;
  mode: PreviewMode;
  mimeType?: string;
}
