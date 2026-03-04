/**
 * Relay Types
 *
 * 接力协作类型定义
 */

/**
 * 接力任务
 */
export interface RelayTask {
  /** 任务 ID */
  id: string;

  /** 任务描述 */
  description: string;

  /** 当前阶段 */
  currentStage: number;

  /** 总阶段数 */
  totalStages: number;

  /** 任务状态 */
  status: 'pending' | 'running' | 'completed' | 'failed';

  /** 创建时间 */
  createdAt: number;
}

/**
 * 接力阶段
 */
export interface RelayStage {
  /** 阶段序号（从 0 开始） */
  index: number;

  /** 阶段名称 */
  name: string;

  /** 负责的 Agent ID */
  agentId: string;

  /** 输入（来自上一阶段） */
  input: string;

  /** 输出（传递给下一阶段） */
  output?: string;

  /** 阶段状态 */
  status: 'pending' | 'running' | 'completed' | 'failed';

  /** 开始时间 */
  startedAt?: number;

  /** 完成时间 */
  completedAt?: number;

  /** 错误信息 */
  error?: string;
}

/**
 * 接力工作流定义
 */
export interface RelayWorkflowDefinition {
  /** 工作流名称 */
  name: string;

  /** 描述 */
  description: string;

  /** 阶段定义 */
  stages: Array<{
    name: string;
    agentId: string;
    instructions: string;
  }>;
}
