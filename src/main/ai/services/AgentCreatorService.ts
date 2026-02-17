/**
 * AI 驱动的智能体创建服务
 *
 * 接收用户自然语言需求，通过一次轻量 LLM 调用生成完整的 AgentDefinition，
 * 然后通过 AgentStore 持久化。
 *
 * 设计：
 *   - 单次 OpenAI chat.completions.create（JSON mode）
 *   - 系统提示词融合 agent-creator Skill 的完整分析流程
 *   - 动态注入可用 Tools（name）和 Skills（name + description）
 *   - 不启动完整 Agent 会话，轻量且快速
 */

import OpenAI from 'openai';
import { createLogger } from '@main/common/logger';
import { agentExecutor } from '@main/ai/AgentExecutor';
import { resolveApiKey } from '@main/ai/provider/ApiKeyResolver';
import { ToolRegistry } from '@main/ai/tools/registry';
import { builtinTools } from '@main/ai/tools';
import { SkillManager } from '@main/ai/skills/SkillManager';
import { AgentStore } from '@main/ai/agents/AgentStore';
import type { AgentDefinition, CreateAgentParams } from '@main/ai/agents/types';

const log = createLogger('agent-creator-service');

/** AI 创建的返回结构 */
export interface AiCreateResult {
  agent: AgentDefinition;
}

/** 工具信息（name + 简要说明） */
interface ToolInfo {
  name: string;
  description: string;
}

/** 技能信息（name + description） */
interface SkillInfo {
  name: string;
  description: string;
}

/**
 * 构建系统提示词
 *
 * 融合 agent-creator Skill 的完整流程：意图分析 → 能力规划 → 定义生成。
 * 注入工具和技能的详细信息，让 LLM 能精准匹配。
 */
function buildSystemPrompt(tools: ToolInfo[], skills: SkillInfo[]): string {
  // 工具列表：name — description
  const toolSection =
    tools.length > 0 ? tools.map((t) => `- ${t.name} — ${t.description}`).join('\n') : '（无可用工具）';

  // 技能列表：name — description
  const skillSection =
    skills.length > 0 ? skills.map((s) => `- ${s.name} — ${s.description}`).join('\n') : '（无可用技能）';

  return `你是一个专业的 Agent 设计专家。你的任务是根据用户的自然语言需求，经过系统化分析，生成一个完整的 Agent 定义。

## 分析流程

你必须按以下步骤进行分析（内部思考，不需要在输出中体现）：

### Step 1：意图分析
从用户需求中提取：
- 核心任务 — 这个 Agent 主要做什么
- 适用场景 — 什么时候需要它
- 输入/输出 — 接收什么、产出什么
- 领域 — 所属专业领域

### Step 2：能力规划

#### 工具选择
从可用工具中选择 Agent 真正需要的工具。原则：
- 纯对话 Agent（翻译、问答）→ 空数组 []
- 分析型 Agent → read, search, glob
- 执行型 Agent → read, write, edit, exec
- 全能型 Agent → 选择所有需要的

#### 技能匹配（重要！）
仔细阅读每个可用技能的描述，选择与 Agent 职责相关的技能。
技能会注入到 Agent 的知识库中，增强其专业能力。
如果有匹配的技能，一定要选上，不要遗漏。

#### 指令设计
系统指令（instructions）是 Agent 的灵魂。好的指令包含：
1. 角色定位 — "你是一个专业的{领域}{角色}..."
2. 行为规范 — 工作步骤（1、2、3...）
3. 输出格式 — Markdown 表格、清单、报告模板等
4. 约束边界 — "如果遇到{情况}，你应该{动作}"
指令长度 200-800 字为宜，不超过 2000 字。

## 当前可用的工具

${toolSection}

## 当前可用的技能

${skillSection}

## 输出格式

你必须输出一个 JSON 对象，包含以下字段：

{
  "id": "kebab-case 格式的唯一标识（如 code-reviewer）",
  "name": "中文显示名称（如 代码审查专家）",
  "description": "一句话描述 Agent 的核心能力",
  "instructions": "详细的系统指令",
  "tools": ["从可用工具中选择的工具名称列表"],
  "skills": ["从可用技能中选择的技能名称列表"]
}

## ID 命名规范
- kebab-case（小写字母 + 数字 + 连字符）
- 简短有意义：code-reviewer、contract-analyst、translator
- 不加 agent- 前缀或 -agent 后缀

## 重要约束
- 所有文本使用中文
- instructions 必须详细、专业、有指导价值
- 工具和技能只选 Agent 真正需要的，但匹配的技能不要遗漏
- 必须严格输出 JSON 对象，不要有其他文字`;
}

// ==================== 资源收集 ====================

