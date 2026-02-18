/**
 * Skill 管理器 — 文件驱动的 Skill 生命周期管理
 *
 * 职责：
 *   - 扫描目录下所有 SKILL.md 文件并解析 frontmatter
 *   - 支持多级搜索路径（内置 → Extension → 用户 → 工作空间），后到覆盖（高优先级覆盖低优先级）
 *   - 动态注册/注销（Extension 贡献）
 *   - 动态添加搜索路径
 *   - 查询（按名称、全量）
 *   - 格式化输出（生成 <skill> XML 块供提示词注入）
 *
 * 不负责：
 *   - 路径的定义和存储（由 Env 提供）
 *   - 环境信息的构建（由 AgentEnv 负责）
 */

import fs from 'fs';
import path from 'path';
import { log } from '@main/common/logger';
import type { SkillConfigField, SkillDefinition } from '../runtime/types';
import { loadSkillConfigs, type SkillConfigMap } from './SkillConfig';

// ==================== Skill 文件解析 ====================

/**
 * 解析 SKILL.md 文件内容，提取 frontmatter 中的 name/description 和正文
 *
 * @param filePath SKILL.md 文件的绝对路径
 * @returns 解析结果，或 null（文件不存在/解析失败）
 */
export function parseSkillMd(filePath: string): {
  name: string;
  description: string;
  content: string;
  configSchema?: SkillConfigField[];
} | null {
  try {
    if (!fs.existsSync(filePath)) return null;

    const raw = fs.readFileSync(filePath, 'utf-8');

    // 解析 YAML frontmatter: ---\nkey: value\n---
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!fmMatch) {
      // 无 frontmatter，用目录名作为 name
      const dirName = path.basename(path.dirname(filePath));
      return { name: dirName, description: '', content: raw.trim() };
    }

    const frontmatter = fmMatch[1];
    const body = fmMatch[2].trim();

    // 简单解析 YAML（只取 name 和 description）
    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

    // 解析 config 字段（YAML 列表）
    const configSchema = parseConfigFromFrontmatter(frontmatter);

    const dirName = path.basename(path.dirname(filePath));
    return {
      name: nameMatch ? nameMatch[1].trim() : dirName,
      description: descMatch ? descMatch[1].trim() : '',
      content: body,
      configSchema: configSchema.length > 0 ? configSchema : undefined
    };
  } catch {
    return null;
  }
}

/**
 * 从 frontmatter 中解析 config 列表
 *
 * 支持的格式：
 * config:
 *   - key: apiKey
 *     description: PaddleOCR API Key
 *     required: true
 *   - key: baseUrl
 *     description: API 地址
 *     default: https://api.example.com
 */
function parseConfigFromFrontmatter(frontmatter: string): SkillConfigField[] {
  // 匹配 config: 开始的块（到下一个顶级字段或结束）
  const configBlockMatch = frontmatter.match(/^config:\s*\n((?:[\t ]+.+\n?)*)/m);
  if (!configBlockMatch) return [];

  const configBlock = configBlockMatch[1];
  const fields: SkillConfigField[] = [];

  // 按 "- key:" 分割出每个配置项
  const items = configBlock.split(/^[\t ]*- /m).filter((s) => s.trim());

  for (const item of items) {
    const keyMatch = item.match(/key:\s*(.+)/);
    if (!keyMatch) continue;

    const field: SkillConfigField = {
      key: keyMatch[1].trim(),
      description: ''
    };

    const descMatch = item.match(/description:\s*(.+)/);
    if (descMatch) field.description = descMatch[1].trim();

    const reqMatch = item.match(/required:\s*(.+)/);
    if (reqMatch) field.required = reqMatch[1].trim() === 'true';

    const defaultMatch = item.match(/default:\s*(.+)/);
    if (defaultMatch) field.default = defaultMatch[1].trim();

    fields.push(field);
  }

  return fields;
}

// ==================== SkillManager ====================

export class SkillManager {
  /**
   * Per-session SkillManager 实例映射
   *
   * 解决了之前全局单例的竞态问题：多个 session 并发执行时，
   * 后注入的 setCurrent 会覆盖前一个 session 的实例。
   * 现在每个 session 拥有独立的 SkillManager，互不干扰。
   */
  private static sessionInstances = new Map<string, SkillManager>();

