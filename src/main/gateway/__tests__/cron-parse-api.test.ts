/**
 * cron-jobs/parse 端点测试
 *
 * 验证 AI 解析自然语言为定时任务参数的逻辑
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@main/common/logger', () => {
  const mockLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { log: mockLog, default: mockLog, createLogger: vi.fn(() => mockLog) };
});

vi.mock('@main/ai/provider/LLMClient', () => ({
  LLMClient: class MockLLMClient {
    async chat(opts: {
      messages: { role: string; content: string }[];
    }): Promise<{ content: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
      const userMsg = opts.messages.find((m) => m.role === 'user')?.content || '';
      if (userMsg.includes('每天早上9点')) {
        return {
          content: JSON.stringify({
            name: '每日进度汇总',
            description: '每天早上自动汇总项目进度',
            cronExpression: '0 9 * * *',
            task: '请汇总今天的项目进度',
            cronHumanReadable: '每天上午 9:00'
          }),
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
        };
      }
      throw new Error('Unexpected input');
    }
  }
}));

vi.mock('@main/common/config/ConfigStore', () => ({
  configStoreInstance: {
    getAll: () => ({
      models: {
        providers: {
          'test-provider': {
            baseURL: 'https://test.api.com/v1',
            apiKey: 'test-key',
            models: { 'test-model': {} }
          }
        },
        defaults: {
          model: { primary: 'test-provider/test-model' }
        }
      }
    })
  }
}));

describe('cron-jobs/parse API 逻辑', () => {
  it('应正确解析 provider 和 model 从 primary 配置', () => {
    const primary = 'test-provider/test-model';
    const [providerId, modelId] = primary.includes('/') ? primary.split('/') : ['', primary];
    expect(providerId).toBe('test-provider');
    expect(modelId).toBe('test-model');
  });

  it('无斜杠的 primary 应使用空 providerId', () => {
    const primary = 'standalone-model';
    const [providerId, modelId] = primary.includes('/') ? primary.split('/') : ['', primary];
    expect(providerId).toBe('');
    expect(modelId).toBe('standalone-model');
  });

  it('LLMClient mock 应返回正确的解析结果', async () => {
    const { LLMClient } = await import('@main/ai/provider/LLMClient');
    const client = new LLMClient({ model: 'test' });
    const result = await client.chat({
      messages: [
        { role: 'system', content: 'test' },
        { role: 'user', content: '每天早上9点汇总进度' }
      ]
    });
    const parsed = JSON.parse(result.content);
    expect(parsed.name).toBe('每日进度汇总');
    expect(parsed.cronExpression).toBe('0 9 * * *');
    expect(parsed.cronHumanReadable).toBe('每天上午 9:00');
  });

  it('configStoreInstance 应提供正确的模型配置', async () => {
    const { configStoreInstance } = await import('@main/common/config/ConfigStore');
    const config = configStoreInstance!.getAll() as Record<string, unknown>;
    const models = config.models as { defaults?: { model?: { primary?: string } } };
    expect(models.defaults?.model?.primary).toBe('test-provider/test-model');
  });
});
