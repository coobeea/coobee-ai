export type KnowledgeBaseStatus = 'empty' | 'building' | 'ready' | 'error';

export interface KnowledgeBaseMeta {
  id: string;
  name: string;
  description: string;
  status: KnowledgeBaseStatus;
  chapterCount: number;
  totalFiles: number;
  sourceCount: number;
  createdAt: number;
  updatedAt: number;
  /** 构建进度描述 */
  buildProgress?: string;
  /** 来源（创建流水线 session ID，可选） */
  sourceSessionId?: string;
}

export interface SourceMaterial {
  name: string;
  path: string;
  type: 'zip' | 'pdf' | 'word' | 'markdown' | 'text' | 'image' | 'other';
  size: number;
  addedAt: number;
}

export interface KnowledgeTreeNode {
  name: string;
  path: string;
  type: 'directory' | 'file';
  children?: KnowledgeTreeNode[];
}
