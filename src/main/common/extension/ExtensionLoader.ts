/**
 * Extension 加载器
 *
 * 职责：
 *   - 扫描多级目录，发现并加载所有 Extension
 *   - 使用 jiti 运行时编译 .ts / .js 模块
 *   - fs.watch 监听目录变化，实现热插拔（300ms 防抖）
 */

import fs from 'node:fs';
import path from 'node:path';
import { createJiti } from 'jiti';
import type { Jiti } from 'jiti';
import { app } from 'electron';
import { createLogger } from '@main/common/logger';
import { ExtensionRegistry } from './ExtensionRegistry';
import { createExtensionApi, createEventBusWrapper } from './ExtensionApi';
import type { ExtensionManifest, ExtensionModule, ExtensionOrigin } from './types';

const log = createLogger('extension');

/** 防抖延迟（ms） */
const DEBOUNCE_MS = 300;

export class ExtensionLoader {
  /** extensionId → 已加载的 Extension 目录路径 */
  private loadedExtensions = new Map<string, string>();
  /** extensionId → Extension 模块实例（用于调用 unregister） */
  private loadedModules = new Map<string, ExtensionModule>();
  /** threadId → 该任务加载的 workspace Extension ID 列表 */
  private workspaceExtensions = new Map<string, string[]>();
  /** fs.watch 返回的 watcher 列表 */
  private watchers: fs.FSWatcher[] = [];
  /** 防抖定时器 */
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  /** searchPath → origin 映射（loadAll 时记录） */
  private pathOrigins = new Map<string, ExtensionOrigin>();
  /** 共享的 EventBus 引用（传递给 Extension，避免它们自己导入） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private eventBusRef?: any;
  /** jiti 实例（延迟初始化） */
  private jitiInstance?: Jiti;

  constructor(
    private registry: ExtensionRegistry,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    eventBusRef?: any
  ) {
    this.eventBusRef = eventBusRef;
  }

  /**
   * 获取 jiti 实例（延迟初始化，避免在模块加载时访问 app）
   */
  private getJiti(): Jiti {
    if (!this.jitiInstance) {
      const appPath = app.getAppPath();
      this.jitiInstance = createJiti(import.meta.url, {
        alias: {
          '@main': path.join(appPath, 'src/main'),
          '@shared': path.join(appPath, 'src/shared')
        }
      });
    }
    return this.jitiInstance;
  }

  /**
   * 扫描多级目录，加载所有 Extension
   * 搜索路径优先级从低到高，同 ID 高优先级覆盖低优先级
   */
  async loadAll(searchPaths: string[]): Promise<void> {
    const origins: ExtensionOrigin[] = ['builtin', 'user', 'workspace'];

    for (let i = 0; i < searchPaths.length; i++) {
      const searchPath = searchPaths[i];
      const origin = origins[i] ?? 'workspace';
      this.pathOrigins.set(searchPath, origin);

      if (!fs.existsSync(searchPath)) continue;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(searchPath, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const extDir = path.join(searchPath, entry.name);
        await this.load(extDir, origin);
      }
    }
  }

