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
import type { ToolDefinition } from '../types'
import { readTool } from './read'
import { writeTool } from './write'
import { editTool } from './edit'
import { execTool } from './exec'
import { processTool } from './process'
import { memoryTool } from './memory'
import { searchTool } from './search'
import { globTool } from './glob'
import { sessionStatusTool } from './session_status'
import { sessionHistoryTool } from './session_history'
import { contextInspectTool } from './context_inspect'
import { skillListTool } from './skill_list'
import { configPatchTool } from './config_patch'
import { configGetTool } from './config_get'

// 单独导出
export { readTool } from './read'
export { writeTool } from './write'
export { editTool } from './edit'
export { execTool } from './exec'
export { processTool } from './process'
export { memoryTool } from './memory'
export { searchTool } from './search'
export { globTool } from './glob'
export { sessionStatusTool } from './session_status'
export { sessionHistoryTool } from './session_history'
export { contextInspectTool } from './context_inspect'
export { skillListTool } from './skill_list'
export { configPatchTool } from './config_patch'
export { configGetTool } from './config_get'

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
 *   --- 可观测性 ---
 *   session_status  — 会话状态，低风险
 *   session_history — 对话历史，低风险
 *   context_inspect — 上下文查看，低风险
 *   --- 搜索 ---
 *   search          — 文件内容搜索，低风险
 *   glob            — 文件名搜索，低风险
 *   --- 发现 ---
 *   skill_list      — Skill 发现，低风险
 *   --- 配置 ---
 *   config_get      — 查看应用配置，低风险
 *   config_patch    — 修改应用配置，中风险
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
  sessionStatusTool,
  sessionHistoryTool,
  contextInspectTool,
  skillListTool,
  configGetTool,
  configPatchTool
]
