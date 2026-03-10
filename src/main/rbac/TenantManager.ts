/**
 * TenantManager - 租户管理器
 */

import { createLogger } from '@main/common/logger';
import type { Tenant } from './types';

const log = createLogger('tenant-manager');

export class TenantManager {
  private tenants = new Map<string, Tenant>();

  /**
   * 创建租户
   */
  createTenant(name: string, quota?: Partial<Tenant['quota']>): Tenant {
    const id = `tenant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const tenant: Tenant = {
      id,
      name,
      quota: {
        maxAgents: quota?.maxAgents || 10,
        maxSessions: quota?.maxSessions || 100,
        maxTokensPerDay: quota?.maxTokensPerDay || 100000
      },
      usage: {
        agents: 0,
        sessions: 0,
        tokensToday: 0
      },
      status: 'trial',
      createdAt: Date.now()
    };

    this.tenants.set(id, tenant);

    log.info(`[TenantManager] Created tenant: ${name} (${id})`);

    return tenant;
  }

  /**
   * 获取租户
   */
  getTenant(tenantId: string): Tenant | undefined {
    return this.tenants.get(tenantId);
  }

  /**
   * 更新使用量
   */
  updateUsage(tenantId: string, updates: Partial<Tenant['usage']>): boolean {
    const tenant = this.tenants.get(tenantId);

    if (!tenant) {
      log.warn(`[TenantManager] Tenant ${tenantId} not found`);
      return false;
    }

    if (updates.agents !== undefined) tenant.usage.agents = updates.agents;
    if (updates.sessions !== undefined) tenant.usage.sessions = updates.sessions;
    if (updates.tokensToday !== undefined) tenant.usage.tokensToday = updates.tokensToday;

    return true;
  }

  /**
   * 检查配额
   */
  checkQuota(tenantId: string, resource: keyof Tenant['quota']): boolean {
    const tenant = this.tenants.get(tenantId);

    if (!tenant) return false;

    if (tenant.status !== 'active' && tenant.status !== 'trial') {
      return false;
    }

    const usageKey = resource === 'maxAgents' ? 'agents' : resource === 'maxSessions' ? 'sessions' : 'tokensToday';

    return tenant.usage[usageKey] < tenant.quota[resource];
  }

  /**
   * 更新租户状态
   */
  updateStatus(tenantId: string, status: Tenant['status']): boolean {
    const tenant = this.tenants.get(tenantId);

    if (!tenant) return false;

    tenant.status = status;
    log.info(`[TenantManager] Tenant ${tenantId} status: ${status}`);

    return true;
  }

  /**
   * 列出所有租户
   */
  listTenants(): Tenant[] {
    return Array.from(this.tenants.values()).sort((a, b) => b.createdAt - a.createdAt);
  }
}
