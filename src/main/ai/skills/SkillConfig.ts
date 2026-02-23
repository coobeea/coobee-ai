/**
 * Skill 配置管理
 *
 * 从独立的 skills.json5 文件加载各 Skill 的专属配置（API Key、参数等）。
 * 集中管理，避免在每个 Skill 目录中散落配置文件。
 *
 * skills.json5 格式：
 * {
 *   "paddle-ocr": {
 *     apiKey: "sk-xxx",
 *     baseUrl: "https://api.example.com",
 *   },
 *   "github-search": {
 *     token: "ghp_xxx",
 *   },
 * }
 *
 * Skill 在 SKILL.md 的 frontmatter 中通过 `config` 字段描述所需配置：
 * ---
 * name: paddle-ocr
 * config:
 *   - key: apiKey
 *     description: PaddleOCR API Key
 *     required: true
 *   - key: baseUrl
 *     description: API 地址
 *     required: false
 *     default: https://api.example.com
 * ---
 */
import fs from 'fs';
import JSON5 from 'json5';
import path from 'path';

import { log } from '@main/common/logger';

/** Skill 配置文件名 */
const SKILL_CONFIG_FILE_NAME = 'skills.json5';

/** 单个 Skill 的配置（自由结构） */
export type SkillConfigMap = Record<string, Record<string, unknown>>;

/**
 * 加载 skills.json5
 *
 * @param secretsDir 敏感信息目录路径（新架构使用独立的 secrets/ 目录）
 * @returns skill name → config 的映射，文件不存在或格式错误时返回空对象
 */
export function loadSkillConfigs(secretsDir: string): SkillConfigMap {
  const filePath = skillConfigPath(secretsDir);

  if (!fs.existsSync(filePath)) return {};

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON5.parse(raw);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }

    // 只保留 object 类型的值（每个 Skill 的配置应该是一个对象）
    const result: SkillConfigMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        result[key] = value as Record<string, unknown>;
      }
    }
    return result;
  } catch (err) {
    log.warn('[SkillConfig] 解析 skills.json5 失败:', err);
    return {};
  }
}

/**
 * 获取指定 Skill 的配置
 */
export function getSkillConfig(secretsDir: string, skillName: string): Record<string, unknown> | undefined {
  const configs = loadSkillConfigs(secretsDir);
  return configs[skillName];
}

/** skills.json5 文件路径 */
export function skillConfigPath(secretsDir: string): string {
  return path.join(secretsDir, SKILL_CONFIG_FILE_NAME);
}

/** 确保 skills.json5 存在，不存在则创建模板 */
export function ensureSkillConfigFile(secretsDir: string): void {
  const filePath = skillConfigPath(secretsDir);
  if (fs.existsSync(filePath)) {
    // 修正已存在文件的权限为 600
    fs.chmodSync(filePath, 0o600);
    return;
  }

  // 创建 secrets 目录（700 权限）
  if (!fs.existsSync(secretsDir)) {
    fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
  }

  const template = `// Coobee AI — Skill 配置
// 为需要外部资源的 Skill 提供配置（API Key、参数等），保存后自动生效
// 格式：Skill名称: { 配置项 }
// 具体需要哪些配置项，请查看对应 Skill 的 SKILL.md 中的 config 描述
{
  // 示例：
  // "paddle-ocr": {
  //   apiKey: "your-api-key",
  //   baseUrl: "https://api.example.com",
  // },
  // "github-search": {
  //   token: "ghp_xxx",
  // },
}
`;
  fs.writeFileSync(filePath, template, { mode: 0o600, encoding: 'utf-8' });

  // 确保父目录也是 700 权限
  fs.chmodSync(secretsDir, 0o700);
}
