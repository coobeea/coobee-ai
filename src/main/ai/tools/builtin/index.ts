/**
 * 内置工具
 *
 * 4 个基础编码工具，使用统一 ToolDefinition 格式定义，
 * 可被任何 Runtime（OpenAI / PiMono）使用。
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
import { bashTool } from './bash'

// 单独导出
export { readTool } from './read'
export { writeTool } from './write'
export { editTool } from './edit'
export { bashTool } from './bash'
// 沙箱工具已迁移到 src/main/ai/sandbox/ — 从那里导入

/**
 * 所有内置工具
 *
 * 按风险等级排列（低 → 高）：
 *   read  — 只读，低风险，needUserConfirm: false
 *   write — 写文件，中风险，needUserConfirm: true
 *   edit  — 编辑文件，中风险，needUserConfirm: true
 *   bash  — 执行命令，高风险，needUserConfirm: true
 */
export const builtinTools: ToolDefinition[] = [readTool, writeTool, editTool, bashTool]
