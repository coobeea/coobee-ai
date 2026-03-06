/**
 * memory-global 配置
 */

export interface MemoryGlobalConfig {
  /** 是否启用自动捕获（agent_end 时） */
  autoCapture: boolean;
  /** 是否启用自动召回（before_agent_start 时） */
  autoRecall: boolean;
  /** 捕获最大字符数（超过此长度的输出会被截断） */
  captureMaxChars: number;
  /** 捕获最小字符数（低于此长度的输出会被忽略） */
  captureMinChars: number;
  /** 召回结果最大数量（Top-K） */
  recallTopK: number;
  /** 召回最低分数（低于此分数的结果会被过滤） */
  recallMinScore: number;
}

/** 默认配置 */
export const DEFAULT_CONFIG: MemoryGlobalConfig = {
  autoCapture: true,
  autoRecall: true,
  captureMaxChars: 500,
  captureMinChars: 10,
  recallTopK: 5,
  recallMinScore: 0.7
};