  /**
   * 加载单个 Extension
   */
  async load(dir: string, origin: ExtensionOrigin): Promise<void> {
    const manifestPath = path.join(dir, 'extension.json');

    // 读取清单
    if (!fs.existsSync(manifestPath)) {
      log.warn(`[ExtensionLoader] Skipping "${dir}": no extension.json`);
      return;
    }

    let manifest: ExtensionManifest;
    try {
      const raw = fs.readFileSync(manifestPath, 'utf-8');
      manifest = JSON.parse(raw) as ExtensionManifest;
    } catch (err) {
      log.error(`[ExtensionLoader] Failed to parse extension.json in "${dir}":`, err);
      return;
    }

    // Manifest 校验
    const validationError = validateManifest(manifest);
    if (validationError) {
      log.error(`[ExtensionLoader] Invalid manifest in "${dir}": ${validationError}`);
      return;
    }

    // enabled 字段检查：明确设为 false 时跳过
    if (manifest.enabled === false) {
      log.info(`[ExtensionLoader] Skipping disabled extension: ${manifest.id}`);
      return;
    }

    // 信任模型校验：非 builtin Extension 需要通过安全检查
    if (origin !== 'builtin') {
      const trustResult = verifyExtensionTrust(manifest, dir, origin);
      if (!trustResult.allowed) {
        log.warn(`[ExtensionLoader] Blocked untrusted extension "${manifest.id}" (${origin}): ${trustResult.reason}`);
        return;
      }
      if (trustResult.warning) {
        log.warn(
          `[ExtensionLoader] Loading non-builtin extension "${manifest.id}" (${origin}). ${trustResult.warning}`
        );
      }
    }

    // 同 ID 覆盖：先卸载旧版（热重载场景）
    if (this.loadedExtensions.has(manifest.id)) {
      await this.unload(manifest.id);
    }

    // Skill 目录路径安全检查：确保 manifest.skills 不会穿越到扩展目录之外
    // 注册扩展贡献的 Skill 目录（声明式，无需代码入口）
    if (manifest.skills) {
      const skillDir = path.resolve(dir, manifest.skills);
      // 路径穿越检查
      const rel = path.relative(dir, skillDir);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        log.error(
          `[ExtensionLoader] Blocked "${manifest.id}": skills path "${manifest.skills}" escapes extension directory`
        );
        return;
      }
      if (fs.existsSync(skillDir) && fs.statSync(skillDir).isDirectory()) {
        this.registry.registerSkillDir(manifest.id, skillDir);
        log.info(`[ExtensionLoader] Registered skill dir for "${manifest.id}": ${skillDir}`);
      } else {
        log.warn(`[ExtensionLoader] Skill dir declared but not found for "${manifest.id}": ${skillDir}`);
      }
    }

    // 注册自动注入的 Skill（这些 Skill 会自动加入所有 Agent）
    if (manifest.autoInjectSkills && manifest.autoInjectSkills.length > 0) {
      this.registry.registerAutoInjectSkills(manifest.id, manifest.autoInjectSkills);
      log.info(
        `[ExtensionLoader] Registered auto-inject skills for "${manifest.id}": ${manifest.autoInjectSkills.join(', ')}`
      );
    }

    // 注册运行时指令注入（每次 Agent 运行时追加）
    if (manifest.injectInstructions) {
      this.registry.registerInjectInstructions(manifest.id, manifest.injectInstructions);
      log.info(`[ExtensionLoader] Registered inject instructions for "${manifest.id}"`);
    }

    // 查找入口文件（纯 Skill 扩展可以没有代码入口）
    const entryPath = resolveEntryPath(dir);
    if (entryPath) {
      // jiti 加载模块
      let mod: ExtensionModule;
      try {
        const jiti = this.getJiti();
        const imported = await jiti.import(entryPath);
        mod = ((imported as Record<string, unknown>).default || imported) as ExtensionModule;
      } catch (err) {
        log.error(
          `[ExtensionLoader] Failed to load "${manifest.id}" from "${entryPath}": ${err instanceof Error ? err.message : String(err)}`,
          err
        );
        return;
      }

      // 调用 register（支持异步）
      const eventBusApi = this.eventBusRef ? createEventBusWrapper(this.eventBusRef) : undefined;
      const api = createExtensionApi(manifest.id, manifest.name, origin, this.registry, eventBusApi);
      try {
        log.info(`[ExtensionLoader] Calling register() for "${manifest.id}"...`);
        await mod.register(api);
        log.info(`[ExtensionLoader] register() completed for "${manifest.id}"`);
        // 保存模块实例，用于后续调用 unregister
        this.loadedModules.set(manifest.id, mod);
      } catch (err) {
        log.error(`[ExtensionLoader] register() failed for "${manifest.id}":`, err);
        // 注册失败，清理已注册的内容
        this.registry.unregisterAll(manifest.id);
        return;
      }
    } else if (!manifest.skills) {
      // 既没有代码入口，也没有 Skill 声明 → 无效扩展
      log.warn(`[ExtensionLoader] No entry file or skills declaration in "${dir}", skipping`);
      return;
    }

    this.loadedExtensions.set(manifest.id, dir);

    // 将该 Extension 新注册的工具同步到 ToolRegistry（热重载场景）
    const extTools = this.registry.getTools().filter((t) => t.extensionId === manifest.id);
    if (extTools.length > 0) {
      try {
        const { ToolRegistry } = await import('../../ai/tools/registry');
        for (const { tool } of extTools) {
          try {
            ToolRegistry.getInstance().register(tool);
          } catch {
            // 工具已存在时跳过（首次加载由 ReadyExtensionHook 注册）
          }
        }
      } catch {
        // ToolRegistry 不可用时静默
      }
    }

