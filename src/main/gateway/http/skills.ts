/**
 * Skills HTTP 路由
 *
 * 为技能管理提供 HTTP 端点。
 *
 * 端点：
 *   GET    /gateway/skills           — 列出所有可用技能（name + description + source）
 *   POST   /gateway/skills/import    — 导入技能（从本地路径复制到 userSkillsDir）
 *   POST   /gateway/skills/ai-create — AI 驱动创建技能（SSE 流式进度）
 *   DELETE /gateway/skills/:name     — 删除用户技能
 *
 * 技能来源（按优先级从低到高）：
 *   1. builtinSkillsDir — 内置技能
 *   2. userSkillsDir — 用户技能
 *
 * 扫描逻辑复用 SkillManager，但不依赖 Agent 会话上下文。
 */

import fs from 'fs';
import path from 'path';
import type Router from '@koa/router';
import { createLogger } from '@main/common/logger';
import { Env } from '@main/common/env';
import { SkillManager } from '@main/ai/skills';
import { aiCreateSkill } from '@main/ai/services/SkillCreatorService';

const log = createLogger('gateway-http-skills');

/** 技能摘要（返回给前端的精简信息） */
interface SkillSummary {
  name: string;
  description: string;
  source?: 'builtin' | 'user';
  filePath?: string;
}

