/**
 * Agent Home 目录管理器
 *
 * 负责 Agent 持久化 Home 目录的初始化和管理：
 *   - 创建 homes/{agentId}/ 及其子目录
 *   - 生成默认引导文件（BOOTSTRAP.md / SOUL.md / IDENTITY.md 等）
 *   - 读取 Agent Home 中的文件供注入系统提示词
 *   - 管理 sessions.jsonl 索引（Agent 的所有会话 ID 列表）
 *
 * Agent Home 结构：
 *   homes/{agentId}/
 *   ├── SOUL.md          人格与价值观
 *   ├── IDENTITY.md      身份名片
 *   ├── USER.md          主人档案
 *   ├── NOTES.md         环境工具备注
 *   ├── AGENTS.md        Agent 级规则
 *   ├── HEARTBEAT.md     心跳任务清单
 *   ├── BOOTSTRAP.md     首次引导脚本（完成后自删除）
 *   ├── sessions.jsonl   会话索引（追加式，每行一个 session）
 *   └── memory/          Agent 级结构化记忆（由 memory-agent 扩展自动管理）
 */

import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '@main/common/logger';

const log = createLogger('agent-home');

/** Agent Home 中的标准文件 */
const HOME_FILES = ['SOUL.md', 'IDENTITY.md', 'USER.md', 'NOTES.md', 'AGENTS.md', 'HEARTBEAT.md'] as const;

/** 需要注入到 system prompt 的文件（按优先级排序） */
const INJECTABLE_FILES = ['BOOTSTRAP.md', 'SOUL.md', 'IDENTITY.md', 'USER.md', 'NOTES.md', 'HEARTBEAT.md'] as const;

/** 每个文件的用途说明（模板状态时展示） */
const FILE_PURPOSES: Record<string, string> = {
  'BOOTSTRAP.md': '首次引导脚本',
  'SOUL.md': '人格灵魂：核心原则、行为边界、风格定调',
  'IDENTITY.md': '身份名片：名字、风格、签名',
  'USER.md': '主人档案：用户称呼、偏好、使用场景',
  'NOTES.md': '环境工具备注：特殊配置、常用路径',
  'HEARTBEAT.md': '心跳任务清单：定期检查和执行的事项'
};

// ==================== 模板定义 ====================

function bootstrapTemplate(agentId: string): string {
  return `# 首次引导

你刚刚上线。这是你的第一次对话——你还没有名字，没有风格，也不认识使用你的人。

请完成以下步骤来建立你的身份：

1. 向用户打招呼，询问他们希望你叫什么名字、什么风格（严肃/活泼/温和...）
2. 了解用户：姓名/称呼、主要用途、偏好
3. 将你的身份信息写入 IDENTITY.md（Name / Vibe / Emoji）
4. 将用户信息写入 USER.md
5. 根据对话撰写初版 SOUL.md（你的核心原则和行为风格）
6. 删除本文件（BOOTSTRAP.md）——你不再需要引导脚本了，你已经是你了。

重要：这些文件都在你的 Agent Home 目录下（agentId: ${agentId}）。使用 write 工具写入。
`;
}

function soulTemplate(): string {
  return `# Soul

<!-- 你的人格灵魂。核心原则、行为边界、风格定调。 -->
<!-- 这个文件由你自主填写和演化，修改时须告知用户。 -->
<!-- "You're not a chatbot. You're becoming someone." -->
`;
}

function identityTemplate(): string {
  return `# Identity

<!-- 你的身份名片 -->
<!-- Name: (你的名字) -->
<!-- Vibe: (你的风格，如温和/严肃/活泼) -->
<!-- Emoji: (你的签名 emoji) -->
`;
}

function userTemplate(): string {
  return `# User

<!-- 主人档案：了解你的用户 -->
<!-- Name: (用户的称呼) -->
<!-- Preferences: (用户偏好) -->
<!-- Context: (用户的使用场景和需求) -->
`;
}

function notesTemplate(): string {
  return `# Notes

<!-- 环境工具备注：记录当前环境的特殊配置 -->
<!-- 如 TTS 语音偏好、SSH 主机别名、常用路径等 -->
`;
}

function heartbeatTemplate(): string {
  return `# Heartbeat Tasks

<!-- 心跳任务清单：你定期需要检查和执行的事项 -->
<!-- 收到心跳轮询时，逐条检查并执行。文件为空则跳过。 -->
<!-- 格式：每行一个任务，用 - 开头 -->
`;
}

function agentsMdTemplate(): string {
  return `# Agent Rules

<!-- Agent 级规则：覆盖/补充全局 AGENTS.md -->
<!-- 积累经验教训时在此添加规则 -->
`;
}

const TEMPLATES: Record<string, () => string> = {
  'SOUL.md': soulTemplate,
  'IDENTITY.md': identityTemplate,
  'USER.md': userTemplate,
  'NOTES.md': notesTemplate,
  'HEARTBEAT.md': heartbeatTemplate,
  'AGENTS.md': agentsMdTemplate
};

// ==================== AgentHomeManager ====================

export class AgentHomeManager {
  private readonly homesDir: string;

  constructor(homesDir: string) {
    this.homesDir = homesDir;
  }