    // 将该 Extension 注册的 CronJob 同步到 CronScheduler
    const extCronJobs = this.registry.getCronJobs().filter((j) => j.extensionId === manifest.id);
    if (extCronJobs.length > 0) {
      try {
        const { getCronScheduler, getCronJobStore } = await import('../../ai/cron');
        const cronScheduler = getCronScheduler();
        const cronStore = getCronJobStore();

        for (const { config } of extCronJobs) {
          const jobId = `ext:${manifest.id}:${config.name}`;
          const now = new Date().toISOString();
          const definition = {
            id: jobId,
            name: config.name,
            description: config.description,
            cronExpression: config.cronExpression,
            status: (config.enabled !== false ? 'active' : 'paused') as 'active' | 'paused',
            agentId: config.agentId,
            task: config.task,
            createdAt: now,
            updatedAt: now,
            runCount: 0,
            failCount: 0,
            source: 'external' as const,
            metadata: { extensionId: manifest.id }
          };

          const existing = await cronStore.get(jobId);
          if (existing) {
            definition.runCount = existing.runCount;
            definition.failCount = existing.failCount;
            if (existing.lastRunAt) (definition as Record<string, unknown>).lastRunAt = existing.lastRunAt;
          } else {
            await cronStore.save(definition);
          }

          if (definition.status === 'active') {
            await cronScheduler.scheduleJob(definition);
          }
        }
        log.info(`[ExtensionLoader] Synced ${extCronJobs.length} CronJob(s) for "${manifest.id}"`);
      } catch {
        // CronScheduler 未初始化时静默（应用启动早期阶段）
      }
    }

