/**
 * Agent 定义类型
 *
 * 描述一个可创建的 Agent 实例的所有配置。
 * Agent 定义持久化到 .home/agents/{agentId}.json，
 * 由 AgentStore 管理 CRUD，通过 HTTP API 和 AI Creator 暴露给 LLM。
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
   * 排除的工具名称列表（黑名单）
   *
   * 默认所有工具可用。通过此字段明确排除不需要的工具。
   * 空数组或未定义 = 使用所有可用工具。
   * 示例：["exec", "process"] = 排除命令执行相关工具
   */
  excludeTools?: string[];

  /**
   * 关联的 Skill 名称列表
   *
   * Skill 路径会在运行时通过 Skill 搜索路径解析。
   */
  skills?: string[];

  /**
   * 模型配置（支持三种格式）:
   *
   * 1. 单个模型（现有格式，兼容）
   *    "openai/gpt-4o"
   *
   * 2. 模型组引用（新增）
   *    "@high-performance"  → 引用配置中的 models.groups.high-performance
   *
   * 3. Auto 模式（新增）
   *    "auto"  → 系统自动选择最佳模型
   */
  model?: string;

  /** 思维链级别（可选，默认用全局配置） */
  thinkingLevel?: ThinkingLevel;

  /** 温度参数（可选，0-2，控制输出随机性） */
  temperature?: number;

  /** 最大 Token 数（可选，限制输出长度） */
  maxTokens?: number;

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
  /** 排除的工具名称列表（黑名单） */
  excludeTools?: string[];
  /** 关联的 Skill 名称列表（用于前端展示） */
  skills?: string[];
}

// ==================== 创建 / 更新参数 ====================

/** 创建 Agent 的输入参数（由 LLM 或用户提供） */
export interface CreateAgentParams {
  id: string;
  name: string;
  description: string;
  instructions: string;
  excludeTools?: string[];
  skills?: string[];
  model?: string;
  thinkingLevel?: ThinkingLevel;
  temperature?: number;
  maxTokens?: number;
  createdBy?: 'user' | 'agent' | 'system';
  metadata?: Record<string, unknown>;
}

/** 更新 Agent 的输入参数（部分更新，id 不可变） */
export interface UpdateAgentParams {
  name?: string;
  description?: string;
  instructions?: string;
  excludeTools?: string[];
  skills?: string[];
  model?: string;
  thinkingLevel?: ThinkingLevel;
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, unknown>;
}