/** 获取工具信息（name + description） */
function getAvailableTools(): ToolInfo[] {
  const extensionTools = ToolRegistry.getInstance().getAll();
  const toolMap = new Map(builtinTools.map((t) => [t.name, t]));
  for (const ext of extensionTools) {
    toolMap.set(ext.name, ext);
  }
  return Array.from(toolMap.values()).map((t) => ({
    name: t.name,
    description: t.description ?? ''
  }));
}

/** 获取技能信息（name + description） */
function getAvailableSkills(): SkillInfo[] {
  const skillManager = SkillManager.getCurrent();
  if (!skillManager) return [];
  return skillManager.getAll().map((s) => ({
    name: s.name,
    description: s.description
  }));
}

// ==================== OpenAI 客户端 ====================

/** 创建 OpenAI 客户端，复用 Provider 系统配置 */
function createOpenAIClient(): { client: OpenAI; model: string } {
  const providerSystem = agentExecutor.getProviderSystem?.();
  if (!providerSystem) {
    throw new Error('Provider 系统未初始化，无法创建 AI 客户端');
  }

  const { selector, registry } = providerSystem;
  const ref = selector.resolve();
  const provider = registry.get(ref.provider);
  if (!provider) {
    throw new Error(`Provider "${ref.provider}" 未找到`);
  }

  const apiKey = resolveApiKey(provider.apiKey, provider.id);
  if (!apiKey) {
    throw new Error(`Provider "${ref.provider}" 未配置 API Key`);
  }

  const client = new OpenAI({
    apiKey,
    baseURL: provider.baseUrl
  });

  return { client, model: ref.model };
}

// ==================== 核心逻辑 ====================

/**
 * AI 驱动的智能体创建
 *
 * @param requirement 用户的自然语言需求描述
 * @returns 创建好的 AgentDefinition
 */
export async function aiCreateAgent(requirement: string): Promise<AiCreateResult> {
  log.info(`[AgentCreatorService] 开始 AI 创建，需求: "${requirement.slice(0, 100)}..."`);

  // 1. 获取可用资源（含描述信息）
  const tools = getAvailableTools();
  const skills = getAvailableSkills();
  log.debug(`[AgentCreatorService] 可用工具: ${tools.length}, 可用技能: ${skills.length}`);

  // 2. 构建提示词
  const systemPrompt = buildSystemPrompt(tools, skills);

  // 3. 创建 OpenAI 客户端
  const { client, model } = createOpenAIClient();
  log.debug(`[AgentCreatorService] 使用模型: ${model}`);

  // 4. 调用 LLM
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: requirement }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
    max_tokens: 2000
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('AI 未返回有效内容');
  }

  // 5. 解析 JSON
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content);
  } catch {
    log.error(`[AgentCreatorService] JSON 解析失败: ${content.slice(0, 200)}`);
    throw new Error('AI 返回的内容不是有效的 JSON 格式');
  }

  // 6. 校验必需字段
  const { id, name, description, instructions } = parsed as {
    id?: string;
    name?: string;
    description?: string;
    instructions?: string;
  };
  const rawTools = parsed.tools as string[] | undefined;
  const rawSkills = parsed.skills as string[] | undefined;

  if (!id || !name || !instructions) {
    log.error(`[AgentCreatorService] 缺少必需字段: id=${!!id}, name=${!!name}, instructions=${!!instructions}`);
    throw new Error('AI 生成的 Agent 定义缺少必需字段（id、name、instructions）');
  }

  // 7. 过滤无效的工具和技能名称
  const toolNames = tools.map((t) => t.name);
  const skillNames = skills.map((s) => s.name);

  const validTools = (rawTools ?? []).filter((t) => toolNames.includes(t));
  const validSkills = (rawSkills ?? []).filter((s) => skillNames.includes(s));

  if (rawTools && validTools.length < rawTools.length) {
    log.warn(`[AgentCreatorService] 过滤了无效工具: ${rawTools.filter((t) => !toolNames.includes(t)).join(', ')}`);
  }
  if (rawSkills && validSkills.length < rawSkills.length) {
    log.warn(`[AgentCreatorService] 过滤了无效技能: ${rawSkills.filter((s) => !skillNames.includes(s)).join(', ')}`);
  }

  // 8. 创建并保存
  const createParams: CreateAgentParams = {
    id,
    name,
    description: description || name,
    instructions,
    tools: validTools.length > 0 ? validTools : undefined,
    skills: validSkills.length > 0 ? validSkills : undefined,
    createdBy: 'user'
  };

  const store = await AgentStore.getInstance();
  const agent = await store.create(createParams);

  log.info(
    `[AgentCreatorService] AI 创建成功: ${agent.id} (${agent.name}), 工具: ${validTools.length}, 技能: ${validSkills.length}`
  );

  return { agent };
}