    log.info(`[ExtensionLoader] Loaded "${manifest.id}" (${origin}) from ${dir}`);
  }

  /**
   * 卸载单个 Extension
   *
   * 同时从 ExtensionRegistry 和 ToolRegistry 清理该 Extension 注册的资源。
   */
  async unload(extensionId: string): Promise<void> {
    // 1. 调用 Extension 的 unregister 回调（让 Extension 清理自己的资源）
    const mod = this.loadedModules.get(extensionId);
    if (mod?.unregister) {
      try {
        await mod.unregister();
        log.info(`[ExtensionLoader] Called unregister() for "${extensionId}"`);
      } catch (err) {
        log.error(`[ExtensionLoader] unregister() failed for "${extensionId}":`, err);
      }
    }

    // 2. 获取该 Extension 注册的工具名，用于同步清理 ToolRegistry
    const removedTools = this.registry.unregisterToolsByExtension(extensionId);

    // 3. 停止运行中的服务和通道
    const servicesToStop = this.registry.getServices().filter((s) => s.extensionId === extensionId);
    for (const { service } of servicesToStop) {
      try {
        await service.stop();
        log.info(`[ExtensionLoader] Stopped background service: ${service.id}`);
      } catch (err) {
        log.error(`[ExtensionLoader] Failed to stop background service "${service.id}":`, err);
      }
    }

    const channelsToStop = this.registry.getChannels().filter((c) => c.extensionId === extensionId);
    if (channelsToStop.length > 0) {
      try {
        const { ChannelManager } = await import('../../channels/ChannelManager');
        const channelManager = ChannelManager.getInstance();
        for (const { channel } of channelsToStop) {
          await channelManager.unregisterChannel(channel.id);
          log.info(`[ExtensionLoader] Unregistered channel: ${channel.id}`);
        }
      } catch (err) {
        log.error(`[ExtensionLoader] Failed to unregister channels:`, err);
      }
    }

    // 4. 从 CronScheduler 取消该 Extension 注册的定时任务
    const extCronJobs = this.registry.getCronJobs().filter((j) => j.extensionId === extensionId);
    if (extCronJobs.length > 0) {
      try {
        const { getCronScheduler, getCronJobStore } = await import('../../ai/cron');
        const cronScheduler = getCronScheduler();
        const cronStore = getCronJobStore();

        for (const { config } of extCronJobs) {
          const jobId = `ext:${extensionId}:${config.name}`;
          await cronScheduler.unscheduleJob(jobId);
          await cronStore.delete(jobId);
        }
        log.info(`[ExtensionLoader] Removed ${extCronJobs.length} CronJob(s) for "${extensionId}"`);
      } catch {
        // CronScheduler 未初始化时静默
      }
    }

    // 5. 清理 ExtensionRegistry 所有关联的注册信息
    this.registry.unregisterHooksByExtension(extensionId);
    this.registry.unregisterGatewayMethodsByExtension(extensionId);
    this.registry.unregisterSkillDirsByExtension(extensionId);
    this.registry.unregisterAutoInjectSkillsByExtension(extensionId);
    this.registry.unregisterInjectInstructionsByExtension(extensionId);
    this.registry.unregisterChannelsByExtension(extensionId);
    this.registry.unregisterHttpRoutesByExtension(extensionId);
    this.registry.unregisterServicesByExtension(extensionId);
    this.registry.unregisterCronJobsByExtension(extensionId);

    // 6. 同步清理 ToolRegistry（动态 import 避免 common→ai 编译时依赖）
    if (removedTools.length > 0) {
      try {
        const { ToolRegistry } = await import('../../ai/tools/registry');
        for (const name of removedTools) {
          ToolRegistry.getInstance().unregister(name);
        }
        log.info(
          `[ExtensionLoader] Removed ${removedTools.length} tool(s) from ToolRegistry: ${removedTools.join(', ')}`
        );
      } catch {
        // ToolRegistry 不可用时静默（应用启动早期阶段）
      }
    }

    // 7. 清理本地记录
    this.loadedExtensions.delete(extensionId);
    this.loadedModules.delete(extensionId);

    log.info(`[ExtensionLoader] Unloaded "${extensionId}"`);
  }

  /**
   * 启动 fs.watch 监听所有搜索路径
   * 只监听一层目录（子目录增删）
   */
  watch(searchPaths: string[]): void {
    for (const searchPath of searchPaths) {
      if (!fs.existsSync(searchPath)) continue;

      try {
        const watcher = fs.watch(searchPath, { persistent: false }, (_eventType, filename) => {
          if (!filename) return;
          this.handleWatchEvent(searchPath, filename);
        });
        this.watchers.push(watcher);
      } catch (err) {
        log.error(`[ExtensionLoader] Failed to watch "${searchPath}":`, err);
      }
    }
  }

  /**
   * 停止监听
   */
  stopWatch(): void {
    for (const w of this.watchers) {
      w.close();
    }
    this.watchers = [];
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  /**
   * 获取已加载的 Extension ID 列表
   */
  getLoadedIds(): string[] {
    return [...this.loadedExtensions.keys()];
  }

  /**
   * 加载任务级 Extension
   *
   * 在 Agent 任务启动时调用，只加载该任务 workspace 下的 Extension。
   *
   * @param threadId 任务 ID (thread ID)
   */
  async loadWorkspaceExtensions(threadId: string, workspaceDir?: string): Promise<void> {
    const { Env } = await import('@main/common/env');
    const workspace = workspaceDir || (await Env.getAgentWorkspaceDir(threadId));
    const workspaceExtDir = path.join(workspace, 'extensions');

    // 如果目录不存在，直接返回
    if (!fs.existsSync(workspaceExtDir)) {
      return;
    }

    const loadedIds: string[] = [];

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(workspaceExtDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const extDir = path.join(workspaceExtDir, entry.name);

      // 记录加载前的 Extension ID（用于追踪新加载的）
      const beforeIds = new Set(this.loadedExtensions.keys());

      await this.load(extDir, 'workspace');

      // 找出新加载的 Extension ID
      for (const id of this.loadedExtensions.keys()) {
        if (!beforeIds.has(id)) {
          loadedIds.push(id);
        }
      }
    }

    if (loadedIds.length > 0) {
      this.workspaceExtensions.set(threadId, loadedIds);
      log.info(
        `[ExtensionLoader] Loaded ${loadedIds.length} workspace extension(s) for thread ${threadId}: ${loadedIds.join(', ')}`
      );
    }
  }

  /**
   * 卸载任务级 Extension
   *
   * 在 Agent 任务完成/出错时调用，清理该任务的 Extension。
   *
   * @param threadId 任务 ID (thread ID)
   */
  async unloadWorkspaceExtensions(threadId: string): Promise<void> {
    const extensionIds = this.workspaceExtensions.get(threadId);
    if (!extensionIds || extensionIds.length === 0) {
      return;
    }

    for (const extensionId of extensionIds) {
      await this.unload(extensionId);
    }

    this.workspaceExtensions.delete(threadId);
    log.info(`[ExtensionLoader] Unloaded ${extensionIds.length} workspace extension(s) for thread ${threadId}`);
  }

  // ---- 内部方法 ----

  private handleWatchEvent(searchPath: string, filename: string): void {
    const key = `${searchPath}/${filename}`;

    // 防抖
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(
      key,
      setTimeout(async () => {
        this.debounceTimers.delete(key);
        const extDir = path.join(searchPath, filename);

        if (fs.existsSync(extDir) && fs.statSync(extDir).isDirectory()) {
          // 新增或修改 → unload + load
          const existingId = this.findExtensionIdByDir(extDir);
          if (existingId) {
            await this.unload(existingId);
          }
          // 推断 origin
          const origin = this.inferOrigin(searchPath);
          await this.load(extDir, origin);
        } else {
          // 删除 → unload
          const existingId = this.findExtensionIdByDir(extDir);
          if (existingId) {
            await this.unload(existingId);
          }
        }
      }, DEBOUNCE_MS)
    );
  }

  private findExtensionIdByDir(dir: string): string | undefined {
    for (const [id, loadedDir] of this.loadedExtensions) {
      if (loadedDir === dir) return id;
    }
    return undefined;
  }

  private inferOrigin(searchPath: string): ExtensionOrigin {
    return this.pathOrigins.get(searchPath) ?? 'workspace';
  }
}

