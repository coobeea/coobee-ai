/**
 * Agent 定义类型
 *
 * 描述一个可创建的 Agent 实例的所有配置。
 * Agent 定义持久化到 .home/agents/{agentId}.json，
 * 由 AgentStore 管理 CRUD，由 manage_agent 工具暴露给 LLM。
 *
 * 设计原则：
 *   - Agent = instructions + tools + skills + model 配置
 *   - 定义由 LLM 自主生成（通过 agent-creator Skill 指导）
 *   - 文件持久化，应用重启后保留
 */

import type { ThinkingLevel } from '../runtime/pimono/types';
import type { AgentType } from '../threads/types';

// ==================== Agent 定义 ====================

/** Agent 定义（持久化到 .home/agents/{id}.json） */
export interface AgentDefinition {
  /** 唯一标识（kebab-case，如 "code-reviewer"） */
  id: string;

  /** 显示名称（如 "代码审查专家"） */
  name: string;

  /** 一句话描述（LLM 用于判断是否需要此 Agent，前端展示用） */
  description: string;

  /** Agent 分类类型（默认 'agent'） */
  type?: AgentType;

  /** 系统指令（定义 Agent 的人格、专长、行为规范） */
  instructions: string;

  /**
   * 启用的工具名称列表
   *
   * 从 builtin + extension 工具中选择。
   * 空数组 = 不使用任何工具（纯对话）。
   * 未定义 = 使用所有可用工具（继承主 Agent 的工具集）。
   */
  tools?: string[];

  /**
   * 关联的 Skill 名称列表
   *
   * Skill 路径会在运行时通过 Skill 搜索路径解析。
   */
  skills?: string[];

  /** 指定模型（可选，默认用全局配置） */
  model?: string;

  /** 思维链级别（可选，默认用全局配置） */
  thinkingLevel?: ThinkingLevel;

  /** 创建时间（ISO 8601） */
  createdAt: string;

  /** 最后更新时间（ISO 8601） */
  updatedAt: string;

  /** 创建者类型（system = 系统内置，不可删除） */
  createdBy: 'user' | 'agent' | 'system';

  /** 版本号（从 1 开始，每次 update 递增） */
  version: number;

  /** 扩展元数据（保留字段，供未来使用） */
  metadata?: Record<string, unknown>;
}

// ==================== 索引条目（轻量级列表用） ====================

/** Agent 索引条目（用于 list 操作，不含 instructions 等大字段） */
export interface AgentIndexEntry {
  id: string;
  name: string;
  description: string;
  createdBy: 'user' | 'agent' | 'system';
  version: number;
  updatedAt: string;
}

// ==================== 创建 / 更新参数 ====================

/** 创建 Agent 的输入参数（由 LLM 或用户提供） */
export interface CreateAgentParams {
  id: string;
  name: string;
  description: string;
  instructions: string;
  tools?: string[];
  skills?: string[];
  model?: string;
  thinkingLevel?: ThinkingLevel;
  createdBy?: 'user' | 'agent' | 'system';
  metadata?: Record<string, unknown>;
}

/** 更新 Agent 的输入参数（部分更新，id 不可变） */
export interface UpdateAgentParams {
  name?: string;
  description?: string;
  instructions?: string;
  tools?: string[];
  skills?: string[];
  model?: string;
  thinkingLevel?: ThinkingLevel;
  metadata?: Record<string, unknown>;
}
