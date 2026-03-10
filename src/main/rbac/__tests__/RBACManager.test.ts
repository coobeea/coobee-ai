/**
 * RBACManager 和 TenantManager 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RBACManager } from '../RBACManager';
import { TenantManager } from '../TenantManager';
import type { User, Tenant } from '../types';

describe('RBACManager', () => {
  let rbac: RBACManager;

  beforeEach(() => {
    rbac = new RBACManager();
  });

  describe('Builtin roles', () => {
    it('should have admin role', () => {
      const admin = rbac.getRole('admin');
      expect(admin).toBeDefined();
      expect(admin?.permissions).toContain('*');
    });

    it('should have user role', () => {
      const user = rbac.getRole('user');
      expect(user).toBeDefined();
      expect(user?.permissions).toContain('agent.create');
    });

    it('should have viewer role', () => {
      const viewer = rbac.getRole('viewer');
      expect(viewer).toBeDefined();
      expect(viewer?.permissions).toContain('agent.read');
    });
  });

  describe('User management', () => {
    it('should add user', () => {
      const user: User = {
        id: 'user-1',
        username: 'alice',
        tenantId: 'tenant-1',
        roles: ['user'],
        status: 'active',
        createdAt: Date.now()
      };

      rbac.addUser(user);

      const retrieved = rbac.getUser('user-1');
      expect(retrieved?.username).toBe('alice');
    });

    it('should assign role to user', () => {
      const user: User = {
        id: 'user-1',
        username: 'alice',
        tenantId: 'tenant-1',
        roles: ['user'],
        status: 'active',
        createdAt: Date.now()
      };

      rbac.addUser(user);
      const success = rbac.assignRole('user-1', 'admin');

      expect(success).toBe(true);

      const updated = rbac.getUser('user-1');
      expect(updated?.roles).toContain('admin');
    });
  });

  describe('Access control', () => {
    beforeEach(() => {
      const user: User = {
        id: 'user-1',
        username: 'alice',
        tenantId: 'tenant-1',
        roles: ['user'],
        status: 'active',
        createdAt: Date.now()
      };

      rbac.addUser(user);
    });

    it('should allow permitted action', () => {
      const result = rbac.checkAccess('user-1', 'agent', 'create');

      expect(result.allowed).toBe(true);
    });

    it('should deny unpermitted action', () => {
      const result = rbac.checkAccess('user-1', 'config', 'update');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not granted');
    });

    it('should allow admin all actions', () => {
      rbac.assignRole('user-1', 'admin');

      const result = rbac.checkAccess('user-1', 'anything', 'delete');

      expect(result.allowed).toBe(true);
    });

    it('should deny access to suspended user', () => {
      const user = rbac.getUser('user-1');
      if (user) {
        user.status = 'suspended';
      }

      const result = rbac.checkAccess('user-1', 'agent', 'read');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('suspended');
    });
  });
});

describe('TenantManager', () => {
  let manager: TenantManager;

  beforeEach(() => {
    manager = new TenantManager();
  });

  describe('Tenant creation', () => {
    it('should create tenant with default quota', () => {
      const tenant = manager.createTenant('Acme Corp');

      expect(tenant.name).toBe('Acme Corp');
      expect(tenant.quota.maxAgents).toBe(10);
      expect(tenant.status).toBe('trial');
    });

    it('should create tenant with custom quota', () => {
      const tenant = manager.createTenant('Enterprise Inc', {
        maxAgents: 100,
        maxSessions: 1000
      });

      expect(tenant.quota.maxAgents).toBe(100);
      expect(tenant.quota.maxSessions).toBe(1000);
    });
  });

  describe('Quota management', () => {
    let tenant: Tenant;

    beforeEach(() => {
      tenant = manager.createTenant('Test Tenant');
      manager.updateStatus(tenant.id, 'active');
    });

    it('should check quota availability', () => {
      const canCreateAgent = manager.checkQuota(tenant.id, 'maxAgents');
      expect(canCreateAgent).toBe(true);
    });

    it('should enforce quota limits', () => {
      manager.updateUsage(tenant.id, { agents: 10 });

      const canCreateAgent = manager.checkQuota(tenant.id, 'maxAgents');
      expect(canCreateAgent).toBe(false);
    });

    it('should update usage', () => {
      const success = manager.updateUsage(tenant.id, { agents: 5, sessions: 20 });
      expect(success).toBe(true);

      const updated = manager.getTenant(tenant.id);
      expect(updated?.usage.agents).toBe(5);
      expect(updated?.usage.sessions).toBe(20);
    });
  });

  describe('Tenant status', () => {
    it('should update tenant status', () => {
      const tenant = manager.createTenant('Test Tenant');

      const success = manager.updateStatus(tenant.id, 'active');
      expect(success).toBe(true);

      const updated = manager.getTenant(tenant.id);
      expect(updated?.status).toBe('active');
    });

    it('should block suspended tenant', () => {
      const tenant = manager.createTenant('Test Tenant');
      manager.updateStatus(tenant.id, 'suspended');

      const canCreateAgent = manager.checkQuota(tenant.id, 'maxAgents');
      expect(canCreateAgent).toBe(false);
    });
  });
});
