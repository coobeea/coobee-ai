/**
 * Runtime Worker 类型定义
 *
 * 定义 Worker 配置、状态和事件，供 RuntimeManager 和前端使用。
 */

// ==================== Worker 配置 ====================

/**
 * Worker 配置
 *
 * 描述一个 Worker 的启动参数和行为策略。
 * 脚本从 workers/ 目录读取（只读），虚拟环境在用户目录创建（可写）。
 */
export interface WorkerConfig {
  /** Worker 唯一标识（如 'tts', 'asr'） */
  name: string

  /** 显示名称（如 '语音合成', '语音识别'） */
  label: string

  /**
   * Worker 类型
   *
   * - 'python': Python 脚本（需要 venv + uv 安装依赖）
   * - 'native': 原生二进制（直接从 runtime/{platform}/ 启动，无需 Python）
   *
   * @default 'python'
   */
  type?: 'python' | 'native'

  /**
   * 是否启用此 Worker
   *
   * false 时扫描阶段直接跳过，不注册、不启动。
   * 用于临时禁用某个 Worker 而不删除目录。
   *
   * @default true
   */
  enable?: boolean

  /**
   * Worker 入口文件
   *
   * - type='python': 脚本路径（相对于 workers/{name}/），如 'server.py'
   * - type='native': 二进制文件名（相对于 runtime/{platform}/），如 'whisper-server'
   */
  entry: string

  /**
   * 服务监听端口
   * Worker 以 HTTP/WebSocket 服务形式运行，绑定 127.0.0.1
   */
  port: number

  /**
   * 模型目录（绝对路径）
   *
   * Worker 启动时通过 MODEL_DIR / MODELSCOPE_CACHE / HF_HOME 注入。
   * 如果用户本地已有模型，直接指向即可，无需重新下载。
   *
   * 优先级：
   *   1. worker.json 中的 modelDir（最高，per-worker 指定）
   *   2. Env.paths.modelsDir（全局默认，~/.coobee-ai/models）
   */
  modelDir?: string

  /**
   * 依赖文件（相对于 workers/{name}/ 目录）
   * @default 'requirements.txt'
   */
  requirementsFile?: string

  /** 额外的启动参数（追加到 python 命令后） */
  args?: string[]

  /** 额外的环境变量 */
  env?: Record<string, string>

  /** 崩溃后自动重启 @default true */
  autoRestart?: boolean

  /** 自动重启最大次数（0 = 无限） @default 3 */
  maxRestarts?: number

  /** 健康检查路径 @default '/health' */
  healthCheckPath?: string

  /** 健康检查超时（ms），超时视为启动失败 @default 60000 */
  healthCheckTimeout?: number

  /** 是否随应用启动自动拉起（false = 按需启动） @default false */
  autoStart?: boolean
}

// ==================== Worker 状态 ====================

/** Worker 运行状态 */
export type WorkerStatus =
  | 'stopped' // 未启动
  | 'initializing' // 正在初始化虚拟环境/安装依赖
  | 'starting' // 进程已启动，等待健康检查通过
  | 'ready' // 健康检查通过，服务可用
  | 'error' // 启动或运行中出错
  | 'stopping' // 正在停止

/**
 * Worker 运行时信息
 *
 * 通过 IPC 推送给 Renderer，用于 UI 展示。
 */
export interface WorkerInfo {
  /** Worker 名称 */
  name: string
  /** 显示名称 */
  label: string
  /** 当前状态 */
  status: WorkerStatus
  /** 服务端口（ready 时有效） */
  port?: number
  /** 错误信息（error 时有效） */
  error?: string
  /** 进程 PID */
  pid?: number
  /** 重启次数 */
  restartCount: number
  /** 最近一次状态变更时间 */
  updatedAt: number
}

// ==================== Worker 事件 ====================

/**
 * Worker 状态变更事件（Main → Renderer）
 */
export interface WorkerStatusEvent {
  /** 事件类型 */
  type: 'worker:status'
  /** Worker 信息 */
  worker: WorkerInfo
}

/**
 * Worker 日志事件（Main → Renderer，可选）
 */
export interface WorkerLogEvent {
  type: 'worker:log'
  /** Worker 名称 */
  name: string
  /** 日志级别 */
  level: 'info' | 'warn' | 'error'
  /** 日志内容 */
  message: string
  /** 时间戳 */
  timestamp: number
}
