/**
 * Extension 系统类型定义
 *
 * 统一命名：所有公开类型使用 Extension 前缀。
 * Extension 系统提供三种能力注册：Agent 生命周期钩子、工具、Gateway 方法。
 */

import type { ToolDefinition } from '../../ai/tools/types';
import type { MethodHandler } from '../../gateway/protocol/types';

// ==================== Extension 模块 ====================

/** Extension 清单（extension.json） */
export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  /**
   * 设为 false 可禁用此 Extension，加载器会跳过它。
   * 省略或 true 表示启用（默认行为）。
   */
  enabled?: boolean;
  /**
   * 扩展贡献的 Skill 目录（相对于扩展根目录）
   *
   * 声明后，该目录下的 Skill 会被 Skill 加载器自动发现。
   * @example "skills" → <extensionDir>/skills/
   */
  skills?: string;
}

/** Extension 来源 */
export type ExtensionOrigin = 'builtin' | 'user' | 'workspace';

/** Extension 模块导出格式 */
export interface ExtensionModule {
  id: string;
  name: string;
  register: (api: ExtensionApi) => void | Promise<void>;
  /** 可选的卸载回调（热重载或应用退出时调用） */
  unregister?: () => void | Promise<void>;
}

/** Extension 日志 */
export interface ExtensionLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

/** Extension EventBus 接口 */
export interface ExtensionEventBus {
  on<T = unknown>(event: string, handler: (data: T) => void): void;
  off<T = unknown>(event: string, handler: (data: T) => void): void;
  emit<T = unknown>(event: string, data: T): void;
}

// ==================== ExtensionApi ====================

export interface ChannelContext {
  /** Channel 绑定的 AbortSignal，用于安全退出 */
  abortSignal: AbortSignal;
  /** 日志 */
  log: ExtensionLogger;
}

export interface ChannelConfig {
  /** 通道唯一 ID */
  id: string;
  /** 通道名称 */
  name: string;
  /** Gateway 生命周期钩子 */
  gateway?: {
    /** 启动通道监听 */
    start?: (ctx: ChannelContext) => Promise<void> | void;
    /** 停止通道监听 */
    stop?: (ctx: ChannelContext) => Promise<void> | void;
  };
}

export interface HttpRouteConfig {
  /** 路由路径，例如 '/webhook/tavern' */
  path: string;
  /** HTTP 方法 */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** Koa 处理器函数 (使用 Record 避免耦合 Koa 类型) */
  handler: (ctx: Record<string, unknown>) => Promise<void> | void;
}

export interface BackgroundService {
  /** 服务唯一 ID */
  id: string;
  /** 启动服务 */
  start: () => Promise<void> | void;
  /** 停止服务 */
  stop: () => Promise<void> | void;
}

/**
 * Extension Services — 核心能力的结构化访问接口
 *
 * Extension 通过 api.services 访问系统服务，避免直接 import 核心模块。
 * 服务实例由 ExtensionManager 在注册时注入。
 */
export interface ExtensionServices {
  /** HITL 审批服务 */
  hitl: {
    /** 等待单个工具调用的审批决策 */
    waitForSingleDecision(
      approvalId: string,
      timeoutMs?: number
    ): Promise<import('@shared/stream-protocol').HitlApprovalDecision | null>;
    /** 提交单个工具调用的审批决策 */
    submitSingleDecision(approvalId: string, decision: import('@shared/stream-protocol').HitlApprovalDecision): boolean;
    /** 清理指定 session 的所有审批 */
    cleanupSession(sessionId: string): void;
  };
  /** 事件发送服务 */
  events: {
    /** 向指定 session 广播流式事件（前端 + EventBus） */
    emit(sessionId: string, chunk: { type: string; content: string; data?: Record<string, unknown> }): void;
  };
}

/** Extension 与系统交互的唯一接口 */
export interface ExtensionApi {
  /** Extension ID */
  id: string;
  /** Extension 名称 */
  name: string;
  /** 来源 */
  origin: ExtensionOrigin;
  /** 日志 */
  logger: ExtensionLogger;

  /**
   * 核心服务接口（解耦 Extension 与核心模块的直接依赖）
   *
   * Extension 应通过 api.services 访问 HITL、事件等能力，
   * 而非直接 import 内部模块路径。
   */
  services: ExtensionServices;

  /**
   * EventBus 接口（延迟加载）
   *
   * 避免 Extension 直接 import eventbus，防止触发 env/logger 初始化链。
   */
  eventBus: ExtensionEventBus;

  /** 注册工具 */
  registerTool(tool: ToolDefinition): void;
  /** 注册 Agent 生命周期钩子 */
  on<K extends ExtensionHookName>(hookName: K, handler: ExtensionHookHandler<K>, opts?: { priority?: number }): void;
  /** 注册 Gateway RPC 方法 */
  registerGatewayMethod(method: string, handler: MethodHandler): void;

