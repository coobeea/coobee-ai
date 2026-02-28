/**
 * 工具类型定义
 *
 * 统一工具系统的核心类型，不依赖任何特定 SDK。
 * 两个 Runtime（OpenAI / PiMono）通过各自的 convertTools() 将这些定义转换为 SDK 原生格式。
 *
 * 设计要点：
 *   - execute 返回 AsyncGenerator，支持流式增量输出（yield）和最终结果（return）
 *   - ToolResult 分离 llmContent / userContent，LLM 和用户看到的内容可以不同
 *   - ToolCategory 分类 + needUserConfirm 声明式元数据，为 HITL 和 UI 策略提供依据
 *   - 审批/HITL 逻辑不在工具内部，由上层统一处理
 */

// ========== 工具分类 ==========

/** 工具功能分类（用于策略控制、UI 分组） */
export enum ToolCategory {
  /** 文件系统操作（read, write, edit） */
  FileSystem = 'file_system',
  /** 搜索功能（grep, find） */
  Search = 'search',
  /** 执行命令（exec） */
  Execute = 'execute',
  /** 网络操作（web_search, fetch） */
  Web = 'web',
  /** 记忆系统 */
  Memory = 'memory',
  /** 文档 */
  Documentation = 'documentation',
  /** 扩展（第三方工具） */
  Extension = 'extension',
  /** 可观测性（session_status, session_history, context_inspect） */
  Observability = 'observability',
  /** 发现（skill_list） */
  Discovery = 'discovery',
  /** 配置管理（config_patch） */
  Configuration = 'configuration'
}

// ========== 工具执行结果 ==========

/** 工具错误信息 */
export interface ToolError {
  /** 错误代码（如 ENOENT, EACCES, TIMEOUT） */
  code: string;
  /** 错误消息 */
  message: string;
  /** 详细信息（可选） */
  details?: unknown;
}

/** 工具执行结果 */
export interface ToolResult {
  /** 是否成功 */
  success: boolean;

  /** LLM 看到的工具执行结果内容（发送回模型的） */
  llmContent?: string;

  /** 用户看到的工具执行结果内容（前端展示用，可含 Markdown） */
  userContent?: string;

  /** 失败时的错误信息 */
  error?: ToolError;

  /** 执行元数据 */
  metadata?: ToolResultMetadata;
}

/** 工具执行元数据 */
export interface ToolResultMetadata {
  /** 执行开始时间（ms timestamp） */
  startTime?: number;
  /** 执行结束时间（ms timestamp） */
  endTime?: number;
  /** 执行耗时（毫秒） */
  duration?: number;
  /** 结果的 token 数量（估算） */
  tokens?: number;
  /** 其他元数据 */
  [key: string]: unknown;
}

// ========== 工具流式更新 ==========

/**
 * 工具流式更新
 *
 * 工具执行过程中通过 yield 发出增量更新，前端可实时展示。
 *
 * @example
 * // 进度更新
 * yield { type: 'progress', content: '正在读取文件...', percentage: 30 }
 *
 * @example
 * // 输出内容（如 exec stdout 的实时输出）
 * yield { type: 'output', content: 'npm install completed' }
 */
export interface ToolStreamUpdate {
  /** 更新类型: progress — 进度, output — 输出内容 */
  type: 'progress' | 'output';

  /** 更新内容 */
  content: string;

  /** 进度百分比（0–100），仅当 type='progress' 时有意义 */
  percentage?: number;
}

// ========== Zod Schema 类型 ==========

import type { z } from 'zod';

/** Zod 参数 Schema 类型（工具参数必须是 ZodObject） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolParametersSchema = z.ZodObject<any>;

// ========== 工具执行上下文 ==========

import type { SandboxContext } from '../sandbox/types';
import type { AgentType } from '../threads/types';
import type { AgentMode } from '../runtime/types';

/**
 * 工具执行上下文 — 工具运行时的完整环境信息
 *
 * 继承 SandboxContext（路径守卫、Docker 等），在此基础上提供：
 *   - 会话标识：sessionId（必填）, threadId, parentSessionId
 *   - Agent 信息：agentName, agentMode, agentId, agentType
 *   - 当前工作目录：cwd（exec / file 工具的默认基准）
 *   - 工作空间路径：sessionsDir, contextsDir, eventsDir, tasksDir, outputDir
 *   - 系统路径：userHome, configDir, memoryDir, tempDir
 *
 * 由 AgentEnvInjector 构建，通过 Builder → Runtime → ToolExecutionPipeline 注入。
 * 大模型不感知此上下文，仅工具执行函数内部使用。
 *
 * 设计原则：
 *   - 工具常用的路径预先计算好，避免工具内部 path.join 或动态 import Env
 *   - 核心字段必填（sessionId, threadId, cwd, agentName, agentMode, 各 Dir）
 *   - Agent 定义相关字段可选（agentId, agentType, parentSessionId）
 */
