import { is } from '@electron-toolkit/utils';
import { app } from 'electron';
import fs from 'fs';
import { mkdirp } from 'mkdirp';
import path from 'path';

export const Env = {
  isDev: is.dev,
  isProd: !is.dev,
  isTest: process.env.NODE_ENV === 'test',
  isWindows: process.platform === 'win32',
  isMac: process.platform === 'darwin',
  isLinux: process.platform === 'linux',
  isPackaged: app.isPackaged,

  // 主进程环境变量
  main: {
    bundleId: process.env.VITE_MAIN_BUNDLE_ID,
    logLevel: process.env.VITE_LOG_LEVEL,
    logMaxSize: process.env.VITE_LOG_MAX_SIZE,
    debug: process.env.VITE_DEBUG,
    openDevTools: process.env.VITE_OPEN_DEVTOOLS,
    /** 统一服务端口（HTTP + WebSocket 共享），默认 8765 */
    serverPort: process.env.VITE_SERVER_PORT,
    /** 服务绑定地址，默认 127.0.0.1（设为 0.0.0.0 可开启局域网访问） */
    serverHost: process.env.VITE_SERVER_HOST || '127.0.0.1',
    /** 模型存储目录（环境变量优先，未设置则用默认路径） */
    modelDir: process.env.VITE_MODEL_DIR
  },

  app: {
    name: app.getName(),
    version: app.getVersion(),
    locale: app.getLocale()
  },

  paths: (() => {
    // === 基础路径计算 ===
    const _userHome = is.dev
      ? path.join(app.getAppPath(), '.home')
      : path.join(app.getPath('home'), '.' + app.getName());

    return {
      // === 应用路径（Application Paths）===
      /** 应用根目录 (如: /Applications/coobee-ai.app/Contents/Resources/app.asar) */
      root: app.getAppPath(),
      /** 应用数据目录 - 存储数据库、配置等 (如: ~/Library/Application Support/coobee-ai) */
      userData: app.getPath('userData'),
      /** 应用数据目录(系统级) (如: ~/Library/Application Support) */
      appData: app.getPath('appData'),
      /** 日志目录 (如: /path/to/app) */
      logPath: !is.dev && app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath(),
      /** 安装目录 (如: /Applications/coobee-ai.app/Contents/MacOS) */
      installDir: !is.dev && app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath(),
      /** 用户主目录 (开发: <项目>/.home | 生产: ~/.coobee-ai) */
      userHome: _userHome,

      // === 全局协议文件（AGENTS.md）===
      /**
       * 全局智能体协议文件路径
       *
       * 所有智能体启动时硬注入此文件内容到 system prompt。
       * 包含系统身份信息、全局规则和共享上下文。
       * 智能体运行时可通过 write 工具修改。
       *
       * @example 开发: <项目>/.home/AGENTS.md | 生产: ~/.coobee-ai/AGENTS.md
       */
      agentsMdPath: path.join(_userHome, 'AGENTS.md'),

      // === 配置目录（Config）===
      /** 用户配置目录 @example 开发: <项目>/.home/config | 生产: ~/.coobee-ai/config */
      configDir: path.join(_userHome, 'config'),

      // === 敏感信息目录（Secrets）===
      /**
       * 敏感信息目录（API Keys、Tokens 等）
       *
       * 独立于 config 目录，更严格的权限控制（700/600）
       *
       * 存储内容：
       *   - secrets.json5  — Provider API Keys
       *   - skills.json5   — Skill 专属配置（可能含 Key/Token）
       *
       * @example 开发: <项目>/.home/secrets | 生产: ~/.coobee-ai/secrets
       */
      secretsDir: path.join(_userHome, 'secrets'),

      // === 记忆目录（Memory）===
      /**
       * 记忆总根目录，与 workspaces 同级
       *
       * 结构：
       *   memory/
       *   ├── user/      用户级记忆（跨 Agent 共享，如偏好、长期记忆）
       *   └── agent/     Agent 级记忆（按 Agent 隔离，如经验、学习成果）
       *
       * @example 开发: <项目>/.home/memory | 生产: ~/.coobee-ai/memory
       */
      memoryDir: path.join(_userHome, 'memory'),
      /** 用户级记忆（跨 Agent 共享） */
      userMemoryDir: path.join(_userHome, 'memory', 'user'),
      /** Agent 级记忆（按 Agent 隔离） */
      agentMemoryDir: path.join(_userHome, 'memory', 'agent'),

      // === 共享网盘目录（SharedDrive）===
      /**
       * 多智能体共享网盘
       *
       * 结构：
       *   shared-drive/
       *   ├── index.jsonl        全局索引
       *   ├── {agentId}/         按智能体分区
       *   │   └── {date}/{topic}/
       *   └── _shared/           公共区域
       *
       * @example 开发: <项目>/.home/shared-drive | 生产: ~/.coobee-ai/shared-drive
       */
      sharedDriveDir: path.join(_userHome, 'shared-drive'),

      // === Agent 定义目录（Agents）===
      /**
       * 内置 Agent 目录（只读，随应用分发）
       *
       * 开发模式：项目根目录 agents/
       * 生产模式：resources/agents
       *
       * @example 开发: <项目>/agents
       */
      builtinAgentsDir: is.dev ? path.join(app.getAppPath(), 'agents') : path.join(process.resourcesPath, 'agents'),

      /**
       * 用户 Agent 目录（可读写，用户自行创建/修改）
       *
       * Agent 多级合并优先级（后者覆盖前者同 ID）：
       *   1. builtinAgentsDir  — 内置（最低）
       *   2. userAgentsDir     — 用户级（最高）
       *
       * 每个 Agent 一个 JSON 文件：{agentsDir}/{agentId}.json
       * 由 AgentStore 管理，通过 HTTP API 和 AI Creator 暴露给 LLM。
       *
       * @example 开发: <项目>/.home/agents | 生产: ~/.coobee-ai/agents
       */
      userAgentsDir: path.join(_userHome, 'agents'),

      // === 会话线程目录（Threads）===
      /**
       * 会话线程存储目录
       *
       * 每个 Thread 一个 JSON 文件：{threadsDir}/{threadId}.json
       * threadId 使用 Snowflake ID（有序，可按 ID 排序得到时间顺序）。
       * 由 ThreadStore 管理，通过 HTTP REST 接口暴露给前端。
       *
       * @example 开发: <项目>/.home/threads | 生产: ~/.coobee-ai/threads
       */
      threadsDir: path.join(_userHome, 'threads'),

      // === Agent 工作空间（Workspaces）===
      /**
       * Agent 工作空间总根目录
       *
       * 每次会话/Agent 通过 getAgentWorkspaceDir(id) 获取独立子目录：
       *   workspaces/{id}/
       *   ├── GOAL.md       目标文件（系统初始化，Agent 填写）
       *   ├── sessions/     会话持久化
       *   ├── contexts/     LLM 请求上下文快照
       *   ├── skills/       Agent 自生成的 Skill
       *   ├── output/       Agent 输出文件
       *   └── tasks/        多 Agent 委托任务（按需创建，详见 getAgentWorkspaceDir）
       *
       * @example 开发: <项目>/.home/workspaces | 生产: ~/.coobee-ai/workspaces
       */
      workspacesDir: path.join(_userHome, 'workspaces'),

      // === Skill 目录（Skills）===
      /**
       * 内置 Skill 目录（只读，随应用分发）
       *
       * 开发模式：项目根目录 skills/
       * 生产模式：resources/skills
       *
       * @example 开发: <项目>/skills
       */
      builtinSkillsDir: is.dev ? path.join(app.getAppPath(), 'skills') : path.join(process.resourcesPath, 'skills'),

      /**
       * 用户 Skill 目录（可读写，用户自行安装/编写）
       *
       * Skill 多级合并优先级（后者覆盖前者同名）：
       *   1. builtinSkillsDir  — 内置（最低）
       *   2. userSkillsDir     — 用户级
       *   3. {workspace}/skills — Agent 自生成（最高，仅当前 Agent 可见）
       *
       * @example 开发: <项目>/.home/skills | 生产: ~/.coobee-ai/skills
       */
      userSkillsDir: path.join(_userHome, 'skills'),

      // === Extension 目录（Extensions）===
      /**
       * 内置 Extension 目录（只读，随应用分发）
       *
       * @example 开发: <项目>/extensions | 生产: resources/extensions
       */
      builtinExtensionsDir: is.dev
        ? path.join(app.getAppPath(), 'extensions')
        : path.join(process.resourcesPath, 'extensions'),

      /**
       * 用户 Extension 目录（可读写，用户自行安装/编写）
       *
       * Extension 多级合并优先级（后者覆盖前者同 ID）：
       *   1. builtinExtensionsDir  — 内置（最低）
       *   2. userExtensionsDir     — 用户级
       *   3. {workspace}/extensions — 工作空间级（最高，仅当前 Agent 可见）
       *
       * @example 开发: <项目>/.home/extensions | 生产: ~/.coobee-ai/extensions
       */
      userExtensionsDir: path.join(_userHome, 'extensions'),

      // === Worker 与模型（Workers & Models）===

      /**
       * Worker 脚本目录（只读，随应用打包分发）
       *
       * 包含 Python Worker 的源码、requirements.txt 和虚拟环境：
       *   workers/
       *   ├── tts/         TTS 语音合成
       *   │   ├── venv/    虚拟环境（gitignore）
       *   │   └── server.py
       *   ├── asr/         ASR 语音识别（FunASR）
       *   │   ├── venv/    虚拟环境（gitignore）
       *   │   └── server.py
       *   └── ...          未来新增的 Worker
       *
       * @example 开发: <项目>/workers | 生产: resources/workers
       */
      workersDir: is.dev ? path.join(app.getAppPath(), 'workers') : path.join(process.resourcesPath, 'workers'),

      /**
       * Worker 虚拟环境目录（已废弃）
       *
       * @deprecated 现在所有虚拟环境都在 Worker 目录内（workers/{name}/venv/）
       * @example workers/asr/venv/, workers/tts/venv/, workers/ocr/venv/
       */
      workerEnvsDir: is.dev ? path.join(app.getAppPath(), 'worker-envs') : path.join(_userHome, 'worker-envs'),

      /**
       * 模型仓库目录（可写，所有 Worker 共享）
       *
       * 优先级：
       *   1. VITE_MODEL_DIR 环境变量（.env 配置，最高优先）
       *   2. 默认路径 ~/.coobee-ai/models
       *
       * 模型按来源自动分级存放：
       *   models/
       *   ├── Qwen/                    TTS 模型
       *   ├── FunAudioLLM/             ASR 模型
       *   └── hub/                     HuggingFace hub 缓存
       */
      modelsDir: process.env.VITE_MODEL_DIR || path.join(_userHome, 'models'),

      // === 系统路径（System Paths）===
      /** 系统用户目录 (如: /Users/username) */
      home: app.getPath('home'),
      /** 系统临时目录 (如: /var/folders/xxx) */
      temp: app.getPath('temp'),
      /** 系统下载目录 (如: ~/Downloads) */
      downloads: app.getPath('downloads'),
      /** 系统文档目录 (如: ~/Documents) */
      documents: app.getPath('documents'),
      /** 系统桌面目录 (如: ~/Desktop) */
      desktop: app.getPath('desktop')
    };
  })(),

  isRendererProcess(): boolean {
    return typeof process === 'undefined' || !process || process.type === 'renderer';
  },

  isMainProcess(): boolean {
    return typeof process !== 'undefined' && process.type === 'browser';
  },

  isForkedChildProcess(): boolean {
    return Number(process.env.ELECTRON_RUN_AS_NODE) === 1;
  },

  getResourcePath(relativePath: string): string {
    return path.join(this.isDev ? process.cwd() : process.resourcesPath, relativePath);
  },

  async getInstallDir(): Promise<string> {
    const installDir = this.paths.installDir;
    if (!fs.existsSync(installDir)) {
      await mkdirp(installDir);
    }
    return installDir;
  },

  async getUpgradeDir(): Promise<string> {
    const installDir = await this.getInstallDir();
    const upgradeDir = path.join(installDir, 'upgrade');
    if (!fs.existsSync(upgradeDir)) {
      await mkdirp(upgradeDir);
    }
    return upgradeDir;
  },

  // ==================== 工作空间与 Skill ====================

  /**
   * 获取指定 ID 的 Agent 工作空间目录，自动确保目录结构存在
   *
   * 返回 {workspacesDir}/{id}，id 通常为 sessionId。
   *
   * 结构（双空间架构）：
   *   {workspacesDir}/{id}/
   *   ├── GOAL.md                  目标文件（Agent 在意图提取阶段填写）
   *   │
   *   ├── user/                    ← 用户空间（前端默认展示，用户可直接操作）
   *   │   ├── data/                   用户输入文件、参考资料
   *   │   ├── output/                 Agent 产出
   *   │   ├── skills/                 当前激活的技能（软链接，可查看、可修改）
   *   │   └── knowledge/              知识库文档
   *   │
   *   ├── .runtime/                ← 系统空间（前端可见，供高级用户查看）
   *   │   ├── sessions/               会话持久化
   *   │   ├── contexts/               LLM 请求上下文快照
   *   │   ├── events/                 流式事件记录
   *   │   ├── logs/                   Agent 运行日志
   *   │   └── checkpoint.json         执行断点
   *   │
   *   └── tasks/                   [多 Agent] 委托任务目录（按需创建）
   *       └── {taskId}/
   *           ├── plan.md             任务计划
   *           ├── status.json         任务状态
   *           ├── agents/             子 Agent 工作空间
   *           ├── results/            子 Agent 汇总结果
   *           └── experiences/        共享执行经验
   *
   * @param id 工作空间标识（通常为 sessionId）
   * @returns 工作空间根路径
   */
  async getAgentWorkspaceDir(id: string): Promise<string> {
    const workspace = path.join(this.paths.workspacesDir, id);
    const subDirs = [
      workspace,
      // 用户空间
      path.join(workspace, 'user'),
      path.join(workspace, 'user', 'data'),
      path.join(workspace, 'user', 'output'),
      path.join(workspace, 'user', 'skills'),
      path.join(workspace, 'user', 'knowledge'),
      // 系统空间
      path.join(workspace, '.runtime'),
      path.join(workspace, '.runtime', 'sessions'),
      path.join(workspace, '.runtime', 'contexts'),
      path.join(workspace, '.runtime', 'events'),
      path.join(workspace, '.runtime', 'logs')
    ];
    for (const dir of subDirs) {
      if (!fs.existsSync(dir)) {
        await mkdirp(dir);
      }
    }
    // 兼容旧工作空间：如果旧目录结构存在，迁移到新结构
    await this._migrateWorkspaceIfNeeded(workspace);
    // 初始化 GOAL.md（工作空间标准文件）
    const goalPath = path.join(workspace, 'GOAL.md');
    if (!fs.existsSync(goalPath)) {
      fs.writeFileSync(goalPath, '', 'utf-8');
    }
    // 初始化会话级 AGENTS.md（从全局模板复制，智能体可按需修改）
    const wsAgentsMd = path.join(workspace, 'AGENTS.md');
    if (!fs.existsSync(wsAgentsMd)) {
      const globalAgentsMd = this.paths.agentsMdPath;
      if (fs.existsSync(globalAgentsMd)) {
        fs.copyFileSync(globalAgentsMd, wsAgentsMd);
      } else {
        fs.writeFileSync(wsAgentsMd, '', 'utf-8');
      }
    }
    return workspace;
  },

  /**
   * 惰性迁移旧工作空间到新的双空间结构
   *
   * 如果根目录下存在旧的 sessions/contexts/events/logs 目录，
   * 把它们移动到 .runtime/ 下。如果根目录下有 output/，移到 user/output/。
   */
  async _migrateWorkspaceIfNeeded(workspace: string): Promise<void> {
    const runtimeDir = path.join(workspace, '.runtime');
    const userDir = path.join(workspace, 'user');

    const runtimeMigrations = ['sessions', 'contexts', 'events', 'logs'];
    for (const name of runtimeMigrations) {
      const oldDir = path.join(workspace, name);
      const newDir = path.join(runtimeDir, name);
      if (fs.existsSync(oldDir) && !fs.existsSync(path.join(oldDir, '.migrated'))) {
        // 旧目录存在且未标记迁移——将内容复制到新位置
        try {
          const entries = fs.readdirSync(oldDir);
          for (const entry of entries) {
            const src = path.join(oldDir, entry);
            const dst = path.join(newDir, entry);
            if (!fs.existsSync(dst)) {
              fs.renameSync(src, dst);
            }
          }
          // 标记已迁移（保留旧目录避免破坏正在运行的会话）
          fs.writeFileSync(path.join(oldDir, '.migrated'), 'migrated to .runtime/', 'utf-8');
        } catch {
          // 迁移失败时静默，不阻塞正常流程
        }
      }
    }

    // output/ → user/output/
    const oldOutput = path.join(workspace, 'output');
    const newOutput = path.join(userDir, 'output');
    if (fs.existsSync(oldOutput) && !fs.existsSync(path.join(oldOutput, '.migrated'))) {
      try {
        const entries = fs.readdirSync(oldOutput);
        for (const entry of entries) {
          const src = path.join(oldOutput, entry);
          const dst = path.join(newOutput, entry);
          if (!fs.existsSync(dst)) {
            fs.renameSync(src, dst);
          }
        }
        fs.writeFileSync(path.join(oldOutput, '.migrated'), 'migrated to user/output/', 'utf-8');
      } catch {
        // 迁移失败时静默
      }
    }
  },

  /**
   * 获取 Skill 搜索路径列表（按优先级从低到高）
   *
   * 合并策略：同名 Skill 后者覆盖前者
   *   1. builtinSkillsDir  — 内置（最低优先级）
   *   2. userSkillsDir     — 用户级
   *   3. {workspace}/skills — Agent 自生成（最高优先级，仅当前 Agent 可见）
   *
   * 同时确保所有 Skill 目录存在（含核心目录 userHome、dbDir、workspacesDir）。
   *
   * @param workspace 当前工作空间路径（可选，由 getWorkspaceDir 返回）
   */
  async getSkillSearchPaths(workspace?: string): Promise<string[]> {
    const coreDirs = [
      this.paths.userHome,
      this.paths.configDir,
      this.paths.memoryDir,
      this.paths.userMemoryDir,
      this.paths.agentMemoryDir,
      this.paths.workspacesDir,
      this.paths.userSkillsDir
    ];
    const skillPaths = [this.paths.builtinSkillsDir, this.paths.userSkillsDir];
    if (workspace) {
      const wsSkills = path.join(workspace, 'user', 'skills');
      coreDirs.push(wsSkills);
      skillPaths.push(wsSkills);
    }
    for (const dir of coreDirs) {
      if (!fs.existsSync(dir)) {
        await mkdirp(dir);
      }
    }
    return skillPaths;
  },

  /**
   * 获取 Extension 搜索路径列表（按优先级从低到高）
   *
   * 与 Skill 同构的三级目录：
   *   1. builtinExtensionsDir  — 内置（最低优先级）
   *   2. userExtensionsDir     — 用户级
   *   3. {workspace}/extensions — 工作空间级（最高优先级）
   *
   * @param workspace 当前工作空间路径（可选）
   */
  async getExtensionSearchPaths(workspace?: string): Promise<string[]> {
    const extensionPaths = [this.paths.builtinExtensionsDir, this.paths.userExtensionsDir];
    if (workspace) {
      extensionPaths.push(path.join(workspace, 'extensions'));
    }
    for (const dir of extensionPaths) {
      if (!fs.existsSync(dir)) {
        await mkdirp(dir);
      }
    }
    return extensionPaths;
  },

  // ==================== 应用运行时 ====================

  /**
   * 获取应用运行时目录（runtime/）
   * 用于存储跨平台的二进制文件
   *
   * @returns 运行时目录路径
   * @example
   * - 开发模式: /path/to/coobee-ai/runtime
   * - 生产模式: /Applications/coobee-ai.app/Contents/Resources/runtime
   */
  getAppRuntimeDir(): string {
    // 支持环境变量覆盖（用于测试）
    if (process.env.APP_RUNTIME_DIR) {
      return process.env.APP_RUNTIME_DIR;
    }

    if (this.isDev) {
      // 开发模式：项目根目录/runtime
      return path.join(process.cwd(), 'runtime');
    }

    // 生产模式：resourcesPath/runtime
    return path.join(process.resourcesPath, 'runtime');
  },

  /**
   * 获取当前平台的运行时目录
   *
   * @returns 平台特定的运行时目录路径
   * @example
   * - macOS: /path/to/runtime/macos
   * - Windows: /path/to/runtime/win
   * - Linux: /path/to/runtime/linux
   */
  getPlatformRuntimeDir(): string {
    const runtimeDir = this.getAppRuntimeDir();
    const platformDir = this.isWindows ? 'win' : this.isMac ? 'macos' : 'linux';

    return path.join(runtimeDir, platformDir);
  }
};

export default Env;
