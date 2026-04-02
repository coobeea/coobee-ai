/**
 * InsightAnalyzer — 分析执行器
 *
 * 调用 insight-analyst Agent 执行实时分析，解析 LLM 输出为结构化结果。
 */

import { log } from '@main/common/logger';
import { ChannelRuntime } from '@main/channels/ChannelRuntime';
import { generateSnowflakeId } from '@main/utils/SnowflakeIdGenerator';
import type { AnalysisTemplate, AnalysisResult, DimensionChange, DimensionValue } from '@shared/types/insight';

export interface AnalyzeParams {
  template: AnalysisTemplate;
  fullTranscript: string;
  newText: string;
  previousResult?: AnalysisResult;
  snapshotSequence: number;
}

export interface AnalyzeOutput {
  result: AnalysisResult;
  changes?: DimensionChange[];
}

export class InsightAnalyzer {
  private runtime: ChannelRuntime;

  constructor() {
    this.runtime = ChannelRuntime.getInstance();
  }

  async analyze(params: AnalyzeParams): Promise<AnalyzeOutput> {
    const { template, fullTranscript, newText, previousResult, snapshotSequence } = params;

    const prompt = this.buildPrompt(template, fullTranscript, newText, previousResult, snapshotSequence);

    // 🔧 使用标准 Snowflake ID
    const result = await this.runtime.executeAgent({
      agentId: 'insight-analyst',
      sessionId: generateSnowflakeId(),
      message: prompt,
      context: {
        channel: 'insight',
        source: 'insight-analyzer',
        templateId: template.id
      }
    });

    if (result.error) {
      log.error(`[InsightAnalyzer] Agent execution failed: ${result.error}`);
      throw new Error(`分析失败: ${result.error}`);
    }

    const analysisResult = this.parseResult(result.output, template);
    const changes = previousResult ? this.detectChanges(previousResult, analysisResult) : undefined;

    return { result: analysisResult, changes };
  }

  private buildPrompt(
    template: AnalysisTemplate,
    fullTranscript: string,
    newText: string,
    previousResult: AnalysisResult | undefined,
    sequence: number
  ): string {
    const dimensionSpec = template.dimensions
      .map((d) => {
        let spec = `- ${d.label}（key: "${d.key}", type: "${d.type}"）: ${d.prompt}`;
        if (d.options) spec += `\n  选项: ${d.options.join(', ')}`;
        if (d.stages) spec += `\n  阶段: ${d.stages.join(' → ')}`;
        if (d.maxItems) spec += `\n  最多 ${d.maxItems} 项`;
        return spec;
      })
      .join('\n');

    let prompt = `## 分析任务（第 ${sequence} 次分析）

${template.analysisPrompt}

### 需要分析的维度

${dimensionSpec}

### 输出格式（严格 JSON）

\`\`\`json
{
  "dimensions": {
    "<key>": { "value": <根据type>, "rawText": "分析依据..." },
    ...
  },
  "summary": "一句话总结当前对话状态",
  "confidence": 0.85
}
\`\`\`

注意事项：
- enum 类型 value 必须是选项之一
- score 类型 value 是 0-100 的整数
- list 类型 value 是字符串数组
- boolean 类型 value 是 true/false
- tags 类型 value 是字符串数组
- progress 类型 value 是当前阶段名称
- text 类型 value 是字符串
- 只输出 JSON，不要包含其他内容

### 完整对话记录

${fullTranscript || '（暂无内容）'}

### 本次新增内容

${newText || '（无新增）'}`;

    if (previousResult) {
      prompt += `

### 上次分析结果（用于对比变化）

${JSON.stringify(previousResult, null, 2)}`;
    }

    return prompt;
  }

  private parseResult(output: string, template: AnalysisTemplate): AnalysisResult {
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log.warn('[InsightAnalyzer] No JSON found in output, using fallback');
      return this.buildFallbackResult(template);
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as {
        dimensions?: Record<string, { value?: unknown; rawText?: string }>;
        summary?: string;
        confidence?: number;
      };

      const dimensions: Record<string, DimensionValue> = {};
      for (const dim of template.dimensions) {
        const raw = parsed.dimensions?.[dim.key];
        dimensions[dim.key] = {
          key: dim.key,
          label: dim.label,
          type: dim.type,
          value: raw?.value ?? this.getDefaultValue(dim.type),
          rawText: raw?.rawText
        };
      }

      return {
        dimensions,
        summary: parsed.summary,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined
      };
    } catch (err) {
      log.warn('[InsightAnalyzer] JSON parse failed, using fallback:', err);
      return this.buildFallbackResult(template);
    }
  }

  private buildFallbackResult(template: AnalysisTemplate): AnalysisResult {
    const dimensions: Record<string, DimensionValue> = {};
    for (const dim of template.dimensions) {
      dimensions[dim.key] = {
        key: dim.key,
        label: dim.label,
        type: dim.type,
        value: this.getDefaultValue(dim.type),
        rawText: '分析数据不足'
      };
    }
    return { dimensions, summary: '对话内容不足，暂无法分析', confidence: 0 };
  }

  private getDefaultValue(type: string): unknown {
    switch (type) {
      case 'enum':
        return '信息不足';
      case 'score':
        return 0;
      case 'text':
        return '';
      case 'list':
        return [];
      case 'boolean':
        return false;
      case 'tags':
        return [];
      case 'progress':
        return '';
      case 'comparison':
        return '';
      default:
        return null;
    }
  }

  private detectChanges(prev: AnalysisResult, curr: AnalysisResult): DimensionChange[] {
    const changes: DimensionChange[] = [];
    for (const [key, currDim] of Object.entries(curr.dimensions)) {
      const prevDim = prev.dimensions[key];
      if (!prevDim) continue;
      const prevStr = JSON.stringify(prevDim.value);
      const currStr = JSON.stringify(currDim.value);
      if (prevStr !== currStr) {
        changes.push({
          key,
          label: currDim.label,
          previousValue: prevDim.value,
          currentValue: currDim.value,
          direction: this.inferDirection(prevDim.value, currDim.value)
        });
      }
    }
    return changes;
  }

  private inferDirection(prev: unknown, curr: unknown): DimensionChange['direction'] {
    if (typeof prev === 'number' && typeof curr === 'number') {
      if (curr > prev) return 'up';
      if (curr < prev) return 'down';
      return 'stable';
    }
    if (Array.isArray(prev) && Array.isArray(curr)) {
      if (curr.length > prev.length) return 'up';
      if (curr.length < prev.length) return 'down';
    }
    return 'changed';
  }
}
