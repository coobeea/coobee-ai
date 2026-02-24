/**
 * 角色注册表
 *
 * 管理所有可用的 Agent 角色（内置 + 自定义）
 */

import type { AgentRole, RoleRegistryEntry } from '../types';
import { builtinRoles } from './builtin';

export { builtinRoles, builtinRoleMap } from './builtin';
export { coderRole, researcherRole, reviewerRole, writerRole, analystRole } from './builtin';

/**
 * 角色注册表
 */
export class RoleRegistry {
  /** 注册表：roleId -> RoleRegistryEntry */
  private registry = new Map<string, RoleRegistryEntry>();

  constructor() {
    // 自动注册内置角色
    this.registerBuiltinRoles();
  }

  /**
   * 注册内置角色
   */
  private registerBuiltinRoles(): void {
    for (const role of builtinRoles) {
      this.registry.set(role.id, {
        role,
        builtin: true,
        registeredAt: Date.now()
      });
    }
  }

  /**
   * 注册自定义角色
   * @param role 角色定义
   * @throws 如果角色 ID 已被内置角色占用
   */
  register(role: AgentRole): void {
    const existing = this.registry.get(role.id);
    if (existing && existing.builtin) {
      throw new Error(`Cannot override builtin role: ${role.id}`);
    }

    this.registry.set(role.id, {
      role,
      builtin: false,
      registeredAt: Date.now()
    });

    console.log(`[RoleRegistry] Registered custom role: ${role.id}`);
  }

  /**
   * 批量注册自定义角色
   */
  registerAll(roles: AgentRole[]): void {
    for (const role of roles) {
      this.register(role);
    }
  }

  /**
   * 注销自定义角色
   * @param roleId 角色 ID
   * @throws 如果尝试注销内置角色
   */
  unregister(roleId: string): boolean {
    const entry = this.registry.get(roleId);
    if (!entry) {
      return false;
    }

    if (entry.builtin) {
      throw new Error(`Cannot unregister builtin role: ${roleId}`);
    }

    this.registry.delete(roleId);
    console.log(`[RoleRegistry] Unregistered custom role: ${roleId}`);
    return true;
  }

  /**
   * 获取角色
   */
  getRole(roleId: string): AgentRole | undefined {
    return this.registry.get(roleId)?.role;
  }

  /**
   * 获取所有角色
   */
  getAllRoles(): AgentRole[] {
    return Array.from(this.registry.values()).map((entry) => entry.role);
  }

  /**
   * 获取指定 ID 列表的角色
   */
  getRoles(roleIds: string[]): AgentRole[] {
    return roleIds.map((id) => this.getRole(id)).filter((role): role is AgentRole => role !== undefined);
  }

  /**
   * 获取内置角色
   */
  getBuiltinRoles(): AgentRole[] {
    return Array.from(this.registry.values())
      .filter((entry) => entry.builtin)
      .map((entry) => entry.role);
  }

  /**
   * 获取自定义角色
   */
  getCustomRoles(): AgentRole[] {
    return Array.from(this.registry.values())
      .filter((entry) => !entry.builtin)
      .map((entry) => entry.role);
  }

  /**
   * 根据能力标签匹配角色
   * @param capabilities 需要的能力列表
   * @returns 匹配的角色列表（按匹配度排序）
   */
  matchByCapabilities(capabilities: string[]): AgentRole[] {
    const capSet = new Set(capabilities.map((c) => c.toLowerCase()));

    const scored = Array.from(this.registry.values()).map((entry) => {
      const matchCount = entry.role.capabilities.filter((c) => capSet.has(c.toLowerCase())).length;
      return { role: entry.role, score: matchCount };
    });

    return scored
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.role);
  }

  /**
   * 检查角色是否存在
   */
  has(roleId: string): boolean {
    return this.registry.has(roleId);
  }

  /**
   * 获取角色数量
   */
  get size(): number {
    return this.registry.size;
  }

  /**
   * 清空所有自定义角色
   */
  clearCustomRoles(): void {
    for (const [roleId, entry] of this.registry.entries()) {
      if (!entry.builtin) {
        this.registry.delete(roleId);
      }
    }
  }
}
