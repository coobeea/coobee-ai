/**
 * Agent 定义持久化存储
 *
 * 多级合并：builtin agents/ (只读) + .home/agents/ (可读写)
 * 提供 CRUD 操作，启动时扫描目录加载索引。
 *
 * 设计：
 *   - 每个 Agent 独立 JSON 文件（便于 LLM 直接读写、用户查看）
 *   - 内存索引（id → AgentIndexEntry）加速 list 操作
 *   - 多级目录扫描（builtin < user，同 ID 时 user 覆盖 builtin）
 *   - 全量读取按需（get 时才读文件）
 *   - 单例模式（通过 getInstance）
 */

import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '@main/common/logger';
import { ensureCoreSkills } from '../skills/CoreSkills';
import { AgentHomeManager } from './AgentHomeManager';
import type { AgentDefinition, AgentIndexEntry, CreateAgentParams, UpdateAgentParams } from './types';

const log = createLogger('agent-store');

// ==================== AgentStore ====================

export class AgentStore {
  private static instance: AgentStore | null = null;

  private readonly builtinDir: string;
  private readonly userDir: string;

  /** 内存索引（启动时加载，运行时同步更新） */
  private index = new Map<string, AgentIndexEntry>();

  /** 是否已初始化 */
  private initialized = false;

  constructor(builtinDir: string, userDir: string) {
    this.builtinDir = builtinDir;
    this.userDir = userDir;
  }

  // ==================== 单例 ====================

