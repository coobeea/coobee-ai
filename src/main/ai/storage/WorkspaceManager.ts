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
      // 创建基础目录
      // 注意：sessions 目录下的 {sessionId} 子目录由 LLM Runtime (如 FileSession)
      // 在首次写入时根据运行时逻辑创建，或者如果是扁平化则直接在 sessions/ 下。
      mkdirSync(join(workspace, 'sessions'), { recursive: true });
      mkdirSync(join(workspace, 'contexts'), { recursive: true });
      mkdirSync(join(workspace, 'events'), { recursive: true });
      mkdirSync(join(workspace, 'output'), { recursive: true });
      mkdirSync(join(workspace, 'logs'), { recursive: true });

      // 创建可选目录
      if (enableSkills) mkdirSync(join(workspace, 'skills'), { recursive: true });
      if (enableExtensions) mkdirSync(join(workspace, 'extensions'), { recursive: true });
      if (enableMemory) mkdirSync(join(workspace, 'memory'), { recursive: true });

      // 初始化 GOAL.md（子 Agent 也有独立目标，由父 Agent 或系统预填）
      writeFileSync(join(workspace, 'GOAL.md'), '', 'utf-8');

      // 初始化统一的 checkpoint.json
      const checkpoint: AgentCheckpoint = {
        agentId: config.agentName,
        sessionId: config.sessionId,
        status: 'initialized',
        createdAt: new Date().toISOString(),
        metadata: { type: config.type }
      };

      writeFileSync(join(workspace, 'checkpoint.json'), JSON.stringify(checkpoint, null, 2));
    }

    return workspace;
  }

  /**
   * 读取 checkpoint
   */
  static readCheckpoint(workspace: string): AgentCheckpoint | null {
    const checkpointPath = join(workspace, 'checkpoint.json');
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
    const checkpointPath = join(workspace, 'checkpoint.json');
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
