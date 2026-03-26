/**
 * memory-agent 配置
 */

export interface MemorySmartConfig {
  /** 是否启用自动捕获 */
  autoCapture: boolean;
  /** 捕获最小字符数 */
  captureMinChars: number;
  /** 捕获最大字符数 */
  captureMaxChars: number;
}

export const DEFAULT_CONFIG: MemorySmartConfig = {
  autoCapture: true,
  captureMinChars: 10,
  captureMaxChars: 10000 // 临时放大，用于调试
};
