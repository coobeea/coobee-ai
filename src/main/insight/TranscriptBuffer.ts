/**
 * TranscriptBuffer — ASR 文本累积缓冲区
 *
 * 管理从 ASR 接收的文本流，跟踪上次分析位置。
 */

export class TranscriptBuffer {
  private fullText = '';
  private lastAnalyzedPos = 0;

  append(text: string): void {
    this.fullText += text;
  }

  getFullText(): string {
    return this.fullText;
  }

  getNewText(): string {
    return this.fullText.slice(this.lastAnalyzedPos);
  }

  getNewCharCount(): number {
    return this.fullText.length - this.lastAnalyzedPos;
  }

  getLastAnalyzedPos(): number {
    return this.lastAnalyzedPos;
  }

  markAnalyzed(): void {
    this.lastAnalyzedPos = this.fullText.length;
  }

  reset(): void {
    this.fullText = '';
    this.lastAnalyzedPos = 0;
  }
}