export function registerSkillRoutes(router: Router): void {
  // ==================== LIST ====================

  router.get('/skills', async (ctx) => {
    try {
      const searchPaths = await Env.getSkillSearchPaths();

      const manager = new SkillManager();
      const allSkills = manager.scanSkills(searchPaths, Env.paths.secretsDir);

      const builtinDir = Env.paths.builtinSkillsDir;
      const userDir = Env.paths.userSkillsDir;

      const skills: SkillSummary[] = allSkills.map((s) => {
        let source: 'builtin' | 'user' = 'builtin';
        if (s.filePath && s.filePath.startsWith(userDir)) {
          source = 'user';
        } else if (s.filePath && !s.filePath.startsWith(builtinDir)) {
          source = 'user';
        }

        return {
          name: s.name,
          description: s.description,
          source,
          filePath: s.filePath
        };
      });

      ctx.body = { skills };
    } catch (err) {
      log.error('[skills.list] Error:', err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ==================== IMPORT ====================

  router.post('/skills/import', async (ctx) => {
    try {
      const body = ctx.request.body as { sourcePath?: string } | undefined;
      let sourcePath = body?.sourcePath;

      if (!sourcePath) {
        ctx.status = 400;
        ctx.body = { error: '缺少 sourcePath 参数' };
        return;
      }

      const userSkillsDir = Env.paths.userSkillsDir;

      // 确保用户技能目录存在
      if (!fs.existsSync(userSkillsDir)) {
        fs.mkdirSync(userSkillsDir, { recursive: true });
      }

      // 判断是网络路径还是本地路径
      const isUrl = /^https?:\/\//i.test(sourcePath);

      if (isUrl) {
        // ========== 网络路径导入 ==========
        log.info(`[skills.import] 从网络导入: ${sourcePath}`);

        try {
          const result = await importSkillFromUrl(sourcePath, userSkillsDir);
          SkillManager.invalidateCache();
          ctx.body = { success: true, ...result };
        } catch (err) {
          log.error('[skills.import] 网络导入失败:', err);
          ctx.status = 400;
          ctx.body = { error: err instanceof Error ? err.message : String(err) };
        }
      } else {
        // ========== 本地路径导入（支持任意路径） ==========

        // 如果不是绝对路径，从 workspacesDir 开始解析
        if (!path.isAbsolute(sourcePath)) {
          sourcePath = path.resolve(Env.paths.workspacesDir, sourcePath);
        } else {
          sourcePath = path.normalize(sourcePath);
        }

        log.info(`[skills.import] 从本地导入: ${sourcePath}`);

        // 验证源路径存在
        if (!fs.existsSync(sourcePath)) {
          ctx.status = 400;
          ctx.body = { error: `路径不存在: ${sourcePath}` };
          return;
        }

        // 验证是否是有效的 Skill（包含 SKILL.md）
        const stat = fs.statSync(sourcePath);
        let skillDir: string | null = null;

        if (stat.isDirectory()) {
          const skillMdPath = path.join(sourcePath, 'SKILL.md');
          if (!fs.existsSync(skillMdPath)) {
            ctx.status = 400;
            ctx.body = { error: '目录中未找到 SKILL.md 文件' };
            return;
          }
          skillDir = sourcePath;
        } else if (stat.isFile() && path.basename(sourcePath) === 'SKILL.md') {
          skillDir = path.dirname(sourcePath);
        } else {
          ctx.status = 400;
          ctx.body = { error: '请提供技能目录路径或 SKILL.md 文件路径' };
          return;
        }

        // 复制到用户技能目录
        const dirName = path.basename(skillDir);
        const targetDir = path.join(userSkillsDir, dirName);

        // 递归复制目录
        copyDirSync(skillDir, targetDir);

        // 清除缓存
        SkillManager.invalidateCache();

        log.info(`[skills.import] 导入成功: ${dirName} → ${targetDir}`);
        ctx.body = { success: true, skillDir: targetDir, skillName: dirName };
      }
    } catch (err) {
      log.error('[skills.import] Error:', err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ==================== AI CREATE (SSE) ====================

  router.post('/skills/ai-create', async (ctx) => {
    const body = ctx.request.body as { requirement?: string } | undefined;
    const requirement = body?.requirement?.trim();

    if (!requirement) {
      ctx.status = 400;
      ctx.body = { error: '缺少 requirement 参数' };
      return;
    }

    // 设置 SSE 响应头
    ctx.set('Content-Type', 'text/event-stream');
    ctx.set('Cache-Control', 'no-cache');
    ctx.set('Connection', 'keep-alive');
    ctx.status = 200;

    const stream = ctx.res;
    stream.flushHeaders?.();

    const sendEvent = (event: string, data: unknown): void => {
      stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const userSkillsDir = Env.paths.userSkillsDir;

      // 确保用户技能目录存在
      if (!fs.existsSync(userSkillsDir)) {
        fs.mkdirSync(userSkillsDir, { recursive: true });
      }

      const result = await aiCreateSkill(requirement, userSkillsDir, (progress) => {
        sendEvent('progress', progress);
      });

      sendEvent('result', result);
    } catch (err) {
      log.error('[skills.ai-create] Error:', err);
      sendEvent('error', {
        error: err instanceof Error ? err.message : String(err)
      });
    } finally {
      stream.end();
    }

    // 阻止 Koa 再次写入 body
    ctx.respond = false;
  });

  // ==================== DELETE ====================

  router.delete('/skills/:name', async (ctx) => {
    try {
      const skillName = ctx.params.name;

      if (!skillName) {
        ctx.status = 400;
        ctx.body = { error: '缺少技能名称' };
        return;
      }

      const userSkillsDir = Env.paths.userSkillsDir;

      // 先扫描获取完整信息
      const searchPaths = await Env.getSkillSearchPaths();
      const manager = new SkillManager();
      const allSkills = manager.scanSkills(searchPaths, Env.paths.secretsDir);

      const skill = allSkills.find((s) => s.name === skillName);

      if (!skill || !skill.filePath) {
        ctx.status = 404;
        ctx.body = { error: `技能 "${skillName}" 不存在` };
        return;
      }

      // 检查是否在用户目录下（只允许删除用户技能）
      if (!skill.filePath.startsWith(userSkillsDir)) {
        ctx.status = 403;
        ctx.body = { error: '内置技能不可删除' };
        return;
      }

      // 删除技能目录
      const skillDir = path.dirname(skill.filePath);
      fs.rmSync(skillDir, { recursive: true, force: true });

      // 清除缓存
      SkillManager.invalidateCache();

      log.info(`[skills.delete] 已删除技能: ${skillName} (${skillDir})`);

      ctx.body = { success: true, name: skillName };
    } catch (err) {
      log.error('[skills.delete] Error:', err);
      ctx.status = 500;
      ctx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  log.info('[skills] HTTP routes registered');
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

/**
 * 从网络 URL 导入 Skill
 *
 * 支持的格式：
 * 1. 直接链接到 SKILL.md: https://example.com/path/to/SKILL.md
 * 2. GitHub raw URL: https://raw.githubusercontent.com/user/repo/main/skill-name/SKILL.md
 * 3. GitHub 目录 URL: https://github.com/user/repo/tree/main/skill-name
 *
 * @param url 网络路径
 * @param targetBaseDir 目标目录（userSkillsDir）
 * @returns 导入结果
 */
async function importSkillFromUrl(
  url: string,
  targetBaseDir: string
): Promise<{ skillDir: string; skillName: string }> {
  log.info(`[importSkillFromUrl] 开始下载: ${url}`);

  // 检测 URL 类型
  let skillMdUrl = url;
  let skillName = 'downloaded-skill';

  // GitHub 目录 URL 转换为 raw URL
  if (url.includes('github.com') && url.includes('/tree/')) {
    // https://github.com/user/repo/tree/main/skill-name
    // → https://raw.githubusercontent.com/user/repo/main/skill-name/SKILL.md
    const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)/);
    if (match) {
      const [, owner, repo, branch, skillPath] = match;
      skillName = path.basename(skillPath);
      skillMdUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${skillPath}/SKILL.md`;
      log.info(`[importSkillFromUrl] 转换 GitHub URL: ${skillMdUrl}`);
    }
  } else if (url.endsWith('SKILL.md')) {
    // 直接的 SKILL.md URL
    const pathParts = new URL(url).pathname.split('/');
    const skillDirName = pathParts[pathParts.length - 2];
    if (skillDirName) {
      skillName = skillDirName;
    }
  }

  // 下载 SKILL.md 文件
  const response = await fetch(skillMdUrl);
  if (!response.ok) {
    throw new Error(`下载失败: HTTP ${response.status} ${response.statusText}`);
  }

  const content = await response.text();

  // 验证是否是有效的 SKILL.md（至少有 frontmatter 或者内容）
  if (!content.trim()) {
    throw new Error('下载的文件为空');
  }

  // 创建目标目录
  const targetDir = path.join(targetBaseDir, skillName);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // 写入 SKILL.md
  const targetPath = path.join(targetDir, 'SKILL.md');
  fs.writeFileSync(targetPath, content, 'utf-8');

  log.info(`[importSkillFromUrl] 下载成功: ${skillName} → ${targetDir}`);

  // 尝试下载 references 目录（如果 URL 是 GitHub 目录）
  if (url.includes('github.com') && url.includes('/tree/')) {
    try {
      await downloadGitHubSkillReferences(url, targetDir);
    } catch (err) {
      log.warn(`[importSkillFromUrl] 下载 references 失败（跳过）:`, err);
    }
  }

  return { skillDir: targetDir, skillName };
}

/**
 * 下载 GitHub Skill 的 references 目录（如果存在）
 *
 * 使用 GitHub API 列出目录内容并逐个下载。
 */
async function downloadGitHubSkillReferences(githubUrl: string, targetDir: string): Promise<void> {
  // 提取 owner/repo/branch/path
  const match = githubUrl.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)/);
  if (!match) return;

  const [, owner, repo, branch, skillPath] = match;
  const referencesPath = `${skillPath}/references`;

  // GitHub API: https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref={branch}
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${referencesPath}?ref=${branch}`;

  log.debug(`[downloadGitHubSkillReferences] 检查 references 目录: ${apiUrl}`);

  const response = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'Coobee-AI-Skill-Importer',
      Accept: 'application/vnd.github.v3+json'
    }
  });

  if (!response.ok) {
    // references 目录不存在（常见情况，不报错）
    if (response.status === 404) {
      log.debug(`[downloadGitHubSkillReferences] references 目录不存在，跳过`);
      return;
    }
    throw new Error(`GitHub API 请求失败: HTTP ${response.status}`);
  }

  const files = (await response.json()) as Array<{
    name: string;
    type: 'file' | 'dir';
    download_url?: string;
  }>;

  // 创建 references 目录
  const referencesDir = path.join(targetDir, 'references');
  if (!fs.existsSync(referencesDir)) {
    fs.mkdirSync(referencesDir, { recursive: true });
  }

  // 下载所有文件（不递归子目录）
  for (const file of files) {
    if (file.type === 'file' && file.download_url) {
      try {
        const fileResponse = await fetch(file.download_url);
        if (fileResponse.ok) {
          const fileContent = await fileResponse.text();
          const targetPath = path.join(referencesDir, file.name);
          fs.writeFileSync(targetPath, fileContent, 'utf-8');
          log.debug(`[downloadGitHubSkillReferences] 下载文件: ${file.name}`);
        }
      } catch (err) {
        log.warn(`[downloadGitHubSkillReferences] 下载文件失败: ${file.name}`, err);
      }
    }
  }

  log.info(`[downloadGitHubSkillReferences] references 目录下载完成`);
}