  /** 注册外部服务通道 */
  registerChannel(config: ChannelConfig): void;
  /**
   * 注册 ChannelPlugin（新架构）
   *
   * @param plugin - ChannelPlugin 实例
   *
   * @example
   * api.registerChannelPlugin({
   *   id: 'discussion',
   *   name: 'Discussion Room',
   *   lifecycle: { start, stop },
   *   inbound: { handleMessage },
   *   outbound: { sendMessage }
   * });
   */
  registerChannelPlugin(plugin: import('../../channels/types').ChannelPlugin): void;
  /** 注册 HTTP 路由 */
  registerHttpRoute(config: HttpRouteConfig): void;
  /** 注册后台服务 */
  registerService(service: BackgroundService): void;
  /** 注册定时任务（通过 CronScheduler 调度） */
  registerCronJob(config: CronJobConfig): void;
}

// ==================== Extension Hook ====================

/** 17 种 Agent 生命周期钩子 */
export type ExtensionHookName =
  | 'before_agent_start' // modifying：注入上下文 / 替换提示词
  | 'agent_end' // void：Agent 执行完成
  | 'before_tool_call' // modifying：修改参数 / 阻止调用
  | 'after_tool_call' // void：工具执行后
  | 'tool_result_persist' // modifying：修改持久化结果
  | 'message_received' // void：收到用户消息
  | 'session_start' // void：会话开始
  | 'session_end' // void：会话结束
  // Phase 1 新增（Turn + Compaction）
  | 'turn_start' // void：轮次开始
  | 'turn_end' // void：轮次完成
  | 'before_compaction' // modifying：压缩前（可自定义压缩 / Memory Flush）
  | 'after_compaction' // void：压缩完成
  // Phase 2 新增（Pipeline + Provider）
  | 'message_queued' // void：消息入队
  | 'message_dequeued' // void：消息出队（即将执行）
  | 'queue_drain_start' // void：队列排水开始
  | 'model_resolved' // void：模型选择完成
  | 'model_fallback'; // void：模型回退触发

/** 执行模式 */
export type ExtensionHookMode = 'void' | 'modifying';

export const EXTENSION_HOOK_MODE: Record<ExtensionHookName, ExtensionHookMode> = {
  before_agent_start: 'modifying',
  agent_end: 'void',
  before_tool_call: 'modifying',
  after_tool_call: 'void',
  tool_result_persist: 'modifying',
  message_received: 'void',
  session_start: 'void',
  session_end: 'void',
  // Phase 1 新增
  turn_start: 'void',
  turn_end: 'void',
  before_compaction: 'modifying',
  after_compaction: 'void',
  // Phase 2 新增（Pipeline + Provider）
  message_queued: 'void',
  message_dequeued: 'void',
  queue_drain_start: 'void',
  model_resolved: 'void',
  model_fallback: 'void'
};

// ---- 各 Hook 的 Event / Result ----

export interface BeforeAgentStartEvent {
  sessionId: string;
  prompt: string;
  systemPrompt?: string;
}
export interface BeforeAgentStartResult {
  prependContext?: string;
  replaceSystemPrompt?: string;
}

export interface BeforeToolCallEvent {
  sessionId: string;
  toolName: string;
  params: Record<string, unknown>;
  /** 工具定义中是否标记需要用户确认（needUserConfirm） */
  needUserConfirm?: boolean;
}
export interface BeforeToolCallResult {
  block?: boolean;
  blockReason?: string;
  /** 异步挂起：工具需要审批但不阻塞 Agent run，run 正常结束后等待事件唤醒 */
  suspend?: boolean;
  suspendReason?: string;
  /** 自定义结果文本（用于 suspend 或 block 时的消息） */
  resultText?: string;
  params?: Record<string, unknown>;
}

export interface ToolResultPersistEvent {
  sessionId: string;
  toolName: string;
  result: string;
}
export interface ToolResultPersistResult {
  result?: string;
}

export interface AgentEndEvent {
  sessionId: string;
  success: boolean;
  output: string;
  durationMs: number;
}

export interface AfterToolCallEvent {
  sessionId: string;
  toolName: string;
  params: Record<string, unknown>;
  result: string;
  durationMs: number;
}

export interface MessageReceivedEvent {
  sessionId: string;
  message: string;
}

export interface SessionEvent {
  sessionId: string;
}

// ---- Phase 1 新增：Turn + Compaction ----

export interface TurnStartEvent {
  sessionId: string;
  /** 轮次索引（从 1 开始） */
  turnIndex: number;
}