export interface ToolExecutionContext extends SandboxContext {
  // === 会话标识（必填，override SandboxContext 的 optional sessionId） ===

  /** 当前会话 ID（必填） */
  sessionId: string;

  /** 线程 ID（= 顶层 sessionId，用于关联 Thread 定义） */
  threadId: string;

  // === 工作目录（必填） ===

  /**
   * 当前工作目录
   *
   * exec 命令的默认 cwd，file 工具的相对路径基准。
   * 通常等于 workspaceRoot，Docker 模式下为容器内工作目录。
   */
  cwd: string;

  // === 用户空间（user/）===

  /** 用户空间根目录 — {workspace}/user/ */
  userDir: string;

  /** 工具输出目录 — {workspace}/user/output/ */
  outputDir: string;

  /** 多 Agent 任务目录 — {workspace}/tasks/ */
  tasksDir: string;

  // === 系统空间（.runtime/）===

  /** 会话存储目录 — {workspace}/.runtime/sessions/ */
  sessionsDir: string;

  /** 上下文快照目录 — {workspace}/.runtime/contexts/ */
  contextsDir: string;

  /** 事件记录目录 — {workspace}/.runtime/events/ */
  eventsDir: string;

  // === 系统路径（必填，避免工具动态 import Env） ===

  /** 应用主目录（如 ~/.coobee-ai） */
  userHome: string;

  /** 配置目录（coobee.json5、secrets.json5 等） */
  configDir: string;

  /** 记忆根目录 */
  memoryDir: string;

  /** 系统临时目录 */
  tempDir: string;

  // === Agent 信息（核心字段必填） ===

  /** Agent 名称（运行时显示名，必填） */
  agentName: string;

  /** Agent 运行模式（chat / agent / orchestrator / swarm，必填） */
  agentMode: AgentMode;

  // === Agent 信息（可选字段） ===

  /** Agent 定义 ID（如果关联了持久化的 AgentDefinition） */
  agentId?: string;

  /** Agent 类型（agent / orchestrator / swarm） */
  agentType?: AgentType;

  /** 父会话 ID（子 Agent / Worker / Swarm Role 时存在，用于追溯委托链） */
  parentSessionId?: string;
}

// ========== 工具定义 ==========

/**
 * 统一工具定义（SDK 无关）
 *
 * 每个工具的核心接口。Runtime 层通过 convertTools() 将其转换为各 SDK 的原生格式。
 *
 * execute 使用 AsyncGenerator 模式：
 *   - yield ToolStreamUpdate — 增量输出（进度、中间结果）
 *   - return ToolResult      — 最终执行结果
 *
 * @example
 * const readTool: ToolDefinition = {
 *   name: 'read',
 *   category: ToolCategory.FileSystem,
 *   description: 'Read file contents',
 *   parameters: z.object({ path: z.string().describe('File path') }),
 *   execute: async function* (params, signal, context) {
 *     const safePath = assertSandboxPath(params.path as string, context)
 *     const content = await readFile(safePath, 'utf-8')
 *     return { success: true, llmContent: content }
 *   }
 * }
 */
export interface ToolDefinition {
  /** 工具名称（唯一标识，LLM 调用时使用） */
  name: string;

  /** 工具描述（LLM 用于决策是否调用） */
  description: string;

  /** 工具功能分类 */
  category: ToolCategory;

  /**
   * 参数 Zod Schema
   *
   * 所有工具参数使用 Zod 定义，Runtime 层根据需要转换：
   *   - OpenAI SDK: 直接传给 tool()（原生支持 Zod）
   *   - PiMono SDK: 通过 z.toJSONSchema() 转换为 JSON Schema
   */
  parameters: ToolParametersSchema;

  /**
   * 是否需要用户确认后才能执行（HITL 声明式元数据）
   *
   * - true: 上层 HITL 机制会在执行前请求用户审批
   * - false/undefined: 直接执行
   *
   * 注意：实际审批逻辑由 Runtime 的 HITL 层处理，工具本身不实现审批。
   */
  needUserConfirm?: boolean;

  /**
   * 执行函数（AsyncGenerator）
   *
   * @param params  - LLM 传入的工具参数
   * @param signal  - 可选的取消信号（用户取消、超时等）
   * @param context - 执行上下文（工作区/沙箱信息，由 Runtime 注入）
   * @yields ToolStreamUpdate - 执行过程中的增量输出
   * @returns ToolResult - 最终执行结果
   */
  execute: (
    params: Record<string, unknown>,
    signal?: AbortSignal,
    context?: ToolExecutionContext
  ) => AsyncGenerator<ToolStreamUpdate, ToolResult, unknown>;
}
