/**
 * 内置工具
 *
 * 使用统一 ToolDefinition 格式定义，可被任何 Runtime（OpenAI / PiMono）使用。
 *
 * 工具 execute 使用 AsyncGenerator 模式：
 *   - yield ToolStreamUpdate — 增量输出（进度、中间结果）
 *   - return ToolResult      — 最终执行结果
 *
 * 工具只包含纯执行逻辑，不含审批/HITL 逻辑。
 * 审批由上层 Runtime 的 HITL 机制统一处理。
 */
import type { ToolDefinition } from '../types';
import { readTool } from './read';
import { writeTool } from './write';
import { editTool } from './edit';
import { execTool } from './exec';
import { processTool } from './process';
import { memoryTool } from './memory';
import { searchTool } from './search';
import { globTool } from './glob';
import { skillListTool } from './skill_list';
import { delegateToAgentTool } from './delegate-to-agent';
import { taskPlanTool } from './task-plan';
import { todoWriteTool } from './todo-write';
import { emitEventTool } from './emit-event';
import { switchExecutionModeTool } from './switch-execution-mode';

// 单独导出
export { readTool } from './read';
export { writeTool } from './write';
export { editTool } from './edit';
export { execTool } from './exec';
export { processTool } from './process';
export { memoryTool } from './memory';
export { searchTool } from './search';
export { globTool } from './glob';
export { skillListTool } from './skill_list';
export { delegateToAgentTool } from './delegate-to-agent';
export { taskPlanTool } from './task-plan';
export { todoWriteTool } from './todo-write';
export { emitEventTool } from './emit-event';
export { switchExecutionModeTool } from './switch-execution-mode';

/**
 * 所有内置工具
 *
 * 按功能分组：
 *   --- 文件操作 ---
 *   read           — 只读，低风险
 *   write          — 写文件，中风险
 *   edit           — 编辑文件，中风险
 *   --- 执行 ---
 *   exec           — 执行命令，高风险
 *   process        — 管理后台进程，中风险
 *   --- 记忆 ---
 *   memory         — 记忆管理，低风险
 *   --- 搜索 ---
 *   search          — 文件内容搜索，低风险
 *   glob            — 文件名搜索，低风险
 *   --- 发现 ---
 *   skill_list      — Skill 发现，低风险
 *   --- Agent 管理 ---
 *   delegate_to_agent   — 委托子任务给专业 Agent，中风险
 *   task_plan           — 任务计划管理，低风险
 *   todo_write          — 会话级 TODO 管理，低风险
 *   --- 事件 ---
 *   emit_event          — 向 UI 发送事件（打开预览、通知等），低风险
 *   --- 模式切换 ---
 *   switch_execution_mode — 切换执行模式（Agent 自主判断任务类型），低风险
 *
 * 已迁移到 Skills：
 *   - session_status, session_history, context_inspect → observability Skill
 *   - config_get, config_patch → config-manager Skill
 */
export const builtinTools: ToolDefinition[] = [
  readTool,
  writeTool,
  editTool,
  execTool,
  processTool,
  memoryTool,
  searchTool,
  globTool,
  skillListTool,
  delegateToAgentTool,
  taskPlanTool,
  todoWriteTool,
  emitEventTool,
  switchExecutionModeTool
];
