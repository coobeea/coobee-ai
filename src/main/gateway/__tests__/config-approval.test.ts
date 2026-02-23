/**
 * config approval 方法测试
 *
 * 验证：
 *   1. 读取审批策略配置
 *   2. 更新审批策略配置
 *   3. 配置值校验
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configMethods } from '../methods/config';
import { GatewayMethodError } from '../protocol';
import type { MethodContext } from '../protocol';

// Mock ConfigStore
const mockConfigStore = {
  get: vi.fn(),
  set: vi.fn(),
  patch: vi.fn(),
  getAll: vi.fn()
};

vi.mock('@main/common/config/ConfigStore', () => ({
  configStoreInstance: mockConfigStore
}));

// Mock MethodContext
const mockContext = {} as MethodContext;

describe('config.getAll - 审批策略', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应该能获取审批策略配置', async () => {
    mockConfigStore.getAll.mockReturnValue({
      security: {
        approvals: {
          exec: 'auto',
          timeoutMs: 300000
        },
        sandbox: {
          mode: 'path-only'
        }
      },
      models: { providers: {} }
    });

    const result = await configMethods.methods.getAll({}, mockContext);

    expect(result).toBeDefined();
    const typedResult = result as Record<string, unknown>;
    const security = typedResult.security as Record<string, unknown> | undefined;
    const approvals = security?.approvals as Record<string, unknown> | undefined;
    expect(approvals?.exec).toBe('auto');
    expect(approvals?.timeoutMs).toBe(300000);
  });

  it('应该能获取 never 审批策略', async () => {
    mockConfigStore.getAll.mockReturnValue({
      security: {
        approvals: {
          exec: 'never'
        }
      },
      models: { providers: {} }
    });

    const result = await configMethods.methods.getAll({}, mockContext);

    const typedResult = result as Record<string, unknown>;
    const security = typedResult.security as Record<string, unknown> | undefined;
    const approvals = security?.approvals as Record<string, unknown> | undefined;
    expect(approvals?.exec).toBe('never');
  });

  it('应该能获取 always 审批策略', async () => {
    mockConfigStore.getAll.mockReturnValue({
      security: {
        approvals: {
          exec: 'always'
        }
      },
      models: { providers: {} }
    });

    const result = await configMethods.methods.getAll({}, mockContext);

    const typedResult = result as Record<string, unknown>;
    const security = typedResult.security as Record<string, unknown> | undefined;
    const approvals = security?.approvals as Record<string, unknown> | undefined;
    expect(approvals?.exec).toBe('always');
  });
});

describe('config.patch - 审批策略', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应该能更新审批策略为 never', async () => {
    const result = await configMethods.methods.patch(
      {
        partial: {
          security: {
            approvals: {
              exec: 'never'
            }
          }
        }
      },
      mockContext
    );

    expect(mockConfigStore.patch).toHaveBeenCalledWith({
      security: {
        approvals: {
          exec: 'never'
        }
      }
    });
    const typedResult = result as Record<string, unknown>;
    expect(typedResult.success).toBe(true);
  });

  it('应该能更新审批策略为 always', async () => {
    const result = await configMethods.methods.patch(
      {
        partial: {
          security: {
            approvals: {
              exec: 'always'
            }
          }
        }
      },
      mockContext
    );

    expect(mockConfigStore.patch).toHaveBeenCalledWith({
      security: {
        approvals: {
          exec: 'always'
        }
      }
    });
    const typedResult = result as Record<string, unknown>;
    expect(typedResult.success).toBe(true);
  });

  it('应该能更新审批策略为 auto', async () => {
    const result = await configMethods.methods.patch(
      {
        partial: {
          security: {
            approvals: {
              exec: 'auto'
            }
          }
        }
      },
      mockContext
    );

    expect(mockConfigStore.patch).toHaveBeenCalledWith({
      security: {
        approvals: {
          exec: 'auto'
        }
      }
    });
    const typedResult = result as Record<string, unknown>;
    expect(typedResult.success).toBe(true);
  });

  it('应该能同时更新多个配置项', async () => {
    const result = await configMethods.methods.patch(
      {
        partial: {
          security: {
            approvals: {
              exec: 'never',
              timeoutMs: 600000
            },
            sandbox: {
              mode: 'off'
            }
          },
          models: {
            defaults: {
              thinkingLevel: 'high'
            }
          }
        }
      },
      mockContext
    );

    expect(mockConfigStore.patch).toHaveBeenCalled();
    const typedResult = result as Record<string, unknown>;
    expect(typedResult.success).toBe(true);
  });

  it('缺少 partial 参数时应该抛出错误', async () => {
    await expect(configMethods.methods.patch({}, mockContext)).rejects.toThrow(GatewayMethodError);
    await expect(configMethods.methods.patch({}, mockContext)).rejects.toThrow('partial object is required');
  });
});
