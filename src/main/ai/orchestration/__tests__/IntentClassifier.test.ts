import { describe, it, expect } from 'vitest';
import { IntentClassifier } from '../IntentClassifier';

describe('IntentClassifier', () => {
  const classifier = new IntentClassifier();

  describe('简单对话（simple-chat）', () => {
    it('应该识别问候语', async () => {
      const testCases = ['你好', 'hi', 'Hello', '早上好', '晚上好', '谢谢', '再见'];

      for (const message of testCases) {
        const result = await classifier.classify(message);
        expect(result.type).toBe('simple-chat');
        expect(result.needsOrchestration).toBe(false);
        expect(result.confidence).toBeGreaterThan(0.9);
      }
    });

    it('应该识别短消息', async () => {
      const testCases = ['好的', '嗯', '是的', '不是'];

      for (const message of testCases) {
        const result = await classifier.classify(message);
        expect(result.type).toBe('simple-chat');
        expect(result.needsOrchestration).toBe(false);
      }
    });
  });

  describe('简单查询（simple-query）', () => {
    it('应该识别时间查询', async () => {
      const testCases = ['现在几点', '今天日期', '明天星期几'];

      for (const message of testCases) {
        const result = await classifier.classify(message);
        expect(result.type).toBe('simple-query');
        expect(result.needsOrchestration).toBe(false);
      }
    });

    it('应该识别天气查询', async () => {
      const testCases = ['今天天气', '明天温度', '后天天气怎么样'];

      for (const message of testCases) {
        const result = await classifier.classify(message);
        expect(result.type).toBe('simple-query');
        expect(result.needsOrchestration).toBe(false);
      }
    });

    it('应该识别简单搜索', async () => {
      const testCases = ['帮我查一下 TypeScript', '搜索一下 React', '什么是闭包'];

      for (const message of testCases) {
        const result = await classifier.classify(message);
        expect(['simple-query', 'simple-chat']).toContain(result.type);
        expect(result.needsOrchestration).toBe(false);
      }
    });
  });

  describe('复杂任务（complex-task）', () => {
    it('应该识别多步骤任务', async () => {
      const message = '首先帮我创建一个 Vue 项目，然后添加 TypeScript 支持，最后配置 ESLint';
      const result = await classifier.classify(message);

      expect(result.type).toBe('complex-task');
      expect(result.needsOrchestration).toBe(true);
      expect(result.reason).toContain('多步骤');
    });

    it('应该识别开发任务', async () => {
      const message = '帮我开发一个音乐播放器，需要实现播放、暂停、切换歌曲的功能';
      const result = await classifier.classify(message);

      expect(result.type).toBe('complex-task');
      expect(result.needsOrchestration).toBe(true);
    });

    it('应该识别项目任务', async () => {
      const message = '创建一个电商系统，包括用户管理、商品管理、订单管理';
      const result = await classifier.classify(message);

      expect(result.type).toBe('complex-task');
      expect(result.needsOrchestration).toBe(true);
    });

    it('应该识别长文本任务', async () => {
      const message =
        '我需要一个博客系统，用户可以发布文章、评论、点赞，管理员可以审核内容，还需要支持 Markdown 编辑器和图片上传功能';
      const result = await classifier.classify(message);

      expect(result.type).toBe('complex-task');
      expect(result.needsOrchestration).toBe(true);
    });
  });

  describe('边界情况', () => {
    it('应该处理空消息', async () => {
      const result = await classifier.classify('');
      expect(result.needsOrchestration).toBe(false);
    });

    it('应该处理纯空格', async () => {
      const result = await classifier.classify('   ');
      expect(result.needsOrchestration).toBe(false);
    });

    it('应该处理中等长度的技术问题', async () => {
      const message = '如何在 React 中使用 Context API';
      const result = await classifier.classify(message);

      // 这种情况可能是简单查询或复杂任务，取决于具体实现
      expect(['simple-query', 'complex-task']).toContain(result.type);
    });
  });

  describe('复杂度评分', () => {
    it('应该给多步骤任务高分', async () => {
      const message = '第一步创建项目，第二步配置工具，第三步部署上线';
      const result = await classifier.classify(message);

      expect(result.type).toBe('complex-task');
      expect(result.reason).toContain('多步骤');
    });

    it('应该给技术任务合适的分数', async () => {
      const message = '使用 Node.js 和 MongoDB 开发一个 REST API';
      const result = await classifier.classify(message);

      expect(result.type).toBe('complex-task');
    });
  });
});
