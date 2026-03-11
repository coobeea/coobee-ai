/**
 * RelayWorkflow - 接力工作流
 *
 * 管理多阶段接力任务，每个阶段由不同的 Agent 完成
 */

import { createLogger } from '@main/common/logger';
import type { RelayTask, RelayStage, RelayWorkflowDefinition } from './types';

const log = createLogger('relay-workflow');

export class RelayWorkflow {
  private workflow: RelayWorkflowDefinition;
  private task!: RelayTask;
  private stages: RelayStage[] = [];

  constructor(workflow: RelayWorkflowDefinition) {
    this.workflow = workflow;
  }

  /**
   * 启动接力任务
   */
  async start(initialInput: string): Promise<RelayTask> {
    const now = Date.now();
    const taskId = `relay-${now}-${Math.random().toString(36).slice(2, 8)}`;

    this.task = {
      id: taskId,
      description: this.workflow.name,
      currentStage: 0,
      totalStages: this.workflow.stages.length,
      status: 'pending',
      createdAt: now
    };

    this.stages = this.workflow.stages.map((stageDef, index) => ({
      index,
      name: stageDef.name,
      agentId: stageDef.agentId,
      input: index === 0 ? initialInput : '',
      status: 'pending'
    }));

    log.info(`[RelayWorkflow] Started relay task: ${taskId} with ${this.stages.length} stages`);

    return this.task;
  }

  /**
   * 执行下一阶段
   */
  async executeNextStage(): Promise<RelayStage | null> {
    const currentIndex = this.task.currentStage;

    if (currentIndex >= this.stages.length) {
      log.info(`[RelayWorkflow] All stages completed for task ${this.task.id}`);
      this.task.status = 'completed';
      return null;
    }

    const stage = this.stages[currentIndex];
    stage.status = 'running';
    stage.startedAt = Date.now();
    this.task.status = 'running';

    log.info(
      `[RelayWorkflow] Executing stage ${currentIndex + 1}/${this.stages.length}: ${stage.name} (${stage.agentId})`
    );

    try {
      const output = await this.executeStage(stage);

      stage.output = output;
      stage.status = 'completed';
      stage.completedAt = Date.now();

      if (currentIndex + 1 < this.stages.length) {
        this.stages[currentIndex + 1].input = output;
      }

      this.task.currentStage++;

      return stage;
    } catch (err) {
      stage.status = 'failed';
      stage.error = err instanceof Error ? err.message : String(err);
      this.task.status = 'failed';

      log.error(`[RelayWorkflow] Stage ${currentIndex} failed:`, err);
      throw err;
    }
  }

  /**
   * 执行单个阶段
   */
  private async executeStage(stage: RelayStage): Promise<string> {
    const stageDef = this.workflow.stages[stage.index];

    log.debug(`[RelayWorkflow] Executing stage: ${stage.name}`);

    const prompt = `${stageDef.instructions}

## 输入

${stage.input}

## 要求

请完成你负责的部分，并将结果交接给下一阶段。`;

    const mockOutput = `[${stage.name}] 处理完成。\n\n基于输入：\n${stage.input.slice(0, 100)}\n\n我已完成${stage.name}阶段的工作。交接给下一阶段。\n\n（提示词长度: ${prompt.length}）`;

    await new Promise((resolve) => setTimeout(resolve, 100));

    return mockOutput;
  }

  /**
   * 执行所有阶段（自动接力）
   */
  async executeAll(initialInput: string): Promise<RelayTask> {
    await this.start(initialInput);

    while (this.task.currentStage < this.stages.length) {
      await this.executeNextStage();
    }

    log.info(`[RelayWorkflow] Relay task ${this.task.id} completed`);
    return this.task;
  }

  /**
   * 获取任务状态
   */
  getTask(): RelayTask {
    return { ...this.task };
  }

  /**
   * 获取所有阶段
   */
  getStages(): RelayStage[] {
    return [...this.stages];
  }

  /**
   * 获取当前阶段
   */
  getCurrentStage(): RelayStage | null {
    if (this.task.currentStage >= this.stages.length) return null;
    return this.stages[this.task.currentStage];
  }
}
