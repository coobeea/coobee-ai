/**
 * 流式 <think> 标签解析器
 *
 * 将 LLM 输出中混合的 <think>...</think> 标签实时拆分为
 * 推理内容（reasoning）和正文内容（text）两个独立流。
 *
 * 设计原因：
 *   MiniMax 等模型在 output_text_delta 中将思考过程用 <think> 标签包裹，
 *   与正文混在一起。前端需要跨 delta 片段做流式标签解析，非常复杂。
 *   本解析器在 runtime 层完成拆分，前端零解析负担。
 *
 * 状态机：
 *   NORMAL:
 *     遇到 '<' → MAYBE_TAG（开始缓冲）
 *     其他字符 → 调用 onText
 *
 *   MAYBE_TAG:
 *     缓冲匹配 '<think>' → IN_THINK（调用 onReasoningStart）
 *     缓冲匹配 '</think>' → NORMAL（调用 onReasoningDone）
 *     缓冲不匹配 → flush 到当前输出通道，回到之前状态
 *
 *   IN_THINK:
 *     遇到 '<' → MAYBE_TAG（开始缓冲）
 *     其他字符 → 调用 onReasoning
 *
 * 关键边界处理：
 *   - 标签跨 delta 拆分："<thi" + "nk>\ncontent"
 *   - 标签和正文混合："...\n</think>\n\n我来帮您"
 *   - 大小写不敏感：<Think>、<THINK> 均识别
 *   - 嵌套 <think>：忽略内层（只认第一层）
 */

/**
 * 解析回调接口
 */
export interface ThinkTagCallbacks {
  /** 纯文本内容（<think> 外部） */
  onText: (text: string) => void;
  /** 推理内容（<think> 内部） */
  onReasoning: (text: string) => void;
  /** 进入 <think> 块 */
  onReasoningStart: () => void;
  /** 退出 </think> 块 */
  onReasoningDone: () => void;
}

/** 解析器内部状态 */
const enum State {
  /** 正常文本模式 */
  NORMAL = 0,
  /** 在 <think> 内部 */
  IN_THINK = 1,
  /** 可能是标签（正在缓冲匹配中） */
  MAYBE_TAG = 2
}

/** 开始标签（小写） */
const OPEN_TAG = '<think>';
/** 结束标签（小写） */
const CLOSE_TAG = '</think>';

export class ThinkTagParser {
  private state: State = State.NORMAL;
  /** MAYBE_TAG 之前的状态（用于回退） */
  private prevState: State = State.NORMAL;
  /** 标签缓冲 */
  private tagBuffer = '';
  /** 文本批量输出缓冲（减少回调次数） */
  private textBatch = '';
  /** 推理批量输出缓冲 */
  private reasoningBatch = '';

  constructor(private readonly callbacks: ThinkTagCallbacks) {}

  /**
   * 喂入一个 delta 片段
   *
   * 逐字符处理，通过回调输出拆分后的文本和推理内容。
   */
  feed(delta: string): void {
    for (let i = 0; i < delta.length; i++) {
      const ch = delta[i];

      switch (this.state) {
        case State.NORMAL:
          if (ch === '<') {
            // 可能是标签开头，进入缓冲模式
            this.flushTextBatch();
            this.prevState = State.NORMAL;
            this.state = State.MAYBE_TAG;
            this.tagBuffer = '<';
          } else {
            this.textBatch += ch;
          }
          break;

        case State.IN_THINK:
          if (ch === '<') {
            // 可能是 </think> 结束标签
            this.flushReasoningBatch();
            this.prevState = State.IN_THINK;
            this.state = State.MAYBE_TAG;
            this.tagBuffer = '<';
          } else {
            this.reasoningBatch += ch;
          }
          break;

        case State.MAYBE_TAG:
          this.tagBuffer += ch;
          this.evaluateTagBuffer();
          break;
      }
    }

    // delta 处理完毕，flush 批量缓冲（但不 flush tagBuffer，可能跨 delta）
    this.flushTextBatch();
    this.flushReasoningBatch();
  }

