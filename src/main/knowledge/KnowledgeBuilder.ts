/**
 * KnowledgeBuilder — 通过 Agent 将源材料构建为结构化知识库
 *
 * 核心理念：Agent-first
 *   - 纯文本文件直接读取（高效路径）
 *   - 所有非文本格式（.docx, .pdf, .xlsx, .pptx 等）通过 AI 提取内容
 *   - 不为每种格式写硬编码，而是让 Agent 自行理解和转换
 *
 * 流程：
 * 1. 遍历 _sources/ 下所有文件
 * 2. 文本文件直接读取；非文本文件通过 Agent 提取
 * 3. 汇总所有提取内容，调用 Agent 生成结构化知识库
 * 4. 将输出写入 content/ 目录
 */

import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { createLogger } from '@main/common/logger';
import { KnowledgeStore } from './KnowledgeStore';
import { createLLMChat } from '@main/ai/quality-loop/llm-chat';
import type { LLMChatFn } from '@main/ai/quality-loop/llm-chat';

const log = createLogger('knowledge-builder');

const TEXT_EXTS = new Set([
  '.md',
  '.txt',
  '.csv',
  '.json',
  '.xml',
  '.html',
  '.htm',
  '.yaml',
  '.yml',
  '.log',
  '.ini',
  '.conf',
  '.cfg',
  '.properties',
  '.env',
  '.toml',
  '.rst'
]);

const OFFICE_ZIP_EXTS = new Set(['.docx', '.xlsx', '.pptx']);