  /** 兼容旧代码：最后一个被 set 的实例作为 fallback */
  private static fallbackInstance: SkillManager | null = null;

  /** 全局 Skill 缓存（searchPaths key → { skills, timestamp }） */
  private static cache: {
    key: string;
    skills: Map<string, SkillDefinition>;
    dirMap: Map<string, string>;
    ts: number;
  } | null = null;

  /** 缓存有效期（毫秒），默认 30 秒 */
  private static CACHE_TTL_MS = 30_000;

  /**
   * 设置指定 session 的 SkillManager 实例
   *
   * @param manager  SkillManager 实例
   * @param sessionId 会话标识（可选，无则仅设置 fallback）
   */
  static setCurrent(manager: SkillManager, sessionId?: string): void {
    SkillManager.fallbackInstance = manager;
    if (sessionId) {
      SkillManager.sessionInstances.set(sessionId, manager);
    }
  }

  /**
   * 获取 SkillManager 实例
   *
   * 优先按 sessionId 查找，找不到时使用 fallback。
   */
  static getCurrent(sessionId?: string): SkillManager | null {
    if (sessionId) {
      const inst = SkillManager.sessionInstances.get(sessionId);
      if (inst) return inst;
    }
    return SkillManager.fallbackInstance;
  }

  /**
   * 清除指定 session 的 SkillManager（session 结束时调用）
   */
  static clearSession(sessionId: string): void {
    SkillManager.sessionInstances.delete(sessionId);
  }

  /** 清除全局缓存（热重载时调用） */
  static invalidateCache(): void {
    SkillManager.cache = null;
  }

  /** 已加载的 Skill（name → SkillDefinition） */
  private skills = new Map<string, SkillDefinition>();

  /** 目录名 → Skill name 的映射（用于后到覆盖时移除旧版本） */
  private dirNameToSkillName = new Map<string, string>();

  /** 配置目录路径（用于加载 skills.json5） */
  private configDir: string | undefined;

  // ========== 扫描与加载 ==========

  /**
   * 扫描多个搜索路径，加载所有 SKILL.md
   *
   * 按搜索路径顺序扫描，**后到覆盖**（同名目录后发现的覆盖先发现的）。
   * 搜索路径顺序应为 低→高 优先级（内置 → Extension → 用户 → 工作空间）。
   * 这样工作空间中的同名 Skill 会覆盖内置 Skill，实现用户定制。
   *
   * @param searchPaths Skill 搜索路径数组（低 → 高优先级）
   * @param configDir 可选的配置目录路径（用于加载 skills.json5 中的配置）
   * @returns 最终有效的 SkillDefinition 数组
   */
  scanSkills(searchPaths: string[], configDir?: string): SkillDefinition[] {
    if (configDir) this.configDir = configDir;

    // 尝试使用缓存（同样的搜索路径 + 未过期）
    const cacheKey = searchPaths.join('|');
    const cached = SkillManager.cache;
    if (cached && cached.key === cacheKey && Date.now() - cached.ts < SkillManager.CACHE_TTL_MS) {
      this.skills = new Map(cached.skills);
      this.dirNameToSkillName = new Map(cached.dirMap);
      log.debug(`[SkillManager] 使用缓存，${this.skills.size} 个 Skill`);
      return this.getAll();
    }

    // 缓存未命中，执行完整扫描
    this.doScan(searchPaths);

    // 注入配置状态
    if (this.configDir) {
      this.injectConfigStatus();
    }

    // 写入缓存
    SkillManager.cache = {
      key: cacheKey,
      skills: new Map(this.skills),
      dirMap: new Map(this.dirNameToSkillName),
      ts: Date.now()
    };

    log.info(`[SkillManager] 扫描加载 ${this.skills.size} 个 Skill: ${[...this.skills.keys()].join(', ')}`);
    return this.getAll();
  }

