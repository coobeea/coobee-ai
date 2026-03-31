/**
 * AI 驱动的技能创建服务
 *
 * 接收用户自然语言需求，通过 AgentExecutor 调用 LLM 生成 SKILL.md 文件内容，
 * 然后写入到用户技能目录（userSkillsDir）。
 *
 * 设计：
 *   - 通过 AgentExecutor.stream() 调用（✅ 享受完整错误恢复能力）
 *   - 系统提示词融合 skill-creator Skill 的创建流程
 *   - 支持进度回调（SSE 流式通知前端）
 *   - 生成后写入 {userSkillsDir}/{skill-name}/SKILL.md
 */

import fs from 'fs';
import path from 'path';
import { mkdirp } from 'mkdirp';
import { createLogger } from '@main/common/logger';
import { agentExecutor } from '@main/ai/AgentExecutor';
import { SkillManager } from '@main/ai/skills/SkillManager';
import type { StreamChunk } from '@main/ai/runtime/types';

const log = createLogger('skill-creator-service');

/** AI 创建的返回结构 */
export interface AiCreateSkillResult {
  name: string;
  dirName: string;
  filePath: string;
}

/** 进度步骤 */
export type AiCreateSkillStep = 'analyzing' | 'generating' | 'writing' | 'done' | 'error';

/** 进度事件 */
export interface AiCreateSkillProgress {
  step: AiCreateSkillStep;
  message: string;
  detail?: string;
}

/** 进度回调 */
export type ProgressCallback = (progress: AiCreateSkillProgress) => void;

/**
 * 构建系统提示词
 *
 * 基于 skill-creator Skill 的创建流程，指导 LLM 生成 SKILL.md 文件。
 */
function buildSystemPrompt(): string {
  return `你是一个专业的 Skill 设计专家。你的任务是根据用户的自然语言需求，生成一个完整的 SKILL.md 文件。

## 什么是 Skill

Skill 是一段场景化的操作手册（Markdown 文件），告诉 Agent 遇到特定场景时应该如何行动。
- Skill 不是代码，是自然语言指导
- Skill 通过 read 工具读取后遵循，不需要注册或编译
- Skill 适合描述多步骤流程、领域知识、工具组合方式

## SKILL.md 格式

必须包含 YAML frontmatter 和正文：

\`\`\`markdown
---
name: skill-name
description: 一句话描述，清楚说明何时使用。系统根据这段描述匹配场景。
---

# Skill 标题

## 使用场景
描述何时应该使用这个 Skill...

## 前提条件
使用此 Skill 前需要满足的条件...

## 操作步骤

### 步骤 1：xxx
详细描述操作...

### 步骤 2：xxx
详细描述操作...

## 注意事项
- 重要警告或常见陷阱
- 平台差异说明

## 示例
给出完整的使用示例。
\`\`\`

## description 编写原则

description 是系统匹配 Skill 的关键。要：
- 明确说明触发场景，而不是泛泛描述功能
- 包含关键词，便于匹配

好的 description：
- "操作 GitHub Issue 和 Pull Request。当用户要求创建 PR、管理 Issue、查看 CI 状态时使用。"
- "使用 ffmpeg 处理视频文件。当用户要求视频转码、剪切、合并或提取音频时使用。"

差的 description：
- "GitHub 相关操作"（太模糊）

## 操作步骤编写原则

- 给出具体的命令，而不是"执行相关命令"
- 包含参数说明和返回值解释
- 考虑错误处理：如果某步失败该怎么办
- 每个 Skill 应该是自包含的

## 输出格式

你必须输出一个 JSON 对象，包含以下字段：

{
  "dirName": "kebab-case 格式的目录名（如 code-review-guide）",
  "name": "技能名称（如 code-review-guide）",
  "description": "一句话描述",
  "content": "完整的 SKILL.md 文件内容（包含 frontmatter）"
}

## ID 命名规范
- kebab-case（小写字母 + 数字 + 连字符）
- 简短有意义：code-review-guide, docker-deploy, api-testing
- dirName 和 name 保持一致

## 重要约束
- 所有文本使用中文
- content 必须包含完整的 YAML frontmatter（--- name: ... description: ... ---）
- 步骤要具体、专业、有实际指导价值
- 必须严格输出 JSON 对象，不要有其他文字`;
}

// ==================== Agent Builder 辅助函数 ====================

/**
 * 创建临时 Agent 定义（用于通过 AgentExecutor 调用 LLM）
 *
 * 参考 quickChat 的实现模式
 */