/**
 * 查找 Extension 入口文件
 */
function resolveEntryPath(dir: string): string | undefined {
  for (const name of ['index.ts', 'index.js']) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

/**
 * 校验 Extension manifest 的必填字段和格式
 *
 * @returns 校验错误消息，null 表示通过
 */
/**
 * Extension 信任校验 — P0 级安全检查
 *
 * 在 getJiti().import() 执行前检查 Extension 的可信度：
 *   - builtin: 免检（由 load() 调用方保证）
 *   - user: 检查已知信任 ID 列表，否则警告但允许（用户主动安装）
 *   - workspace: Agent 创建的 Extension，需要额外谨慎
 *
 * 未来可扩展：
 *   - P1: manifest 哈希签名校验
 *   - P2: 用户首次加载时弹出确认对话框
 */
interface TrustResult {
  allowed: boolean;
  reason?: string;
  warning?: string;
}

/** 已知的可信 Extension ID（内置 Extension 或经过审核的） */
const TRUSTED_EXTENSION_IDS = new Set(['memory-auto']);

function verifyExtensionTrust(manifest: ExtensionManifest, _dir: string, origin: ExtensionOrigin): TrustResult {
  // 已知信任 ID（如内置 Extension 被安装到非 builtin 路径）
  if (TRUSTED_EXTENSION_IDS.has(manifest.id)) {
    return { allowed: true };
  }

  // user 级 Extension：用户主动安装的，发出警告但允许加载
  if (origin === 'user') {
    return {
      allowed: true,
      warning: 'Extension code runs in the main process without sandboxing.'
    };
  }

  // workspace 级 Extension：Agent 创建的，允许但发出更强的警告
  if (origin === 'workspace') {
    return {
      allowed: true,
      warning:
        'Workspace extension (possibly agent-created) runs in the main process without sandboxing. ' +
        'Review the code before trusting it.'
    };
  }

  // 默认允许（不应到达此处）
  return { allowed: true };
}

function validateManifest(manifest: ExtensionManifest): string | null {
  if (!manifest.id || typeof manifest.id !== 'string') {
    return 'Missing or invalid "id" field';
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(manifest.id)) {
    return `Invalid "id" format: "${manifest.id}" (only alphanumeric, - and _ allowed)`;
  }
  if (!manifest.name || typeof manifest.name !== 'string') {
    return 'Missing or invalid "name" field';
  }
  if (!manifest.version || typeof manifest.version !== 'string') {
    return 'Missing or invalid "version" field';
  }
  if (manifest.skills !== undefined && typeof manifest.skills !== 'string') {
    return '"skills" field must be a string (directory path)';
  }
  return null;
}
