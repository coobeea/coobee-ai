/**
 * 实时洞察模块共享类型（前后端共用）
 */

// ==================== 维度类型 ====================

export type DimensionType = 'enum' | 'score' | 'text' | 'list' | 'boolean' | 'tags' | 'progress' | 'comparison';

// ==================== 分析模板 ====================

export interface AnalysisDimension {
  key: string;
  label: string;
  type: DimensionType;
  prompt: string;
  icon?: string;
  options?: string[];
  maxItems?: number;
  stages?: string[];
  showTrend?: boolean;
  required?: boolean;
}

export interface RefreshStrategy {
  trigger: 'silence' | 'interval' | 'manual' | 'hybrid' | 'content' | 'smart';
  /** 定时间隔（秒），用于 interval / hybrid 模式的兜底检查 */
  intervalSeconds?: number;
  /** 最小新增字符数：interval/silence 模式下需要累积这么多字才触发 */
  minNewChars?: number;
  /** 静默毫秒数 */
  silenceMs?: number;
  /** 内容驱动：新增字符达到此数量立即触发（默认 50） */
  charThreshold?: number;
  /** 智能触发：新增字符达到此数量 + 末尾标点 → 立即触发（默认 20） */
  smartThreshold?: number;
  /** 防抖毫秒数：停止输入后多久触发（默认 3000） */
  debounceMs?: number;
}

export type TemplateCategory = 'sales' | 'service' | 'meeting' | 'interview' | 'custom';

export interface AnalysisTemplate {
  id: string;
  name: string;
  description: string;
  icon?: string;
  category: TemplateCategory;
  dimensions: AnalysisDimension[];
  analysisPrompt: string;
  refreshStrategy: RefreshStrategy;
  outputFormat?: 'card' | 'table' | 'timeline';
  builtIn: boolean;
  createdAt: number;
  updatedAt: number;
}

// ==================== 分析结果 ====================

export interface DimensionValue {
  key: string;
  label: string;
  type: DimensionType;
  value: unknown;
  rawText?: string;
}

export interface AnalysisResult {
  dimensions: Record<string, DimensionValue>;
  summary?: string;
  confidence?: number;
}

export interface DimensionChange {
  key: string;
  label: string;
  previousValue: unknown;
  currentValue: unknown;
  direction: 'up' | 'down' | 'stable' | 'changed';
}

// ==================== 分析快照 ====================

export interface AnalysisSnapshot {
  id: string;
  sessionId: string;
  sequence: number;
  timestamp: number;
  trigger: 'silence' | 'interval' | 'manual';
  transcriptRange: { start: number; end: number };
  fullTranscript: string;
  newText: string;
  result: AnalysisResult;
  changes?: DimensionChange[];
  tokenUsage?: { prompt: number; completion: number };
  latencyMs: number;
}

// ==================== 洞察会话 ====================

export type InsightSessionStatus = 'recording' | 'paused' | 'analyzing' | 'completed';

export interface SessionConfig {
  analysisPrompt?: string;
  dimensions?: AnalysisDimension[];
  refreshStrategy?: RefreshStrategy;
  knowledgeBase?: string[];
}

export interface InsightSession {
  id: string;
  templateId: string;
  templateName: string;
  status: InsightSessionStatus;
  startTime: number;
  endTime?: number;
  transcript: string;
  snapshotCount: number;
  latestResult?: AnalysisResult;
  metadata?: Record<string, unknown>;
  config?: SessionConfig;
}