export interface TurnEndEvent {
  sessionId: string;
  /** 轮次索引 */
  turnIndex: number;
  /** 本轮耗时（ms） */
  durationMs: number;
  /** 本轮工具调用次数 */
  toolCallCount: number;
  /** 本轮 token 用量（如果底层 Runtime 提供） */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface BeforeCompactionEvent {
  sessionId: string;
  /** Agent 定义 ID（用于定位 Agent Home） */
  agentId?: string;
  /** 待压缩消息数 */
  messageCount: number;
  /** 当前 token 总数 */
  totalTokens: number;
  /** 触发阈值 */
  threshold: number;
}

export interface BeforeCompactionResult {
  /** 跳过默认压缩（由扩展自行实现压缩） */
  skipDefault?: boolean;
  /** 自定义压缩摘要（替换默认摘要） */
  customSummary?: string;
}

export interface AfterCompactionEvent {
  sessionId: string;
  /** 压缩前 token 数 */
  originalTokens: number;
  /** 压缩后 token 数 */
  compressedTokens: number;
  /** 压缩比 */
  compressionRatio: number;
  /** 压缩耗时（ms） */
  duration: number;
}

// ---- Phase 2 新增：Pipeline + Provider ----

export interface MessageQueuedEvent {
  sessionId: string;
  /** 入队的消息内容 */
  message: string;
  /** 当前队列模式 */
  mode: string;
  /** 入队后队列深度 */
  queueLength: number;
}

export interface MessageDequeuedEvent {
  sessionId: string;
  /** 出队的消息内容 */
  message: string;
  /** 出队后剩余队列深度 */
  remainingLength: number;
}

export interface QueueDrainStartEvent {
  sessionId: string;
  /** 排水策略 */
  strategy: 'followup' | 'collect';
  /** 待排水消息数 */
  pendingCount: number;
}

export interface ModelResolvedEvent {
  sessionId: string;
  /** 解析后的 provider ID */
  providerId: string;
  /** 解析后的 model ID */
  modelId: string;
  /** 解析来源层级 */
  source: string;
}

export interface ModelFallbackEvent {
  sessionId: string;
  /** 失败的 provider/model */
  failedRef: string;
  /** 回退到的 provider/model */
  fallbackRef: string;
  /** 失败原因 */
  error: string;
  /** 已尝试次数 */
  attemptIndex: number;
}

/** Event 映射 */
export type ExtensionHookEventMap = {
  before_agent_start: BeforeAgentStartEvent;
  agent_end: AgentEndEvent;
  before_tool_call: BeforeToolCallEvent;
  after_tool_call: AfterToolCallEvent;
  tool_result_persist: ToolResultPersistEvent;
  message_received: MessageReceivedEvent;
  session_start: SessionEvent;
  session_end: SessionEvent;
  // Phase 1 新增
  turn_start: TurnStartEvent;
  turn_end: TurnEndEvent;
  before_compaction: BeforeCompactionEvent;
  after_compaction: AfterCompactionEvent;
  // Phase 2 新增（Pipeline + Provider）
  message_queued: MessageQueuedEvent;
  message_dequeued: MessageDequeuedEvent;
  queue_drain_start: QueueDrainStartEvent;
  model_resolved: ModelResolvedEvent;
  model_fallback: ModelFallbackEvent;
};

/** Result 映射 */
export type ExtensionHookResultMap = {
  before_agent_start: BeforeAgentStartResult | void;
  agent_end: void;
  before_tool_call: BeforeToolCallResult | void;
  after_tool_call: void;
  tool_result_persist: ToolResultPersistResult | void;
  message_received: void;
  session_start: void;
  session_end: void;
  // Phase 1 新增
  turn_start: void;
  turn_end: void;
  before_compaction: BeforeCompactionResult | void;
  after_compaction: void;
  // Phase 2 新增（Pipeline + Provider）
  message_queued: void;
  message_dequeued: void;
  queue_drain_start: void;
  model_resolved: void;
  model_fallback: void;
};

/** Handler 签名 */
export type ExtensionHookHandler<K extends ExtensionHookName> = (
  event: ExtensionHookEventMap[K]
) => Promise<ExtensionHookResultMap[K]>;

/** 已注册的 Hook */
export interface RegisteredExtensionHook<K extends ExtensionHookName = ExtensionHookName> {
  extensionId: string;
  hookName: K;
  handler: ExtensionHookHandler<K>;
  priority: number;
}

// ==================== 注册记录 ====================

export interface RegisteredExtensionTool {
  extensionId: string;
  tool: ToolDefinition;
}

export interface RegisteredExtensionMethod {
  extensionId: string;
  method: string;
  handler: MethodHandler;
}

/** 扩展贡献的 Skill 目录 */
export interface RegisteredExtensionSkillDir {
  extensionId: string;
  /** 已解析为绝对路径的 Skill 目录 */
  dir: string;
}

export interface RegisteredChannel {
  extensionId: string;
  channel: ChannelConfig;
}

export interface RegisteredHttpRoute {
  extensionId: string;
  route: HttpRouteConfig;
}

export interface RegisteredBackgroundService {
  extensionId: string;
  service: BackgroundService;
}

// ==================== CronJob ====================

/** Extension 注册定时任务的配置 */
export interface CronJobConfig {
  /** 任务名称（英文标识符，同一 Extension 内不能重复） */
  name: string;
  /** 任务描述 */
  description: string;
  /** Cron 表达式（5 段标准格式：分 时 日 月 周） */
  cronExpression: string;
  /** 要执行的任务（自然语言描述，交给 Agent 执行） */
  task: string;
  /** 关联的 Agent ID（可选，默认使用 app-copilot） */
  agentId?: string;
  /** 是否启用（默认 true） */
  enabled?: boolean;
}

export interface RegisteredCronJob {
  extensionId: string;
  config: CronJobConfig;
}
