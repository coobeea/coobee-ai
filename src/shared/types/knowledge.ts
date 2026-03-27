export interface KnowledgeBaseMeta {
  id: string;
  name: string;
  description: string;
  chapterCount: number;
  totalFiles: number;
  createdAt: number;
  updatedAt: number;
  /** 来源（创建流水线 session ID，可选） */
  sourceSessionId?: string;
}

export interface KnowledgeTreeNode {
  name: string;
  path: string;
  type: 'directory' | 'file';
  children?: KnowledgeTreeNode[];
}
