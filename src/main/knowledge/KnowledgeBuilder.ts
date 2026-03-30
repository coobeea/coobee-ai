/**
 * KnowledgeBuilder — 通过 Agent 将源材料构建为结构化知识库
 *
 * 流程：
 * 1. 读取 _sources/ 下所有可读文本
 * 2. 调用 LLM（通过 AgentExecutor）分析材料，生成结构化 Markdown
 * 3. 将输出写入 content/ 目录（index.md + 章节结构）
 */

import { createLogger } from '@main/common/logger';
import { KnowledgeStore } from './KnowledgeStore';
import { createLLMChat } from '@main/ai/quality-loop/llm-chat';

const log = createLogger('knowledge-builder');

const BUILD_SYSTEM_PROMPT = `你是一位专业的知识库架构师。你的任务是将用户提供的原始资料整理为结构化的知识库。

## 输出格式要求

你必须严格按照以下 Markdown 结构输出，使用特定的分隔标记：

\`\`\`
===FILE: index.md===
# 知识库标题

> 简要描述

## 目录

### 01-章节名称
- 内容概述...

### 02-章节名称
- 内容概述...

===FILE: 01-章节名称/_overview.md===
# 章节标题

概述内容...

===FILE: 01-章节名称/具体主题.md===
# 具体主题

详细内容...

===FILE: 02-章节名称/_overview.md===
...
\`\`\`

## 规则

1. 每个文件用 \`===FILE: 路径===\` 标记开头
2. 章节目录用两位数字编号：01-、02-、03- 等
3. 每个章节必须有 _overview.md 概述文件
4. index.md 是顶层目录索引，列出所有章节和简要说明
5. 内容要从原始资料中提取和组织，不要凭空编造
6. 保持原始资料的核心信息完整，用专业的语言重新组织
7. 如果材料内容丰富，章节数量应适当增多（3-8个章节）
8. 每个文件内容要充实，不要只写标题和一句话`;

export class KnowledgeBuilder {
  private store: KnowledgeStore;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private agentExecutor: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(agentExecutor: any) {
    this.store = KnowledgeStore.getInstance();
    this.agentExecutor = agentExecutor;
  }

  async build(kbId: string): Promise<void> {
    const meta = this.store.get(kbId);
    if (!meta) throw new Error(`Knowledge base not found: ${kbId}`);

    const sourcesText = await this.store.getSourcesAsText(kbId);
    if (!sourcesText.trim()) {
      this.store.updateStatus(kbId, 'error', '没有可读取的源材料');
      throw new Error('No readable source materials');
    }

    log.info(`[KnowledgeBuilder] Building KB: ${kbId}, sources length: ${sourcesText.length}`);
    this.store.updateStatus(kbId, 'building', '正在分析源材料...');

    try {
      const llmChat = createLLMChat(this.agentExecutor);

      this.store.updateStatus(kbId, 'building', '正在生成知识库结构...');

      const userPrompt = `请根据以下原始资料，构建名为「${meta.name}」的知识库。

描述：${meta.description || '（无描述）'}

## 原始资料

${sourcesText.substring(0, 80000)}

请严格按照系统提示中的格式输出结构化知识库内容。`;

      const output = await llmChat({
        messages: [
          { role: 'system', content: BUILD_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        maxTokens: 16000
      });

      if (!output.trim()) {
        this.store.updateStatus(kbId, 'error', 'AI 未生成有效内容');
        throw new Error('LLM returned empty output');
      }

      this.store.updateStatus(kbId, 'building', '正在写入知识库文件...');
      this.store.clearContent(kbId);
      this.parseAndWriteFiles(kbId, output);

      this.store.updateStatus(kbId, 'ready');
      log.info(`[KnowledgeBuilder] KB built successfully: ${kbId}`);
    } catch (err) {
      log.error(`[KnowledgeBuilder] Build failed for ${kbId}:`, err);
      const errMsg = err instanceof Error ? err.message : String(err);
      if (this.store.get(kbId)?.status === 'building') {
        this.store.updateStatus(kbId, 'error', `构建失败: ${errMsg.substring(0, 200)}`);
      }
      throw err;
    }
  }

  async expand(kbId: string): Promise<void> {
    const meta = this.store.get(kbId);
    if (!meta) throw new Error(`Knowledge base not found: ${kbId}`);

    const sourcesText = await this.store.getSourcesAsText(kbId);
    const existingIndex = this.store.getIndex(kbId);

    if (!sourcesText.trim()) {
      this.store.updateStatus(kbId, 'error', '没有新的源材料');
      throw new Error('No source materials to expand from');
    }

    log.info(`[KnowledgeBuilder] Expanding KB: ${kbId}`);
    this.store.updateStatus(kbId, 'building', '正在分析新材料并扩展...');

    try {
      const llmChat = createLLMChat(this.agentExecutor);

      const userPrompt = `你需要扩展一个已有的知识库「${meta.name}」。

描述：${meta.description || '（无描述）'}

## 当前知识库索引

${existingIndex || '（空知识库）'}

## 全部源材料（包含新增）

${sourcesText.substring(0, 80000)}

请基于所有源材料，重新生成完整的知识库结构。保留已有内容的精华，整合新材料。
严格按照系统提示中的格式输出。`;

      const output = await llmChat({
        messages: [
          { role: 'system', content: BUILD_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        maxTokens: 16000
      });

      if (!output.trim()) {
        this.store.updateStatus(kbId, 'error', 'AI 未生成有效内容');
        throw new Error('LLM returned empty output');
      }

      this.store.updateStatus(kbId, 'building', '正在更新知识库文件...');
      this.store.clearContent(kbId);
      this.parseAndWriteFiles(kbId, output);

      this.store.updateStatus(kbId, 'ready');
      log.info(`[KnowledgeBuilder] KB expanded successfully: ${kbId}`);
    } catch (err) {
      log.error(`[KnowledgeBuilder] Expand failed for ${kbId}:`, err);
      const errMsg = err instanceof Error ? err.message : String(err);
      if (this.store.get(kbId)?.status === 'building') {
        this.store.updateStatus(kbId, 'error', `扩展失败: ${errMsg.substring(0, 200)}`);
      }
      throw err;
    }
  }

  private parseAndWriteFiles(kbId: string, output: string): void {
    const fileRegex = /===FILE:\s*(.+?)===\n([\s\S]*?)(?=\n===FILE:|$)/g;
    let match: RegExpExecArray | null;
    let fileCount = 0;

    while ((match = fileRegex.exec(output)) !== null) {
      const filePath = match[1].trim();
      const content = match[2].trim();
      if (filePath && content) {
        this.store.writeContentFile(kbId, filePath, content + '\n');
        fileCount++;
      }
    }

    if (fileCount === 0) {
      this.store.writeContentFile(kbId, 'index.md', output);
      log.warn(`[KnowledgeBuilder] No file markers found, wrote all output as index.md`);
    } else {
      log.info(`[KnowledgeBuilder] Wrote ${fileCount} files for KB: ${kbId}`);
    }
  }
}
