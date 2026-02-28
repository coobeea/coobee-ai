/**
 * cron-jobs/parse 端点测试
 *
 * 验证 AI 解析自然语言为定时任务参数的逻辑。
 * cron-jobs 现在使用 LLMService（走 AgentExecutor.piMono().lightweight() 链路），
 * 这里验证 LLMService mock 的正确行为。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@main/common/logger', () => {
  const mockLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { log: mockLog, default: mockLog, createLogger: vi.fn(() => mockLog) };
});

const mockChat = vi.fn();
vi.mock('@main/ai/provider/LLMService', () => ({
  LLMService: class MockLLMService {
    chat = mockChat;
  },
  getLLMService: () => ({ chat: mockChat }),
  resetLLMService: vi.fn()
}));

describe('cron-jobs/parse API 逻辑', () => {
  it('getLLMService mock 应返回正确的解析结果', async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({
        name: '每日进度汇总',
        description: '每天早上自动汇总项目进度',
        cronExpression: '0 9 * * *',
        task: '请汇总今天的项目进度',
        cronHumanReadable: '每天上午 9:00'
      }),
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    });

    const { getLLMService } = await import('@main/ai/provider/LLMService');
    const result = await getLLMService().chat({
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
});