  static async getInstance(): Promise<AgentStore> {
    if (!AgentStore.instance) {
      // 延迟加载 Env，避免循环依赖
      const { Env } = await import('@main/common/env');
      AgentStore.instance = new AgentStore(Env.paths.builtinAgentsDir, Env.paths.userAgentsDir);
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

    // 确保 user 目录存在（builtin 目录应该随代码存在）
    if (!fs.existsSync(this.userDir)) {
      fs.mkdirSync(this.userDir, { recursive: true });
    }

    // 扫描目录加载索引（多级合并）
    await this.rebuildIndex();

    this.initialized = true;
    log.info(
      `[AgentStore] Initialized: ${this.index.size} agents loaded (builtin: ${this.builtinDir}, user: ${this.userDir})`
    );
  }

  /** 扫描目录重建索引（多级合并：builtin < user） */
  private async rebuildIndex(): Promise<void> {
    this.index.clear();

    // 1. 先加载 builtin agents（优先级低）
    if (fs.existsSync(this.builtinDir)) {
      const builtinFiles = fs.readdirSync(this.builtinDir).filter((f) => f.endsWith('.json'));
      for (const file of builtinFiles) {
        try {
          const filePath = path.join(this.builtinDir, file);
          const raw = fs.readFileSync(filePath, 'utf-8');
          const def = JSON.parse(raw) as AgentDefinition;

          // 补充时间戳（builtin agents 文件中没有）
          if (!def.createdAt) def.createdAt = new Date().toISOString();
          if (!def.updatedAt) def.updatedAt = def.createdAt;
          if (!def.version) def.version = 1;

          this.index.set(def.id, toIndexEntry(def));
        } catch (err) {
          log.warn(`[AgentStore] Failed to load builtin ${file}:`, err);
        }
      }
    }

    // 2. 再加载 user agents（优先级高，覆盖同 ID）
    if (fs.existsSync(this.userDir)) {
      const userFiles = fs.readdirSync(this.userDir).filter((f) => f.endsWith('.json'));
      for (const file of userFiles) {
        try {
          const filePath = path.join(this.userDir, file);
          const raw = fs.readFileSync(filePath, 'utf-8');
          const def = JSON.parse(raw) as AgentDefinition;
          this.index.set(def.id, toIndexEntry(def));
        } catch (err) {
          log.warn(`[AgentStore] Failed to load user ${file}:`, err);
        }
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

    const skills = ensureCoreSkills(params.skills ? [...params.skills] : []);

    const definition: AgentDefinition = {
      id: params.id,
      name: params.name,
      description: params.description,
      instructions: params.instructions,
      excludeTools: params.excludeTools,
      skills, // 使用处理后的 skills
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

    // 同步创建 Agent Home 目录
    try {
      const { Env } = await import('@main/common/env');
      const homeManager = new AgentHomeManager(Env.paths.homesDir);
      homeManager.initHome(definition.id);

      // 同步 skills 到 AGENTS.md（自动激活）
      if (skills.length > 0) {
        await this.syncSkillsToAgentsMd(definition.id, skills);
      }
    } catch (err) {
      log.warn(`[AgentStore] Failed to init agent home for ${definition.id}:`, err);
    }

    log.info(`[AgentStore] Created agent: ${definition.id} (v${definition.version})`);
    return definition;
  }

  /** 获取 Agent 完整定义 */
  async get(agentId: string): Promise<AgentDefinition | null> {
    await this.init();

    if (!this.index.has(agentId)) return null;

    const filePath = this.findAgentFile(agentId);
    if (!filePath) {
      this.index.delete(agentId);
      return null;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const def = JSON.parse(raw) as AgentDefinition;

      // 补充时间戳（builtin agents 文件中可能没有）
      if (!def.createdAt) def.createdAt = new Date().toISOString();
      if (!def.updatedAt) def.updatedAt = def.createdAt;
      if (!def.version) def.version = 1;

      return def;
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

    // 检查是否是 builtin agent（通过检查文件位置）
    const isBuiltin = this.isBuiltinAgent(agentId);
    if (isBuiltin) {
      throw new Error(
        `Built-in agent "${agentId}" cannot be modified. Create a new agent or copy it to user directory first.`
      );
    }

    const updatedSkills = params.skills !== undefined ? ensureCoreSkills([...params.skills]) : undefined;

    const updated: AgentDefinition = {
      ...existing,
      ...(params.name !== undefined && { name: params.name }),
      ...(params.description !== undefined && { description: params.description }),
      ...(params.instructions !== undefined && { instructions: params.instructions }),
      ...(params.excludeTools !== undefined && { excludeTools: params.excludeTools }),
      ...(updatedSkills !== undefined && { skills: updatedSkills }),
      ...(params.model !== undefined && { model: params.model }),
      ...(params.thinkingLevel !== undefined && { thinkingLevel: params.thinkingLevel }),
      ...(params.metadata !== undefined && { metadata: params.metadata }),
      updatedAt: new Date().toISOString(),
      version: existing.version + 1
    };

    // 写文件（只写入 userDir）
    this.writeDefinition(updated);

    // 更新索引
    this.index.set(updated.id, toIndexEntry(updated));

    // 同步 skills 到 AGENTS.md（如果 skills 有变化）
    if (updatedSkills !== undefined) {
      try {
        await this.syncSkillsToAgentsMd(agentId, updatedSkills);
      } catch (err) {
        log.warn(`[AgentStore] Failed to sync skills to AGENTS.md for ${agentId}:`, err);
      }
    }

    log.info(`[AgentStore] Updated agent: ${agentId} (v${updated.version})`);
    return updated;
  }

  /** 删除 Agent（内置 Agent 不可删除） */
  async delete(agentId: string): Promise<boolean> {
    await this.init();

    if (!this.index.has(agentId)) return false;

    // 内置 Agent 不可删除
    if (this.isBuiltinAgent(agentId)) {
      throw new Error(`Built-in agent "${agentId}" cannot be deleted`);
    }

    const filePath = path.join(this.userDir, `${agentId}.json`);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      this.index.delete(agentId);
      // Agent Home 目录保留（记忆不应随定义删除而丢失）
      log.info(`[AgentStore] Deleted agent: ${agentId} (Home preserved)`);
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

  /**
   * 查找 Agent 文件的实际路径（优先 user，其次 builtin）
   * @returns 文件路径，不存在返回 null
   */
  private findAgentFile(agentId: string): string | null {
    const userPath = path.join(this.userDir, `${agentId}.json`);
    if (fs.existsSync(userPath)) return userPath;

    const builtinPath = path.join(this.builtinDir, `${agentId}.json`);
    if (fs.existsSync(builtinPath)) return builtinPath;

    return null;
  }

  /**
   * 检查 Agent 是否是 builtin
   */
  private isBuiltinAgent(agentId: string): boolean {
    const userPath = path.join(this.userDir, `${agentId}.json`);
    const builtinPath = path.join(this.builtinDir, `${agentId}.json`);

    // 如果 user 目录存在，说明已经被覆盖/复制，不算 builtin
    if (fs.existsSync(userPath)) return false;

    // 否则检查是否存在于 builtin 目录
    return fs.existsSync(builtinPath);
  }

  /**
   * 写入 Agent 定义（只写入 userDir）
   */
  private writeDefinition(def: AgentDefinition): void {
    const filePath = path.join(this.userDir, `${def.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(def, null, 2), 'utf-8');
  }

  /**
   * 同步 skills 到 Agent Home 的 AGENTS.md
   *
   * 将 Agent 定义中的 skills 写入 homes/{agentId}/AGENTS.md，
   * 这样技能会自动激活，无需用户每次手动指定。
   *
   * @param agentId - Agent ID
   * @param skills - 技能名称列表
   */
  private async syncSkillsToAgentsMd(agentId: string, skills: string[]): Promise<void> {
    try {
      const { Env } = await import('@main/common/env');
      const agentHome = Env.getAgentHomeDir(agentId);
      const agentsMdPath = path.join(agentHome, 'AGENTS.md');

      // 构建 skills 内容块
      const skillsBlock = this.buildSkillsBlock(skills);

      // 读取现有 AGENTS.md（如果存在）
      let existingContent = '';
      if (fs.existsSync(agentsMdPath)) {
        existingContent = fs.readFileSync(agentsMdPath, 'utf-8');
      }

      // 替换或追加 skills 块
      const updatedContent = this.replaceOrAppendSkillsBlock(existingContent, skillsBlock);

      // 写回文件
      fs.writeFileSync(agentsMdPath, updatedContent, 'utf-8');

      log.info(`[AgentStore] Synced ${skills.length} skills to ${agentsMdPath}`);
    } catch (err) {
      log.error(`[AgentStore] Failed to sync skills to AGENTS.md for ${agentId}:`, err);
      throw err;
    }
  }

  /**
   * 构建 skills 内容块
   */
  private buildSkillsBlock(skills: string[]): string {
    if (skills.length === 0) {
      return `<skills_system priority="1">
## Available Skills

无技能配置。使用 \`skill_list\` 工具查看可用技能。

</skills_system>`;
    }

    const skillItems = skills.map((s) => `- ${s}`).join('\n');
    return `<skills_system priority="1">
## Available Skills

以下技能已为你配置并自动激活：

${skillItems}

使用 \`skill_list\` 工具查看完整技能列表及详细信息。

</skills_system>`;
  }

  /**
   * 替换或追加 skills 块
   *
   * 如果存在 <skills_system> 块，替换它；否则追加到文件末尾。
   */
  private replaceOrAppendSkillsBlock(existingContent: string, skillsBlock: string): string {
    const skillsRegex = /<skills_system[^>]*>[\s\S]*?<\/skills_system>/;

    if (skillsRegex.test(existingContent)) {
      // 替换现有 skills 块
      return existingContent.replace(skillsRegex, skillsBlock);
    } else {
      // 追加到文件末尾（如果文件不为空，先加空行）
      const separator = existingContent.trim() ? '\n\n' : '';
      return existingContent + separator + skillsBlock + '\n';
    }
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
    updatedAt: def.updatedAt,
    excludeTools: def.excludeTools,
    skills: def.skills
  };
}