  /**
   * 初始化指定 Agent 的 Home 目录
   *
   * 如果目录已存在，不会覆盖已有文件。
   * 仅在文件缺失时写入默认模板。
   */
  initHome(agentId: string): string {
    const homeDir = path.join(this.homesDir, agentId);
    const memoryDir = path.join(homeDir, 'memory');

    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(memoryDir, { recursive: true });

    // BOOTSTRAP.md（仅首次创建时写入——如果任何标准文件已存在，说明不是首次）
    const bootstrapPath = path.join(homeDir, 'BOOTSTRAP.md');
    const isFirstTime = !HOME_FILES.some((f) => fs.existsSync(path.join(homeDir, f)));
    if (isFirstTime && !fs.existsSync(bootstrapPath)) {
      fs.writeFileSync(bootstrapPath, bootstrapTemplate(agentId), 'utf-8');
    }

    // 写入缺失的标准文件
    for (const file of HOME_FILES) {
      const filePath = path.join(homeDir, file);
      if (!fs.existsSync(filePath)) {
        const templateFn = TEMPLATES[file];
        if (templateFn) {
          fs.writeFileSync(filePath, templateFn(), 'utf-8');
        }
      }
    }

    log.info(`[AgentHomeManager] Initialized home for agent: ${agentId}`);
    return homeDir;
  }

  /**
   * 批量初始化多个 Agent 的 Home 目录
   */
  initHomes(agentIds: string[]): void {
    fs.mkdirSync(this.homesDir, { recursive: true });
    for (const id of agentIds) {
      try {
        this.initHome(id);
      } catch (err) {
        log.warn(`[AgentHomeManager] Failed to init home for ${id}:`, err);
      }
    }
  }

  /**
   * 检查 Agent Home 是否存在
   */
  hasHome(agentId: string): boolean {
    return fs.existsSync(path.join(this.homesDir, agentId));
  }

  /**
   * 获取 Agent Home 目录路径（不自动创建）
   */
  getHomePath(agentId: string): string {
    return path.join(this.homesDir, agentId);
  }

  /**
   * 读取 Agent Home 中需要注入到 system prompt 的文件
   *
   * 所有标准文件都会被加载——即使尚未填写（模板状态），也会以简要说明形式出现，
   * 确保 Agent 始终知道自己的 Home 结构和每个文件的用途。
   *
   * @param agentId Agent ID
   * @returns XML 包裹的文件内容块，或 undefined
   */
  readInjectableFiles(agentId: string): string | undefined {
    const homeDir = path.join(this.homesDir, agentId);
    if (!fs.existsSync(homeDir)) return undefined;

    const sections: string[] = [];

    for (const file of INJECTABLE_FILES) {
      const filePath = path.join(homeDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8').trim();
        if (!content) continue;
        if (isTemplateOnly(content)) {
          const purpose = FILE_PURPOSES[file] || '待填写';
          sections.push(`### ${file} (${filePath})\n\n_[${purpose} — 尚未填写，请在对话中完善]_`);
        } else {
          sections.push(`### ${file} (${filePath})\n\n${content}`);
        }
      } catch {
        // 文件不存在或无法读取
      }
    }

    if (sections.length === 0) return undefined;

    let merged = sections.join('\n\n---\n\n');
    const maxLen = 10000;
    if (merged.length > maxLen) {
      merged = merged.slice(0, maxLen) + '\n\n... (truncated)';
    }

    return `<agent_home agentId="${agentId}" path="${homeDir}">
These are YOUR persistent identity and memory files. They survive across sessions.
You can update them using the \`write\` tool at the paths shown above each section.
Files marked as "尚未填写" need your attention — fill them in to build your persistent persona.

${merged}
</agent_home>`;
  }

  /**
   * 读取 Agent 级 AGENTS.md
   */
  readAgentsMd(agentId: string): string | undefined {
    const filePath = path.join(this.homesDir, agentId, 'AGENTS.md');
    try {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      if (content && !isTemplateOnly(content)) return content;
    } catch {
      // 文件不存在
    }
    return undefined;
  }

  /**
   * 读取 Agent 的 sessions.jsonl 索引
   *
   * @param agentId Agent ID
   * @returns Session 索引列表（id + createdAt），按创建时间顺序
   */
  readSessionIndex(agentId: string): Array<{ id: string; createdAt: string }> {
    const indexPath = path.join(this.homesDir, agentId, 'sessions.jsonl');

    if (!fs.existsSync(indexPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(indexPath, 'utf-8');
      const lines = content
        .trim()
        .split('\n')
        .filter((line) => line.trim());

      return lines
        .map((line) => {
          try {
            return JSON.parse(line) as { id: string; createdAt: string };
          } catch {
            log.warn(`[AgentHomeManager] Invalid JSON line in ${agentId}/sessions.jsonl: ${line}`);
            return null;
          }
        })
        .filter((entry): entry is { id: string; createdAt: string } => entry !== null);
    } catch (err) {
      log.warn(`[AgentHomeManager] Failed to read session index for ${agentId}:`, err);
      return [];
    }
  }
}

/**
 * 判断文件内容是否仅包含模板注释（无实质内容）
 */
function isTemplateOnly(content: string): boolean {
  const stripped = content
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('<!--') && !trimmed.endsWith('-->');
    })
    .join('')
    .trim();
  return stripped.length === 0;
}
