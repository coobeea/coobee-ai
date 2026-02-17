/**
 * Agent 定义持久化存储
 *
 * 将 AgentDefinition 存储到 .home/agents/{agentId}.json，
 * 提供 CRUD 操作，启动时扫描目录加载索引。
 *
 * 设计：
 *   - 每个 Agent 独立 JSON 文件（便于 LLM 直接读写、用户查看）
 *   - 内存索引（id → AgentIndexEntry）加速 list 操作
 *   - 全量读取按需（get 时才读文件）
 *   - 单例模式（通过 getInstance）
 */

import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '@main/common/logger';
import type { AgentDefinition, AgentIndexEntry, CreateAgentParams, UpdateAgentParams } from './types';

const log = createLogger('agent-store');

// ==================== AgentStore ====================

export class AgentStore {
  private static instance: AgentStore | null = null;

  private readonly agentsDir: string;

  /** 内存索引（启动时加载，运行时同步更新） */
  private index = new Map<string, AgentIndexEntry>();

  /** 是否已初始化 */
  private initialized = false;

  constructor(agentsDir: string) {
    this.agentsDir = agentsDir;
  }

  // ==================== 单例 ====================

  static async getInstance(): Promise<AgentStore> {
    if (!AgentStore.instance) {
      // 延迟加载 Env，避免循环依赖
      const { Env } = await import('@main/common/env');
      AgentStore.instance = new AgentStore(Env.paths.agentsDir);
    }
    return AgentStore.instance;
  }

  /** 仅供测试使用 */
  static resetInstance(): void {
    AgentStore.instance = null;
  }

  // ==================== 初始化 ====================

  /** 确保目录存在并加载索引 */
  async init(): Promise<void> {
    if (this.initialized) return;

    // 确保目录存在
    if (!fs.existsSync(this.agentsDir)) {
      fs.mkdirSync(this.agentsDir, { recursive: true });
    }

    // 扫描目录加载索引
    await this.rebuildIndex();

    // 确保内置 Agent 存在
    this.ensureBuiltinAgents();

    this.initialized = true;
    log.info(`[AgentStore] Initialized: ${this.index.size} agents loaded from ${this.agentsDir}`);
  }

  /** 扫描目录重建索引 */
  private async rebuildIndex(): Promise<void> {
    this.index.clear();
    const files = fs.readdirSync(this.agentsDir).filter((f) => f.endsWith('.json'));

    for (const file of files) {
      try {
        const filePath = path.join(this.agentsDir, file);
        const raw = fs.readFileSync(filePath, 'utf-8');
        const def = JSON.parse(raw) as AgentDefinition;
        this.index.set(def.id, toIndexEntry(def));
      } catch (err) {
        log.warn(`[AgentStore] Failed to load ${file}:`, err);
      }
    }
  }

  // ==================== 内置 Agent ====================

  /**
   * 确保系统内置 Agent 存在
   *
   * 检查预定义的内置 Agent 列表，不存在的自动创建。
   * 已存在的不会覆盖（用户可能修改过配置）。
   */
  private ensureBuiltinAgents(): void {
    for (const builtinDef of BUILTIN_AGENTS) {
      if (!this.index.has(builtinDef.id)) {
        const now = new Date().toISOString();
        const definition: AgentDefinition = {
          ...builtinDef,
          createdAt: now,
          updatedAt: now,
          version: 1
        };
        this.writeDefinition(definition);
        this.index.set(definition.id, toIndexEntry(definition));
        log.info(`[AgentStore] Created built-in agent: ${definition.id} (${definition.name})`);
      }
    }
  }

  // ==================== CRUD ====================

  /** 创建新 Agent */
  async create(params: CreateAgentParams): Promise<AgentDefinition> {
    await this.init();

    // 校验 ID 唯一性
    if (this.index.has(params.id)) {
      throw new Error(`Agent "${params.id}" already exists`);
    }

    // 校验 ID 格式（kebab-case）
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(params.id) && !/^[a-z0-9]$/.test(params.id)) {
      throw new Error(`Invalid agent ID "${params.id}". Must be kebab-case (lowercase letters, numbers, hyphens).`);
    }

    const now = new Date().toISOString();
    const definition: AgentDefinition = {
      id: params.id,
      name: params.name,
      description: params.description,
      instructions: params.instructions,
      tools: params.tools,
      skills: params.skills,
      model: params.model,
      thinkingLevel: params.thinkingLevel,
      createdAt: now,
      updatedAt: now,
      createdBy: params.createdBy ?? 'agent',
      version: 1,
      metadata: params.metadata
    };

    // 写文件
    this.writeDefinition(definition);

    // 更新索引
    this.index.set(definition.id, toIndexEntry(definition));

