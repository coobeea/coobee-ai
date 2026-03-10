/**
 * RBAC Types
 *
 * 基于角色的访问控制类型定义
 */

/**
 * 租户
 */
export interface Tenant {
  /** 租户 ID */
  id: string;

  /** 租户名称 */
  name: string;

  /** 配额 */
  quota: {
    maxAgents: number;
    maxSessions: number;
    maxTokensPerDay: number;
  };

  /** 使用情况 */
  usage: {
    agents: number;
    sessions: number;
    tokensToday: number;
  };

  /** 状态 */
  status: 'active' | 'suspended' | 'trial';

  /** 创建时间 */
  createdAt: number;
}

/**
 * 用户
 */
export interface User {
  /** 用户 ID */
  id: string;

  /** 用户名 */
  username: string;

  /** 租户 ID */
  tenantId: string;

  /** 角色列表 */
  roles: string[];

  /** 状态 */
  status: 'active' | 'suspended';

  /** 创建时间 */
  createdAt: number;
}

/**
 * 角色
 */
export interface Role {
  /** 角色 ID */
  id: string;

  /** 角色名称 */
  name: string;

  /** 描述 */
  description: string;

  /** 权限列表 */
  permissions: string[];

  /** 是否内置角色 */
  builtin: boolean;
}

/**
 * 权限
 */
export interface Permission {
  /** 权限 ID */
  id: string;

  /** 资源类型 */
  resource: string;

  /** 操作 */
  action: 'create' | 'read' | 'update' | 'delete' | 'execute';

  /** 描述 */
  description: string;
}

/**
 * 访问控制结果
 */
export interface AccessCheckResult {
  /** 是否允许 */
  allowed: boolean;

  /** 原因 */
  reason?: string;

  /** 使用的角色 */
  roles?: string[];
}
