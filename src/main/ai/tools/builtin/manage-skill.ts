/**
 * manage_skill — 技能管理工具
 *
 * 让 LLM 管理 Skill 的 CRUD 操作。
 * 工具本身只做文件操作，"智能生成 SKILL.md 内容"由 LLM + skill-creator Skill 完成。
 *
 * 支持操作：
 *   - list    — 列出所有技能（name + description + source）
 *   - create  — 创建新技能（LLM 提供完整 SKILL.md 内容，工具写入文件）
 *   - import  — 从指定路径复制到 userSkillsDir
 *   - get     — 读取某个技能的完整 SKILL.md 内容
 *   - delete  — 删除用户技能（内置技能禁止删除）
 *
 * 分类：Configuration | 风险：中（写操作改变系统行为）
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ToolDefinition, ToolStreamUpdate, ToolResult } from '../types';
import { ToolCategory } from '../types';
import { SkillManager } from '../../skills';

// ==================== 参数 Schema ====================

const paramsSchema = z.object({
  action: z.enum(['list', 'create', 'import', 'get', 'delete']).describe('Operation to perform on skills'),

  /** 技能目录名（kebab-case），create / get / delete 需要 */
  skillName: z
    .string()
    .optional()
    .describe(
      'Skill directory name (kebab-case). Required for create/get/delete. ' +
        'Example: "docker-deploy", "api-testing-guide"'
    ),

  /** create 时的完整 SKILL.md 文件内容（含 frontmatter） */
  content: z
    .string()
    .optional()
    .describe(
      'Full SKILL.md file content including YAML frontmatter (---\\nname: ...\\ndescription: ...\\n---). ' +
        'Required for create action. Follow skill-creator Skill for proper format.'
    ),

  /** import 时的源路径 */
  sourcePath: z
    .string()
    .optional()
    .describe('Local path to import from. Can be a directory containing SKILL.md or a SKILL.md file itself.')
});

// ==================== 辅助：获取 Env ====================

async function getEnvPaths(): Promise<{
  builtinSkillsDir: string;
  userSkillsDir: string;
  configDir: string;
}> {
  const { Env } = await import('@main/common/env');
  return {
    builtinSkillsDir: Env.paths.builtinSkillsDir,
    userSkillsDir: Env.paths.userSkillsDir,
    configDir: Env.paths.configDir
  };
}

async function getSearchPaths(): Promise<string[]> {
  const { Env } = await import('@main/common/env');
  return Env.getSkillSearchPaths();
}

// ==================== 工具定义 ====================

export const manageSkillTool: ToolDefinition = {
  name: 'manage_skill',
  description:
    'Manage Skills — list, create, import, get, or delete Skills. ' +
    'Skills are specialized knowledge/instructions (SKILL.md files) that enhance Agent capabilities. ' +
    'Use "list" to see all skills, "create" to write a new SKILL.md (provide full content with frontmatter), ' +
    '"import" to copy a skill from a local path, "get" to read full SKILL.md content, ' +
    '"delete" to remove a user-created skill (built-in skills cannot be deleted). ' +
    'When creating skills, read the skill-creator Skill first for proper SKILL.md format.',
  category: ToolCategory.Configuration,
  needUserConfirm: false,
  parameters: paramsSchema,

  execute: async function* (params: Record<string, unknown>): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
    const action = params.action as string;

    try {
      switch (action) {
        case 'list':
          return yield* handleList();
        case 'create':
          return yield* handleCreate(params);
        case 'import':
          return yield* handleImport(params);
        case 'get':
          return yield* handleGet(params);
        case 'delete':
          return yield* handleDelete(params);
        default:
          return {
            success: false,
            error: { code: 'INVALID_ACTION', message: `Unknown action: ${action}` }
          };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: { code: 'SKILL_ERROR', message: msg } };
    }
  }
};

// ==================== 操作处理 ====================

// eslint-disable-next-line require-yield
async function* handleList(): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
  const envPaths = await getEnvPaths();
  const searchPaths = await getSearchPaths();
  const manager = new SkillManager();
  const allSkills = manager.scanSkills(searchPaths, envPaths.configDir);

  if (allSkills.length === 0) {
    return {
      success: true,
      llmContent: 'No skills available. Use action="create" to create one.',
      userContent: '暂无可用技能'
    };
  }

  const lines = allSkills.map((s) => {
    const source = s.filePath && s.filePath.startsWith(envPaths.userSkillsDir) ? 'user' : 'builtin';
    return `- **${s.name}** [${source}] — ${s.description || '(no description)'}`;
  });

  return {
    success: true,
    llmContent: `Available skills (${allSkills.length}):\n\n${lines.join('\n')}`,
    userContent: `可用技能 (${allSkills.length}):\n\n${lines.join('\n')}`
  };
}