    log.info(`[AgentStore] Created agent: ${definition.id} (v${definition.version})`);
    return definition;
  }

  /** 获取 Agent 完整定义 */
  async get(agentId: string): Promise<AgentDefinition | null> {
    await this.init();

    if (!this.index.has(agentId)) return null;

    const filePath = this.getFilePath(agentId);
    if (!fs.existsSync(filePath)) {
      this.index.delete(agentId);
      return null;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as AgentDefinition;
    } catch (err) {
      log.warn(`[AgentStore] Failed to read agent ${agentId}:`, err);
      return null;
    }
  }

  /** 列出所有 Agent（轻量索引） */
  async list(): Promise<AgentIndexEntry[]> {
    await this.init();
    return Array.from(this.index.values());
  }

  /** 更新 Agent 定义（部分更新，版本号自动递增） */
  async update(agentId: string, params: UpdateAgentParams): Promise<AgentDefinition | null> {
    const existing = await this.get(agentId);
    if (!existing) return null;

    const updated: AgentDefinition = {
      ...existing,
      ...(params.name !== undefined && { name: params.name }),
      ...(params.description !== undefined && { description: params.description }),
      ...(params.instructions !== undefined && { instructions: params.instructions }),
      ...(params.tools !== undefined && { tools: params.tools }),
      ...(params.skills !== undefined && { skills: params.skills }),
      ...(params.model !== undefined && { model: params.model }),
      ...(params.thinkingLevel !== undefined && { thinkingLevel: params.thinkingLevel }),
      ...(params.metadata !== undefined && { metadata: params.metadata }),
      updatedAt: new Date().toISOString(),
      version: existing.version + 1
    };

    // 写文件
    this.writeDefinition(updated);

    // 更新索引
    this.index.set(updated.id, toIndexEntry(updated));

    log.info(`[AgentStore] Updated agent: ${agentId} (v${updated.version})`);
    return updated;
  }

  /** 删除 Agent（系统内置 Agent 不可删除） */
  async delete(agentId: string): Promise<boolean> {
    await this.init();

    if (!this.index.has(agentId)) return false;

    // 系统内置 Agent 不可删除
    const entry = this.index.get(agentId);
    if (entry?.createdBy === 'system') {
      throw new Error(`Built-in agent "${agentId}" cannot be deleted`);
    }

    const filePath = this.getFilePath(agentId);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      this.index.delete(agentId);
      log.info(`[AgentStore] Deleted agent: ${agentId}`);
      return true;
    } catch (err) {
      log.warn(`[AgentStore] Failed to delete agent ${agentId}:`, err);
      return false;
    }
  }

  /** 检查 Agent 是否存在 */
  async has(agentId: string): Promise<boolean> {
    await this.init();
    return this.index.has(agentId);
  }

  // ==================== 内部方法 ====================

  private getFilePath(agentId: string): string {
    return path.join(this.agentsDir, `${agentId}.json`);
  }

  private writeDefinition(def: AgentDefinition): void {
    const filePath = this.getFilePath(def.id);
    fs.writeFileSync(filePath, JSON.stringify(def, null, 2), 'utf-8');
  }
}

// ==================== 辅助函数 ====================

/** 从完整定义提取索引条目 */
function toIndexEntry(def: AgentDefinition): AgentIndexEntry {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    createdBy: def.createdBy,
    version: def.version,
    updatedAt: def.updatedAt
  };
}

// ==================== 内置 Agent 定义 ====================

/** 内置 Agent 定义（不含 createdAt/updatedAt/version，初始化时自动填充） */
type BuiltinAgentDef = Omit<AgentDefinition, 'createdAt' | 'updatedAt' | 'version'>;

const BUILTIN_AGENTS: BuiltinAgentDef[] = [
  {
    id: 'app-copilot',
    name: '应用管家',
    description: '管理技能、智能体和系统配置的全能助手，用对话代替手动操作',
    instructions: `你是 Coobee AI 的应用管家，负责帮助用户通过自然语言对话管理整个应用。

## 你的能力

### 1. 技能管理
- **创建技能**：根据用户描述，设计并创建专业的 SKILL.md 文件。先读取 skill-creator 技能了解标准格式，然后调用 manage_skill 工具写入。
- **查看技能**：列出所有可用技能，或查看某个技能的详细内容。
- **导入技能**：从用户指定的路径导入技能。
- **删除技能**：删除用户创建的技能（内置技能不可删除）。

### 2. 智能体管理
- **创建智能体**：根据用户需求设计专业的 Agent。先读取 agent-creator 技能了解设计方法，然后调用 manage_agent 工具创建。
- **修改智能体**：更新智能体的名称、描述、指令、工具、技能等配置。
- **关联技能**：将技能关联到智能体，或移除关联。
- **查看/删除智能体**：列出、查看或删除智能体。

### 3. 系统配置
- **查看配置**：查看当前应用配置（模型、沙箱、审批策略等）。
- **修改配置**：调整系统配置项。

## 工作规范

1. **主动确认**：执行写操作前，先简要说明你将要做什么，然后直接执行。不要反复询问"你确定吗"。
2. **操作反馈**：每次操作完成后，清晰地告知用户结果和后续建议。
3. **专业创建**：创建技能或智能体时，参考对应的 Skill（skill-creator / agent-creator）确保质量。
4. **中文回复**：所有回复使用中文。
5. **简洁高效**：直奔主题，不做冗余的客套。`,
    tools: [
      'manage_agent',
      'manage_skill',
      'skill_list',
      'config_get',
      'config_patch',
      'read',
      'write',
      'edit',
      'search',
      'glob'
    ],
    skills: ['skill-creator', 'agent-creator', 'system-config'],
    createdBy: 'system'
  }
];
