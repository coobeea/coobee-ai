/**
 * RelayWorkflow 单元测试
 */

import { describe, it, expect } from 'vitest';
import { RelayWorkflow } from '../RelayWorkflow';
import type { RelayWorkflowDefinition } from '../types';

describe('RelayWorkflow', () => {
  const mockWorkflow: RelayWorkflowDefinition = {
    name: '软件开发流程',
    description: '从需求分析到部署的完整流程',
    stages: [
      {
        name: '需求分析',
        agentId: 'analyst',
        instructions: '分析需求并输出功能列表'
      },
      {
        name: '架构设计',
        agentId: 'architect',
        instructions: '设计系统架构'
      },
      {
        name: '代码实现',
        agentId: 'developer',
        instructions: '实现代码'
      },
      {
        name: '测试验证',
        agentId: 'tester',
        instructions: '编写并执行测试'
      }
    ]
  };

  describe('Task initialization', () => {
    it('should create relay task with stages', async () => {
      const workflow = new RelayWorkflow(mockWorkflow);
      const task = await workflow.start('用户需要一个登录功能');

      expect(task.description).toBe('软件开发流程');
      expect(task.totalStages).toBe(4);
      expect(task.currentStage).toBe(0);
      expect(task.status).toBe('pending');

      const stages = workflow.getStages();
      expect(stages.length).toBe(4);
      expect(stages[0].name).toBe('需求分析');
    });
  });

  describe('Stage execution', () => {
    it('should execute single stage', async () => {
      const workflow = new RelayWorkflow(mockWorkflow);
      await workflow.start('测试输入');

      const stage = await workflow.executeNextStage();

      expect(stage).not.toBeNull();
      expect(stage?.status).toBe('completed');
      expect(stage?.output).toBeDefined();
      expect(stage?.completedAt).toBeDefined();
    });

    it('should pass output to next stage', async () => {
      const workflow = new RelayWorkflow(mockWorkflow);
      await workflow.start('测试输入');

      await workflow.executeNextStage();
      const stages = workflow.getStages();

      expect(stages[0].output).toBeDefined();
      expect(stages[1].input).toBe(stages[0].output);
    });

    it('should execute all stages sequentially', async () => {
      const workflow = new RelayWorkflow(mockWorkflow);
      const task = await workflow.executeAll('实现用户登录');

      expect(task.status).toBe('completed');
      expect(task.currentStage).toBe(4);

      const stages = workflow.getStages();
      expect(stages.every((s) => s.status === 'completed')).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('should handle stage failure', async () => {
      const faultyWorkflow: RelayWorkflowDefinition = {
        name: 'Test workflow',
        description: 'Test',
        stages: [
          {
            name: 'Stage 1',
            agentId: 'agent-1',
            instructions: 'Do something'
          }
        ]
      };

      const workflow = new RelayWorkflow(faultyWorkflow);
      await workflow.start('Test input');

      const stage = await workflow.executeNextStage();
      expect(stage).not.toBeNull();
    });
  });

  describe('Current stage tracking', () => {
    it('should track current stage correctly', async () => {
      const workflow = new RelayWorkflow(mockWorkflow);
      await workflow.start('Test');

      let current = workflow.getCurrentStage();
      expect(current?.index).toBe(0);

      await workflow.executeNextStage();

      current = workflow.getCurrentStage();
      expect(current?.index).toBe(1);
    });

    it('should return null when all stages complete', async () => {
      const workflow = new RelayWorkflow(mockWorkflow);
      await workflow.executeAll('Test');

      const current = workflow.getCurrentStage();
      expect(current).toBeNull();
    });
  });
});
