/**
 * 供应商计费模式配置测试
 *
 * 验证 Provider 的 billingMode 字段：
 *   - pay-as-you-go（按量计费）
 *   - subscription（订阅计费）
 */
import { describe, it, expect } from 'vitest';
import { CoobeeConfigSchema } from '../schema';

describe('Provider billingMode 配置', () => {
  it('默认为 pay-as-you-go', () => {
    const config = CoobeeConfigSchema.parse({
      models: {
        providers: {
          test: {
            baseUrl: 'https://api.test.com',
            models: []
          }
        }
      }
    });

    expect(config.models?.providers?.test?.billingMode).toBe('pay-as-you-go');
  });

  it('支持 subscription 计费模式', () => {
    const config = CoobeeConfigSchema.parse({
      models: {
        providers: {
          test: {
            baseUrl: 'https://api.test.com',
            billingMode: 'subscription',
            models: []
          }
        }
      }
    });

    expect(config.models?.providers?.test?.billingMode).toBe('subscription');
  });

  it('拒绝无效的计费模式', () => {
    expect(() => {
      CoobeeConfigSchema.parse({
        models: {
          providers: {
            test: {
              baseUrl: 'https://api.test.com',
              billingMode: 'invalid-mode',
              models: []
            }
          }
        }
      });
    }).toThrow();
  });

  it('多个 provider 可以有不同的计费模式', () => {
    const config = CoobeeConfigSchema.parse({
      models: {
        providers: {
          provider1: {
            baseUrl: 'https://api1.com',
            billingMode: 'pay-as-you-go',
            models: []
          },
          provider2: {
            baseUrl: 'https://api2.com',
            billingMode: 'subscription',
            models: []
          }
        }
      }
    });

    expect(config.models?.providers?.provider1?.billingMode).toBe('pay-as-you-go');
    expect(config.models?.providers?.provider2?.billingMode).toBe('subscription');
  });
});
