/**
 * RBACManager - 基于角色的访问控制管理器
 */

import { createLogger } from '@main/common/logger';
import type { User, Role, Permission, AccessCheckResult } from './types';

const log = createLogger('rbac-manager');

export class RBACManager {
  private users = new Map<string, User>();
  private roles = new Map<string, Role>();
  private permissions = new Map<string, Permission>();

  constructor() {
    this.initializeBuiltinRoles();
  }

  /**
   * 初始化内置角色
   */
  private initializeBuiltinRoles(): void {
    const adminRole: Role = {
      id: 'admin',
      name: 'Administrator',
      description: '系统管理员，拥有所有权限',
      permissions: ['*'],
      builtin: true
    };

    const userRole: Role = {
      id: 'user',
      name: 'User',
      description: '普通用户，可以创建和管理自己的 Agent',
      permissions: ['agent.create', 'agent.read', 'agent.update', 'agent.delete', 'task.create', 'task.read'],
      builtin: true
    };

    const viewerRole: Role = {
      id: 'viewer',
      name: 'Viewer',
      description: '只读用户，只能查看',
      permissions: ['agent.read', 'task.read'],
      builtin: true
    };

    this.roles.set(adminRole.id, adminRole);
    this.roles.set(userRole.id, userRole);
    this.roles.set(viewerRole.id, viewerRole);

    log.info('[RBACManager] Initialized with builtin roles');
  }

  /**
   * 添加用户
   */
  addUser(user: User): void {
    this.users.set(user.id, user);
    log.info(`[RBACManager] User added: ${user.username} (${user.roles.join(', ')})`);
  }

  /**
   * 添加角色
   */
  addRole(role: Role): void {
    if (role.builtin) {
      log.warn(`[RBACManager] Cannot modify builtin role: ${role.id}`);
      return;
    }

    this.roles.set(role.id, role);
    log.info(`[RBACManager] Role added: ${role.name}`);
  }

  /**
   * 添加权限
   */
  addPermission(permission: Permission): void {
    this.permissions.set(permission.id, permission);
    log.info(`[RBACManager] Permission added: ${permission.id}`);
  }

  /**
   * 检查用户权限
   */
  checkAccess(userId: string, resource: string, action: string): AccessCheckResult {
    const user = this.users.get(userId);

    if (!user) {
      return {
        allowed: false,
        reason: 'User not found'
      };
    }

    if (user.status !== 'active') {
      return {
        allowed: false,
        reason: 'User is suspended'
      };
    }

    const permissionId = `${resource}.${action}`;
    const userRoles: string[] = [];

    for (const roleId of user.roles) {
      const role = this.roles.get(roleId);
      if (!role) continue;

      userRoles.push(role.name);

      if (role.permissions.includes('*')) {
        return {
          allowed: true,
          roles: userRoles
        };
      }

      if (role.permissions.includes(permissionId)) {
        return {
          allowed: true,
          roles: userRoles
        };
      }
    }

    return {
      allowed: false,
      reason: `Permission ${permissionId} not granted`,
      roles: userRoles
    };
  }

  /**
   * 为用户分配角色
   */
  assignRole(userId: string, roleId: string): boolean {
    const user = this.users.get(userId);
    const role = this.roles.get(roleId);

    if (!user || !role) {
      log.warn(`[RBACManager] Cannot assign role: user or role not found`);
      return false;
    }

    if (!user.roles.includes(roleId)) {
      user.roles.push(roleId);
      log.info(`[RBACManager] Assigned role ${role.name} to user ${user.username}`);
    }

    return true;
  }

  /**
   * 移除用户角色
   */
  removeRole(userId: string, roleId: string): boolean {
    const user = this.users.get(userId);

    if (!user) return false;

    user.roles = user.roles.filter((r) => r !== roleId);
    log.info(`[RBACManager] Removed role ${roleId} from user ${user.username}`);

    return true;
  }

  /**
   * 获取用户
   */
  getUser(userId: string): User | undefined {
    return this.users.get(userId);
  }

  /**
   * 获取角色
   */
  getRole(roleId: string): Role | undefined {
    return this.roles.get(roleId);
  }

  /**
   * 列出所有角色
   */
  listRoles(): Role[] {
    return Array.from(this.roles.values());
  }

  /**
   * 列出所有用户
   */
  listUsers(tenantId?: string): User[] {
    let users = Array.from(this.users.values());

    if (tenantId) {
      users = users.filter((u) => u.tenantId === tenantId);
    }

    return users;
  }
}