function createTempAgentBuilder(systemPrompt: string): ReturnType<typeof agentExecutor.piMono> {
  return agentExecutor
    .piMono()
    .name('技能创建助手')
    .agentId('temp-skill-creator')
    .mode('chat')
    .sessionMode('file')
    .lightweight(true) // ✅ 轻量模式，不持久化会话
    .instructions(systemPrompt); // 动态系统提示词
}

// ==================== 核心逻辑 ====================

/**
 * AI 驱动的技能创建
 *
 * @param requirement 用户的自然语言需求描述
 * @param userSkillsDir 用户技能目录路径
 * @param onProgress 进度回调
 * @returns 创建结果
 */
export async function aiCreateSkill(
  requirement: string,
  userSkillsDir: string,
  onProgress?: ProgressCallback
): Promise<AiCreateSkillResult> {
  const emit = onProgress ?? (() => {});

  log.info(`[SkillCreatorService] 开始 AI 创建技能，需求: "${requirement.slice(0, 100)}..."`);

  // Step 1: 分析阶段
  emit({
    step: 'analyzing',
    message: '正在分析需求...',
    detail: '理解技能场景和用途'
  });

  // Step 2: 生成阶段 — 通过 AgentExecutor 调用（✅ 自动错误恢复）
  emit({
    step: 'generating',
    message: '正在生成技能定义...',
    detail: '设计场景 → 编写操作步骤 → 生成 SKILL.md'
  });

  const systemPrompt = buildSystemPrompt();
  const builder = createTempAgentBuilder(systemPrompt);

  // 临时会话 ID（不持久化）
  const sessionId = `skill-create-${Date.now()}`;

  let content = '';

  try {
    // 执行流式对话（✅ 通过 AgentExecutor，自动错误恢复）
    const gen = agentExecutor.stream({
      sessionId,
      message: requirement,
      builder
    });

    let r = await gen.next();
    while (!r.done) {
      const chunk: StreamChunk = r.value;

      // 收集文本内容
      if (chunk.type === 'text:delta' && chunk.content) {
        content += chunk.content;
      }

      // 透传错误恢复事件（前端可显示"重试中..."）
      if (chunk.type === 'run:error') {
        emit({
          step: 'generating',
          message: `恢复中: ${chunk.content}`
        });
      }

      r = await gen.next();
    }

    if (!content.trim()) {
      emit({ step: 'error', message: 'AI 未返回有效内容' });
      throw new Error('AI 未返回有效内容');
    }

    // 去除可能的 Markdown 代码块标记
    content = content
      .replace(/```json?\s*\n?/g, '')
      .replace(/```\s*$/g, '')
      .trim();

    log.debug(`[SkillCreatorService] LLM 返回内容长度: ${content.length}`);
  } catch (error) {
    log.error(`[SkillCreatorService] 生成阶段失败:`, error);
    const msg = error instanceof Error ? error.message : String(error);
    emit({ step: 'error', message: `生成失败: ${msg}` });
    throw error;
  }

  // 解析 JSON
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content);
  } catch {
    log.error(`[SkillCreatorService] JSON 解析失败: ${content.slice(0, 200)}`);
    emit({ step: 'error', message: 'AI 返回格式异常' });
    throw new Error('AI 返回的内容不是有效的 JSON 格式');
  }

  const {
    dirName,
    name,
    content: skillContent
  } = parsed as {
    dirName?: string;
    name?: string;
    description?: string;
    content?: string;
  };

  if (!dirName || !name || !skillContent) {
    log.error(`[SkillCreatorService] 缺少必需字段: dirName=${!!dirName}, name=${!!name}, content=${!!skillContent}`);
    emit({ step: 'error', message: '生成的定义缺少必需字段' });
    throw new Error('AI 生成的 Skill 定义缺少必需字段（dirName、name、content）');
  }

  emit({
    step: 'generating',
    message: '技能定义生成完成',
    detail: `${name}`
  });

  // Step 3: 写入阶段 — 创建目录和文件
  emit({
    step: 'writing',
    message: '正在保存技能文件...',
    detail: `${dirName}/SKILL.md`
  });

  const skillDir = path.join(userSkillsDir, dirName);
  await mkdirp(skillDir);

  const filePath = path.join(skillDir, 'SKILL.md');
  fs.writeFileSync(filePath, skillContent, 'utf-8');

  // 清除 SkillManager 缓存，确保下次扫描能发现新技能
  SkillManager.invalidateCache();

  log.info(`[SkillCreatorService] AI 创建技能成功: ${name} → ${filePath}`);

  // Step 4: 完成
  emit({
    step: 'done',
    message: '技能创建成功',
    detail: `${name}（${dirName}）`
  });

  return { name, dirName, filePath };
}
