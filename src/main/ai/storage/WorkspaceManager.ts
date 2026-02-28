import { join } from 'node:path';
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';

export interface SubAgentWorkspaceConfig {
  agentName: string; // 格式: 'delegate-coder', 'planner', 'worker-setup-db', 'swarm-reviewer'
  sessionId: string;
  type: 'delegate' | 'worker' | 'swarm' | 'planner' | 'triage';
  threadWorkspace: string; // 顶层 workspaces/{threadId} 路径
  enableSkills?: boolean;
  enableExtensions?: boolean;
  enableMemory?: boolean;
}

export interface AgentCheckpoint {
  agentId: string;
  sessionId: string;
  status: string;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
  metadata: {
    type: string;
    [key: string]: unknown;
  };
  result?: unknown;
}

export class WorkspaceManager {
  /**
   * 初始化/获取统一的子 Agent 工作空间
   *
   * @param config 工作空间配置
   * @returns 工作空间绝对路径
   */
  static getOrCreateSubAgentWorkspace(config: SubAgentWorkspaceConfig): string {
    const { agentName, threadWorkspace, enableSkills, enableExtensions, enableMemory } = config;

    // 统一落在顶层的 agents/ 目录下
    const workspace = join(threadWorkspace, 'agents', agentName);

    if (!existsSync(workspace)) {
      // 用户空间
      mkdirSync(join(workspace, 'user', 'output'), { recursive: true });
      if (enableSkills) mkdirSync(join(workspace, 'user', 'skills'), { recursive: true });

      // 系统空间
      mkdirSync(join(workspace, '.runtime', 'sessions'), { recursive: true });
      mkdirSync(join(workspace, '.runtime', 'contexts'), { recursive: true });
      mkdirSync(join(workspace, '.runtime', 'events'), { recursive: true });
      mkdirSync(join(workspace, '.runtime', 'logs'), { recursive: true });

      // 可选目录
      if (enableExtensions) mkdirSync(join(workspace, 'extensions'), { recursive: true });
      if (enableMemory) mkdirSync(join(workspace, 'memory'), { recursive: true });

      // 标准文件
      writeFileSync(join(workspace, 'GOAL.md'), '', 'utf-8');

      const checkpoint: AgentCheckpoint = {
        agentId: config.agentName,
        sessionId: config.sessionId,
        status: 'initialized',
        createdAt: new Date().toISOString(),
        metadata: { type: config.type }
      };

      writeFileSync(join(workspace, '.runtime', 'checkpoint.json'), JSON.stringify(checkpoint, null, 2));
    }

    return workspace;
  }

  /**
   * 读取 checkpoint
   */
  static readCheckpoint(workspace: string): AgentCheckpoint | null {
    const checkpointPath = join(workspace, '.runtime', 'checkpoint.json');
    if (!existsSync(checkpointPath)) return null;
    try {
      return JSON.parse(readFileSync(checkpointPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  /**
   * 更新 checkpoint
   */
  static updateCheckpoint(workspace: string, updates: Partial<AgentCheckpoint>): void {
    const checkpointPath = join(workspace, '.runtime', 'checkpoint.json');
    if (!existsSync(checkpointPath)) return;

    try {
      const current = JSON.parse(readFileSync(checkpointPath, 'utf-8'));
      const updated = {
        ...current,
        ...updates,
        updatedAt: new Date().toISOString()
      };
      writeFileSync(checkpointPath, JSON.stringify(updated, null, 2));
    } catch {
      // 忽略读取错误
    }
  }
}