const EXTRACT_SYSTEM_PROMPT = `你是一个文档内容提取专家。用户会提供文档的原始内容（可能是 XML、HTML、混合格式或其他格式），请从中提取出有意义的纯文本内容。

要求：
1. 去除所有标签、格式标记，只保留有意义的文本内容
2. 保持文本的逻辑结构（段落、列表、表格等）
3. 不要添加任何解释性文字，直接输出提取后的纯文本
4. 表格数据用 Markdown 表格格式输出
5. 如果内容包含多个部分，用空行分隔`;

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

  // ==================== 公共 API ====================

  async build(kbId: string): Promise<void> {
    const meta = this.store.get(kbId);
    if (!meta) throw new Error(`Knowledge base not found: ${kbId}`);

    this.store.updateStatus(kbId, 'building', '正在提取源材料...');

    const sourcesText = await this.extractAllSources(kbId);
    if (!sourcesText.trim()) {
      this.store.updateStatus(kbId, 'error', '没有可读取的源材料');
      throw new Error('No readable source materials');
    }

    log.info(`[KnowledgeBuilder] Building KB: ${kbId}, extracted text length: ${sourcesText.length}`);

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

    this.store.updateStatus(kbId, 'building', '正在提取源材料...');

    const sourcesText = await this.extractAllSources(kbId);
    const existingIndex = this.store.getIndex(kbId);

    if (!sourcesText.trim()) {
      this.store.updateStatus(kbId, 'error', '没有新的源材料');
      throw new Error('No source materials to expand from');
    }

    log.info(`[KnowledgeBuilder] Expanding KB: ${kbId}`);

    try {
      const llmChat = createLLMChat(this.agentExecutor);

      this.store.updateStatus(kbId, 'building', '正在分析并扩展知识库...');

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

  // ==================== 源材料提取（Agent-first） ====================

  /**
   * 遍历所有源文件，提取文本内容：
   *   - 纯文本文件直接读取
   *   - Office 文档（.docx/.xlsx/.pptx）：先解压 XML，再通过 Agent 提取
   *   - 其他格式：尝试读取，若不可读则通过 Agent 处理
   */
  private async extractAllSources(kbId: string): Promise<string> {
    const files = this.store.listSourceFiles(kbId);
    if (files.length === 0) return '';

    const textParts: string[] = [];
    const needAiExtract: { relPath: string; rawContent: string }[] = [];

    for (const file of files) {
      if (TEXT_EXTS.has(file.ext)) {
        try {
          const content = fs.readFileSync(file.absPath, 'utf-8');
          if (content.trim()) {
            textParts.push(`\n===== 文件: ${file.relPath} =====\n${content}`);
          }
        } catch {
          log.warn(`[KnowledgeBuilder] Cannot read text file: ${file.relPath}`);
        }
        continue;
      }

      if (OFFICE_ZIP_EXTS.has(file.ext)) {
        const xml = this.extractXmlFromOfficeDoc(file.absPath, file.ext);
        if (xml) {
          needAiExtract.push({ relPath: file.relPath, rawContent: xml });
        }
        continue;
      }

      // 其他格式：尝试作为文本读取
      try {
        const raw = fs.readFileSync(file.absPath, 'utf-8');
        if (this.looksLikeText(raw)) {
          textParts.push(`\n===== 文件: ${file.relPath} =====\n${raw}`);
        } else {
          needAiExtract.push({ relPath: file.relPath, rawContent: raw.substring(0, 20000) });
        }
      } catch {
        log.warn(`[KnowledgeBuilder] Skipping binary file (no handler): ${file.relPath}`);
      }
    }

    // 通过 Agent 批量提取非文本文件的内容
    if (needAiExtract.length > 0) {
      log.info(`[KnowledgeBuilder] Extracting ${needAiExtract.length} non-text files via Agent...`);
      this.store.updateStatus(kbId, 'building', `正在通过 AI 提取 ${needAiExtract.length} 个文档...`);

      const extracted = await this.aiExtractBatch(needAiExtract);
      for (const item of extracted) {
        if (item.text.trim()) {
          textParts.push(`\n===== 文件: ${item.relPath} =====\n${item.text}`);
        }
      }
    }

    return textParts.join('\n');
  }

  /**
   * 从 Office 文档（ZIP 容器）中提取原始 XML 内容
   */
  private extractXmlFromOfficeDoc(filePath: string, ext: string): string | null {
    try {
      const zip = new AdmZip(filePath);
      const parts: string[] = [];

      if (ext === '.docx') {
        const doc = zip.getEntry('word/document.xml');
        if (doc) parts.push(doc.getData().toString('utf-8'));
      } else if (ext === '.xlsx') {
        const sharedStrings = zip.getEntry('xl/sharedStrings.xml');
        if (sharedStrings) parts.push(sharedStrings.getData().toString('utf-8'));
        const entries = zip.getEntries();
        for (const entry of entries) {
          if (entry.entryName.match(/^xl\/worksheets\/sheet\d+\.xml$/)) {
            parts.push(entry.getData().toString('utf-8'));
          }
        }
      } else if (ext === '.pptx') {
        const entries = zip.getEntries();
        for (const entry of entries) {
          if (entry.entryName.match(/^ppt\/slides\/slide\d+\.xml$/)) {
            parts.push(entry.getData().toString('utf-8'));
          }
        }
      }

      return parts.length > 0 ? parts.join('\n\n') : null;
    } catch (err) {
      log.warn(`[KnowledgeBuilder] Failed to extract XML from ${path.basename(filePath)}:`, err);
      return null;
    }
  }

  /**
   * 通过 Agent 批量提取文档内容
   * 将多个文件合并为一次 LLM 调用，减少开销
   */
  private async aiExtractBatch(
    files: { relPath: string; rawContent: string }[]
  ): Promise<{ relPath: string; text: string }[]> {
    const llmChat: LLMChatFn = createLLMChat(this.agentExecutor);

    const MAX_CHUNK = 50000;
    const results: { relPath: string; text: string }[] = [];

    // 按大小分批，避免超出 token 限制
    let batch: typeof files = [];
    let batchSize = 0;

    const processBatch = async (items: typeof files): Promise<void> => {
      const userContent = items
        .map((f) => `### 文件: ${f.relPath}\n\n${f.rawContent.substring(0, 30000)}`)
        .join('\n\n---\n\n');

      try {
        const output = await llmChat({
          messages: [
            { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
            {
              role: 'user',
              content: `请提取以下 ${items.length} 个文档的文本内容。对每个文件，输出格式为：\n\n===EXTRACTED: 文件名===\n提取的文本\n\n${userContent}`
            }
          ],
          maxTokens: 8000
        });

        // 解析 Agent 返回的分段内容
        const extractedRegex = /===EXTRACTED:\s*(.+?)===\n([\s\S]*?)(?=\n===EXTRACTED:|$)/g;
        let match: RegExpExecArray | null;
        const extractedMap = new Map<string, string>();

        while ((match = extractedRegex.exec(output)) !== null) {
          extractedMap.set(match[1].trim(), match[2].trim());
        }

        for (const item of items) {
          const text = extractedMap.get(item.relPath) || '';
          results.push({ relPath: item.relPath, text });
          if (!text) {
            log.warn(`[KnowledgeBuilder] AI did not extract content for: ${item.relPath}`);
          }
        }

        // 如果 Agent 没按格式返回但只有一个文件，直接用全部输出
        if (items.length === 1 && extractedMap.size === 0 && output.trim()) {
          results[results.length - 1] = { relPath: items[0].relPath, text: output.trim() };
        }
      } catch (err) {
        log.error(`[KnowledgeBuilder] AI extraction failed for batch:`, err);
        for (const item of items) {
          results.push({ relPath: item.relPath, text: '' });
        }
      }
    };

    for (const file of files) {
      const fileSize = file.rawContent.length;
      if (batchSize + fileSize > MAX_CHUNK && batch.length > 0) {
        await processBatch(batch);
        batch = [];
        batchSize = 0;
      }
      batch.push(file);
      batchSize += fileSize;
    }
    if (batch.length > 0) {
      await processBatch(batch);
    }

    return results;
  }

  /**
   * 粗判内容是否为可读文本（非乱码二进制）
   */
  private looksLikeText(content: string): boolean {
    if (content.length === 0) return false;
    const sample = content.substring(0, 1000);
    let controlChars = 0;
    for (let i = 0; i < sample.length; i++) {
      const code = sample.charCodeAt(i);
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) controlChars++;
    }
    return controlChars / sample.length < 0.1;
  }

  // ==================== 输出解析 ====================

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
