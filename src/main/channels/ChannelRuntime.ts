import { agentExecutor } from '@main/ai/AgentExecutor';
import { AgentStore } from '@main/ai/agents/AgentStore';
import { ToolRegistry } from '@main/ai/tools/registry';
import { SkillManager } from '@main/ai/skills';
import { builtinTools } from '@main/ai/tools';
import type { PiMonoBuilder } from '@main/ai/runtime/pimono/PiMonoBuilder';
import type { ThinkingLevel } from '@main/ai/runtime/pimono/types';
import type { StreamChunk } from '@main/ai/runtime/types';
import type { ChannelContext } from './types';

/**
 * ChannelRuntime - 统一的 Agent 调度层
 *
 * 所有 Channel 都通过这个层调用 Agent，确保：
 * 1. 一致的 Session 管理
 * 2. Context 注入
 * 3. 工具/技能加载
 * 4. 错误处理
 */
export class ChannelRuntime {
  private static instance: ChannelRuntime;

  private constructor() {
    // Singleton
  }

  /**
   * 获取单例实例
   */
  static getInstance(): ChannelRuntime {
    if (!ChannelRuntime.instance) {
      ChannelRuntime.instance = new ChannelRuntime();
    }
    return ChannelRuntime.instance;
  }

  /**
   * 执行 Agent（同步模式）
   *
   * @param params - 执行参数
   * @returns 执行结果
   */
  async executeAgent(params: {
    /** Agent ID */
    agentId: string;
    /** Session ID（用于历史管理） */
    sessionId: string;
    /** 用户消息 */
    message: string;
    /** Channel 上下文 */
    context: ChannelContext;
  }): Promise<{ output: string; error?: string }> {
    try {
      // 1. 加载 Agent 定义
      const store = await AgentStore.getInstance();
      const agentDef = await store.get(params.agentId);

      if (!agentDef) {
        return {
          output: '',
          error: `Agent "${params.agentId}" not found`
        };
      }

      // 2. 构建 Builder
      const builder = await this.buildAgentExecutor(agentDef, params.context);

      // 3. 执行（收集完整输出）
      const gen = agentExecutor.stream({
        sessionId: params.sessionId,
        message: params.message,
        builder
      });

      let output = '';
      for await (const chunk of gen) {
        if (chunk.type === 'text:delta') {
          output += chunk.content;
        }
      }

      return { output: output.trim() };
    } catch (err) {
      return {
        output: '',
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  /**
   * 流式执行 Agent
   *
   * @param params - 执行参数
   * @yields StreamChunk - 流式输出块
   */
  async *streamAgent(params: {
    agentId: string;
    sessionId: string;
    message: string;
    context: ChannelContext;
  }): AsyncGenerator<StreamChunk, void, unknown> {
    try {
      // 1. 加载 Agent 定义
      const store = await AgentStore.getInstance();
      const agentDef = await store.get(params.agentId);

      if (!agentDef) {
        yield {
          type: 'run:error',
          content: `Agent "${params.agentId}" not found`
        } as StreamChunk;
        return;
      }

      // 2. 构建 Builder
      const builder = await this.buildAgentExecutor(agentDef, params.context);

      // 3. 流式执行
      const gen = agentExecutor.stream({
        sessionId: params.sessionId,
        message: params.message,
        builder
      });

      for await (const chunk of gen) {
        yield chunk;
      }
    } catch (err) {
      yield {
        type: 'run:error',
        content: err instanceof Error ? err.message : String(err)
      } as StreamChunk;
    }
  }

  /**
   * 构建 AgentExecutor Builder
   *
   * @param agentDef - Agent 定义
   * @param context - Channel 上下文
   * @returns Builder 实例
   */
  private async buildAgentExecutor(
    agentDef: {
      id: string;
      name: string;
      instructions: string;
      tools?: string[];
      skills?: string[];
      model?: string;
      thinkingLevel?: string;
    },
    context: ChannelContext
  ): Promise<PiMonoBuilder> {
    // 1. 创建 Builder
    const builder = agentExecutor
      .piMono()
      .name(agentDef.name || agentDef.id)
      .mode('chat')
      .sessionMode('memory')
      .instructions(this.enhanceInstructions(agentDef.instructions, context));

    // 2. 注入工具
    if (agentDef.tools?.length) {
      const registry = ToolRegistry.getInstance();
      const extTools = registry.getAll();
      const allTools = [...builtinTools, ...extTools];
      const selectedTools = allTools.filter((t) => agentDef.tools!.includes(t.name));
      builder.tools(selectedTools);
    }

    // 3. 注入技能
    if (agentDef.skills?.length) {
      const { Env } = await import('@main/common/env');
      const skillManager = new SkillManager();
      const searchPaths = [Env.paths.builtinSkillsDir, Env.paths.userSkillsDir];
      skillManager.scanSkills(searchPaths, Env.paths.secretsDir);
      const skillDefs = agentDef.skills
        .map((name) => skillManager.getByName(name))
        .filter((s): s is NonNullable<typeof s> => s !== null);
      if (skillDefs.length > 0) {
        builder.skills(skillDefs);
      }
    }

    // 4. 设置模型
    if (agentDef.model) {
      builder.model(agentDef.model);
    }

    // 5. 设置思考层级
    if (agentDef.thinkingLevel) {
      builder.thinkingLevel(agentDef.thinkingLevel as ThinkingLevel);
    }

    return builder;
  }

  /**
   * 增强指令（注入 Channel 上下文）
   *
   * @param baseInstructions - 基础指令
   * @param context - Channel 上下文
   * @returns 增强后的指令
   */
  private enhanceInstructions(baseInstructions: string, context: ChannelContext): string {
    let enhanced = baseInstructions;

    // 根据 Channel 类型注入不同上下文
    switch (context.channel) {
      case 'discussion':
        enhanced += this.buildDiscussionContext(context);
        break;
      case 'consultation':
        enhanced += this.buildConsultationContext(context);
        break;
      case 'feishu':
        enhanced += this.buildFeishuContext(context);
        break;
      case 'slack':
        enhanced += this.buildSlackContext(context);
        break;
      default:
        // 通用上下文
        enhanced += `\n\n## Channel Context\n`;
        enhanced += `- Channel: ${context.channel}\n`;
    }

    return enhanced;
  }

  /**
   * 构建讨论室上下文
   */
  private buildDiscussionContext(context: ChannelContext): string {
    let ctx = `\n\n## Discussion Context\n`;
    ctx += `- Your role: ${context.role || 'Participant'}\n`;
    ctx += `- Topic: ${context.topic || 'General Discussion'}\n`;

    if (context.recentMessages && Array.isArray(context.recentMessages)) {
      ctx += `- Recent messages:\n`;
      const messages = context.recentMessages as Array<{ sender: string; content: string }>;
      messages.forEach((m) => {
        ctx += `  - ${m.sender}: ${m.content}\n`;
      });
    }

    return ctx;
  }

  /**
   * 构建专家会诊上下文
   */
  private buildConsultationContext(context: ChannelContext): string {
    let ctx = `\n\n## Expert Consultation Context\n`;
    ctx += `- Your role: ${context.role || 'Expert'}\n`;
    ctx += `- Case: ${context.caseDescription || 'Expert consultation'}\n`;

    if (context.previousOpinions && Array.isArray(context.previousOpinions)) {
      ctx += `- Previous expert opinions:\n`;
      const opinions = context.previousOpinions as Array<{ expert: string; opinion: string }>;
      opinions.forEach((o) => {
        ctx += `  - ${o.expert}: ${o.opinion}\n`;
      });
    }

    return ctx;
  }

  /**
   * 构建飞书上下文
   */
  private buildFeishuContext(context: ChannelContext): string {
    let ctx = `\n\n## Feishu Context\n`;
    ctx += `- Platform: Feishu (飞书)\n`;
    ctx += `- Chat Type: ${context.chatType || 'unknown'}\n`;
    ctx += `- Chat ID: ${context.chatId || 'unknown'}\n`;

    if (context.mentionedBot) {
      ctx += `- You were @mentioned by the user\n`;
    }

    return ctx;
  }

  /**
   * 构建 Slack 上下文
   */
  private buildSlackContext(context: ChannelContext): string {
    let ctx = `\n\n## Slack Context\n`;
    ctx += `- Workspace: ${context.workspace || 'unknown'}\n`;
    ctx += `- Channel: ${context.channelName || 'unknown'}\n`;

    if (context.threadTs) {
      ctx += `- Thread: ${context.threadTs}\n`;
    }

    return ctx;
  }
}