  /** 内部执行实际的文件系统扫描 */
  private doScan(searchPaths: string[]): void {
    for (const searchDir of searchPaths) {
      try {
        if (!fs.existsSync(searchDir)) continue;

        const entries = fs.readdirSync(searchDir, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (entry.name.startsWith('.')) continue;

          const skillPath = path.join(searchDir, entry.name, 'SKILL.md');
          const parsed = parseSkillMd(skillPath);

          if (!parsed) continue;

          const existingName = this.dirNameToSkillName.get(entry.name);
          if (existingName !== undefined) {
            this.skills.delete(existingName);
          }
          this.dirNameToSkillName.set(entry.name, parsed.name);

          const skill: SkillDefinition = {
            name: parsed.name,
            description: parsed.description,
            content: parsed.content,
            filePath: skillPath,
            configSchema: parsed.configSchema
          };

          this.skills.set(parsed.name, skill);
        }
      } catch (error) {
        log.warn(`[SkillManager] 扫描目录失败: ${searchDir}`, error);
      }
    }
  }

  // ========== 动态注册/注销 ==========

  /**
   * 动态注册 Skill（Extension 贡献等场景）
   *
   * 如果同名 Skill 已存在，会被覆盖。
   */
  register(skill: SkillDefinition): void {
    this.skills.set(skill.name, skill);
    log.debug(`[SkillManager] 注册 Skill: ${skill.name}`);
  }

  /**
   * 注销指定 Skill
   *
   * @returns 是否成功注销（不存在则返回 false）
   */
  unregister(name: string): boolean {
    const existed = this.skills.delete(name);
    if (existed) {
      log.debug(`[SkillManager] 注销 Skill: ${name}`);
    }
    return existed;
  }

  // ========== 查询 ==========

  /** 获取所有已加载的 Skill */
  getAll(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  /** 按名称查找 Skill */
  getByName(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  /** 已加载的 Skill 数量 */
  get size(): number {
    return this.skills.size;
  }

  // ========== 格式化 ==========

  /**
   * 将所有 Skill 格式化为 <skill> XML 块
   *
   * 用于注入到系统提示词的 appendInstructions 中。
   *
   * @returns XML 格式字符串，空则返回空字符串
   */
  toPromptBlocks(): string {
    if (this.skills.size === 0) return '';

    return this.getAll()
      .map((s) => {
        const attrs = [`name="${s.name}"`];

        // 如果 Skill 声明了配置需求，在 prompt 中标注配置状态
        if (s.configSchema && s.configSchema.length > 0) {
          attrs.push(`config-status="${s.configStatus ?? 'missing'}"`);
        }

        return `<skill ${attrs.join(' ')}>\n${s.content}\n</skill>`;
      })
      .join('\n\n');
  }

  // ========== 配置 ==========

  /**
   * 为需要配置的 Skill 注入配置状态
   *
   * 读取 skills.json5，对比 SKILL.md 声明的 configSchema，
   * 标记每个 Skill 的配置状态：configured / partial / missing
   */
  private injectConfigStatus(): void {
    if (!this.configDir) return;

    let configs: SkillConfigMap;
    try {
      configs = loadSkillConfigs(this.configDir);
    } catch {
      return;
    }

    for (const [, skill] of this.skills) {
      if (!skill.configSchema || skill.configSchema.length === 0) {
        // 无配置需求，不设置 configStatus
        continue;
      }

      const skillConfig = configs[skill.name];
      if (!skillConfig) {
        skill.configStatus = 'missing';
        continue;
      }

      // 检查 required 字段是否都已配置
      const requiredFields = skill.configSchema.filter((f) => f.required);
      if (requiredFields.length === 0) {
        // 没有必填项，有配置就算 configured
        skill.configStatus = 'configured';
        continue;
      }

      const allRequiredFilled = requiredFields.every((f) => {
        const val = skillConfig[f.key];
        return val !== undefined && val !== null && val !== '';
      });

      if (allRequiredFilled) {
        skill.configStatus = 'configured';
      } else {
        skill.configStatus = 'partial';
      }
    }
  }

  /**
   * 获取指定 Skill 的运行时配置值
   *
   * 用于 Agent 执行 Skill 时获取真实配置（API Key 等）。
   *
   * @returns 配置对象，未找到返回 undefined
   */
  getSkillRuntimeConfig(skillName: string): Record<string, unknown> | undefined {
    if (!this.configDir) return undefined;
    const configs = loadSkillConfigs(this.configDir);
    return configs[skillName];
  }

  // ========== 清理 ==========

  /** 清空所有已加载的 Skill */
  clear(): void {
    this.skills.clear();
    this.dirNameToSkillName.clear();
  }
}