async function* handleCreate(params: Record<string, unknown>): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
  const skillName = params.skillName as string | undefined;
  const content = params.content as string | undefined;

  if (!skillName) {
    return {
      success: false,
      error: { code: 'MISSING_PARAM', message: 'skillName is required for create' }
    };
  }
  if (!content) {
    return {
      success: false,
      error: { code: 'MISSING_PARAM', message: 'content (full SKILL.md) is required for create' }
    };
  }

  yield { type: 'progress', content: `Creating skill "${skillName}"...` };

  const envPaths = await getEnvPaths();
  const skillDir = path.join(envPaths.userSkillsDir, skillName);

  // 确保用户技能目录存在
  if (!fs.existsSync(envPaths.userSkillsDir)) {
    fs.mkdirSync(envPaths.userSkillsDir, { recursive: true });
  }

  // 创建技能目录
  if (!fs.existsSync(skillDir)) {
    fs.mkdirSync(skillDir, { recursive: true });
  }

  // 写入 SKILL.md
  const filePath = path.join(skillDir, 'SKILL.md');
  fs.writeFileSync(filePath, content, 'utf-8');

  // 清除缓存
  SkillManager.invalidateCache();

  return {
    success: true,
    llmContent: `Skill "${skillName}" created successfully at ${filePath}`,
    userContent: `已创建技能: **${skillName}**\n路径: \`${skillDir}/SKILL.md\``
  };
}

async function* handleImport(params: Record<string, unknown>): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
  const sourcePath = params.sourcePath as string | undefined;

  if (!sourcePath) {
    return {
      success: false,
      error: { code: 'MISSING_PARAM', message: 'sourcePath is required for import' }
    };
  }

  if (!fs.existsSync(sourcePath)) {
    return {
      success: false,
      error: { code: 'NOT_FOUND', message: `Path does not exist: ${sourcePath}` }
    };
  }

  yield { type: 'progress', content: `Importing skill from "${sourcePath}"...` };

  const envPaths = await getEnvPaths();

  // 确保用户技能目录存在
  if (!fs.existsSync(envPaths.userSkillsDir)) {
    fs.mkdirSync(envPaths.userSkillsDir, { recursive: true });
  }

  const stat = fs.statSync(sourcePath);

  if (stat.isDirectory()) {
    const skillMdPath = path.join(sourcePath, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) {
      return {
        success: false,
        error: { code: 'INVALID_SKILL', message: 'Directory does not contain SKILL.md' }
      };
    }

    const dirName = path.basename(sourcePath);
    const targetDir = path.join(envPaths.userSkillsDir, dirName);
    copyDirSync(sourcePath, targetDir);

    SkillManager.invalidateCache();

    return {
      success: true,
      llmContent: `Skill imported from directory: ${sourcePath} → ${targetDir}`,
      userContent: `已导入技能目录: **${dirName}**`
    };
  } else if (stat.isFile() && path.basename(sourcePath) === 'SKILL.md') {
    const dirName = path.basename(path.dirname(sourcePath));
    const targetDir = path.join(envPaths.userSkillsDir, dirName);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    fs.copyFileSync(sourcePath, path.join(targetDir, 'SKILL.md'));

    SkillManager.invalidateCache();

    return {
      success: true,
      llmContent: `Skill imported from file: ${sourcePath} → ${targetDir}/SKILL.md`,
      userContent: `已导入技能: **${dirName}**`
    };
  }

  return {
    success: false,
    error: {
      code: 'INVALID_PATH',
      message: 'Provide a directory containing SKILL.md or a SKILL.md file path'
    }
  };
}

// eslint-disable-next-line require-yield
async function* handleGet(params: Record<string, unknown>): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
  const skillName = params.skillName as string | undefined;

  if (!skillName) {
    return {
      success: false,
      error: { code: 'MISSING_PARAM', message: 'skillName is required for get' }
    };
  }

  const envPaths = await getEnvPaths();
  const searchPaths = await getSearchPaths();
  const manager = new SkillManager();
  const allSkills = manager.scanSkills(searchPaths, envPaths.configDir);

  const skill = allSkills.find((s) => s.name === skillName);

  if (!skill || !skill.filePath) {
    return {
      success: false,
      error: { code: 'NOT_FOUND', message: `Skill "${skillName}" not found` }
    };
  }

  const content = fs.readFileSync(skill.filePath, 'utf-8');

  return {
    success: true,
    llmContent: `SKILL.md content for "${skillName}" (${skill.filePath}):\n\n${content}`,
    userContent: `技能 **${skillName}** 的 SKILL.md 内容:\n\n\`\`\`markdown\n${content}\n\`\`\``
  };
}

// eslint-disable-next-line require-yield
async function* handleDelete(params: Record<string, unknown>): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
  const skillName = params.skillName as string | undefined;

  if (!skillName) {
    return {
      success: false,
      error: { code: 'MISSING_PARAM', message: 'skillName is required for delete' }
    };
  }

  const envPaths = await getEnvPaths();
  const searchPaths = await getSearchPaths();
  const manager = new SkillManager();
  const allSkills = manager.scanSkills(searchPaths, envPaths.configDir);

  const skill = allSkills.find((s) => s.name === skillName);

  if (!skill || !skill.filePath) {
    return {
      success: false,
      error: { code: 'NOT_FOUND', message: `Skill "${skillName}" not found` }
    };
  }

  // 只允许删除用户技能
  if (!skill.filePath.startsWith(envPaths.userSkillsDir)) {
    return {
      success: false,
      error: { code: 'FORBIDDEN', message: 'Built-in skills cannot be deleted' }
    };
  }

  const skillDir = path.dirname(skill.filePath);
  fs.rmSync(skillDir, { recursive: true, force: true });

  SkillManager.invalidateCache();

  return {
    success: true,
    llmContent: `Skill "${skillName}" deleted successfully.`,
    userContent: `已删除技能: **${skillName}**`
  };
}

// ==================== 辅助函数 ====================

/** 递归复制目录 */
function copyDirSync(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