  /**
   * 流结束时调用，flush 残余的 tagBuffer
   *
   * 如果有未完成的标签匹配，将缓冲内容作为普通内容输出。
   */
  flush(): void {
    if (this.tagBuffer) {
      // 未匹配完的标签 → 按当前状态输出
      if (this.prevState === State.IN_THINK) {
        this.reasoningBatch += this.tagBuffer;
      } else {
        this.textBatch += this.tagBuffer;
      }
      this.tagBuffer = '';
      this.state = this.prevState;
    }
    this.flushTextBatch();
    this.flushReasoningBatch();
  }

  /**
   * 重置解析器状态
   *
   * 在新的 response/turn 开始时调用。
   */
  reset(): void {
    this.state = State.NORMAL;
    this.prevState = State.NORMAL;
    this.tagBuffer = '';
    this.textBatch = '';
    this.reasoningBatch = '';
  }

  /** 当前是否在 <think> 块内 */
  get isInThinking(): boolean {
    return this.state === State.IN_THINK || (this.state === State.MAYBE_TAG && this.prevState === State.IN_THINK);
  }

  // ========== 内部方法 ==========

  /**
   * 评估 tagBuffer 是否匹配已知标签
   */
  private evaluateTagBuffer(): void {
    const bufferLower = this.tagBuffer.toLowerCase();

    // 检查是否完整匹配 <think>
    if (bufferLower === OPEN_TAG) {
      this.tagBuffer = '';
      if (this.prevState === State.NORMAL) {
        // 从 NORMAL 进入 IN_THINK
        this.state = State.IN_THINK;
        this.callbacks.onReasoningStart();
      } else {
        // 嵌套 <think>，忽略内层标签，当作推理内容
        this.state = State.IN_THINK;
      }
      return;
    }

    // 检查是否完整匹配 </think>
    if (bufferLower === CLOSE_TAG) {
      this.tagBuffer = '';
      if (this.prevState === State.IN_THINK) {
        // 从 IN_THINK 回到 NORMAL
        this.state = State.NORMAL;
        this.callbacks.onReasoningDone();
      } else {
        // NORMAL 状态下遇到 </think>，当作普通文本
        this.textBatch += CLOSE_TAG;
        this.state = State.NORMAL;
      }
      return;
    }

    // 检查是否仍然可能匹配（是某个标签的前缀）
    if (this.isPrefixOfTag(bufferLower)) {
      // 继续缓冲，等待更多字符
      return;
    }

    // 不匹配任何标签 → flush 缓冲内容到对应通道
    if (this.prevState === State.IN_THINK) {
      this.reasoningBatch += this.tagBuffer;
    } else {
      this.textBatch += this.tagBuffer;
    }
    this.tagBuffer = '';
    this.state = this.prevState;
  }

  /**
   * 检查缓冲是否是 <think> 或 </think> 的前缀
   */
  private isPrefixOfTag(bufferLower: string): boolean {
    const len = bufferLower.length;
    return (
      (len <= OPEN_TAG.length && OPEN_TAG.startsWith(bufferLower)) ||
      (len <= CLOSE_TAG.length && CLOSE_TAG.startsWith(bufferLower))
    );
  }

  /** flush 文本批量缓冲 */
  private flushTextBatch(): void {
    if (this.textBatch) {
      this.callbacks.onText(this.textBatch);
      this.textBatch = '';
    }
  }

  /** flush 推理批量缓冲 */
  private flushReasoningBatch(): void {
    if (this.reasoningBatch) {
      this.callbacks.onReasoning(this.reasoningBatch);
      this.reasoningBatch = '';
    }
  }
}

/**
 * 工具函数：从文本中移除 <think>...</think> 标签及内容
 *
 * 用于 response_done 时清洗完整文本。
 * 与 SessionCompressor 中的 stripThinkTags 逻辑一致。
 */
export function stripThinkTags(text: string): string {
  if (!text) return '';
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}
