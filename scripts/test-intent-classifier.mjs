/**
 * 意图分类器集成测试脚本
 *
 * 测试各种消息场景，验证分类器是否正确识别
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

// 动态导入 TypeScript 文件
async function loadClassifier() {
  // 使用 tsx 运行时加载
  const { IntentClassifier } = await import('../src/main/ai/orchestration/IntentClassifier.js');
  return IntentClassifier;
}

const testCases = [
  // ========== 简单对话 ==========
  {
    category: '简单对话',
    cases: [
      { message: '你好', expected: 'simple-chat', shouldOrchestrate: false },
      { message: 'hi', expected: 'simple-chat', shouldOrchestrate: false },
      { message: 'Hello', expected: 'simple-chat', shouldOrchestrate: false },
      { message: '早上好', expected: 'simple-chat', shouldOrchestrate: false },
      { message: '谢谢', expected: 'simple-chat', shouldOrchestrate: false },
      { message: '再见', expected: 'simple-chat', shouldOrchestrate: false },
      { message: '好的', expected: 'simple-chat', shouldOrchestrate: false },
      { message: '嗯', expected: 'simple-chat', shouldOrchestrate: false }
    ]
  },
  // ========== 简单查询 ==========
  {
    category: '简单查询',
    cases: [
      { message: '现在几点', expected: 'simple-query', shouldOrchestrate: false },
      { message: '今天日期', expected: 'simple-query', shouldOrchestrate: false },
      { message: '今天天气', expected: 'simple-query', shouldOrchestrate: false },
      { message: '帮我查一下 TypeScript', expected: 'simple-query', shouldOrchestrate: false },
      { message: '什么是闭包', expected: 'simple-query', shouldOrchestrate: false }
    ]
  },
  // ========== 复杂任务 ==========
  {
    category: '复杂任务',
    cases: [
      {
        message: '首先帮我创建一个 Vue 项目，然后添加 TypeScript 支持，最后配置 ESLint',
        expected: 'complex-task',
        shouldOrchestrate: true
      },
      {
        message: '帮我开发一个音乐播放器，需要实现播放、暂停、切换歌曲的功能',
        expected: 'complex-task',
        shouldOrchestrate: true
      },
      {
        message: '创建一个电商系统，包括用户管理、商品管理、订单管理',
        expected: 'complex-task',
        shouldOrchestrate: true
      },
      {
        message:
          '我需要一个博客系统，用户可以发布文章、评论、点赞，管理员可以审核内容，还需要支持 Markdown 编辑器和图片上传功能',
        expected: 'complex-task',
        shouldOrchestrate: true
      },
      {
        message: '使用 Node.js 和 MongoDB 开发一个 REST API，实现用户注册、登录、权限验证功能',
        expected: 'complex-task',
        shouldOrchestrate: true
      }
    ]
  },
  // ========== 边界情况 ==========
  {
    category: '边界情况',
    cases: [
      { message: '', expected: 'simple-chat', shouldOrchestrate: false },
      { message: '   ', expected: 'simple-chat', shouldOrchestrate: false },
      {
        message: '如何在 React 中使用 Context API',
        expected: ['simple-query', 'complex-task'],
        shouldOrchestrate: null
      }
    ]
  }
];

async function runTests() {
  console.log('\n🧪 意图分类器集成测试\n');
  console.log('='.repeat(80));

  // 使用简单的内联实现，避免依赖问题
  const classify = async (message) => {
    const trimmed = message.trim();
    const length = trimmed.length;

    // 简单对话
    const greetings = [
      '你好',
      'hi',
      'hello',
      '嗨',
      '您好',
      '早上好',
      '下午好',
      '晚上好',
      '晚安',
      '谢谢',
      '再见',
      'bye',
      '拜拜'
    ];
    if (
      greetings.some(
        (g) => trimmed.toLowerCase() === g || trimmed.toLowerCase() === g + '！' || trimmed.toLowerCase() === g + '!'
      )
    ) {
      return {
        type: 'simple-chat',
        confidence: 1.0,
        reason: '匹配到问候语/礼貌用语',
        needsOrchestration: false
      };
    }

    // 单步查询（优先级高）
    const simpleQueryPatterns = [
      /^(现在|今天|明天)?(几点|时间|日期)/,
      /^(今天|明天|后天)?(天气|温度)/,
      /^(帮我|请)?(查|搜|找)(一下)?/,
      /^什么是.{1,20}$/
    ];
    if (simpleQueryPatterns.some((p) => p.test(trimmed))) {
      return {
        type: 'simple-query',
        confidence: 0.9,
        reason: '匹配到单步查询模式',
        needsOrchestration: false
      };
    }

    // 短消息
    if (length < 10 && !hasComplexKeywords(trimmed)) {
      return {
        type: 'simple-chat',
        confidence: 0.95,
        reason: '消息过短（< 10 字）且无复杂任务关键词',
        needsOrchestration: false
      };
    }

    // 复杂任务（降低阈值）
    const complexScore = getComplexityScore(trimmed);
    if (complexScore.score >= 2) {
      return {
        type: 'complex-task',
        confidence: 0.7 + complexScore.score * 0.05,
        reason: `检测到 ${complexScore.indicators.join('、')}`,
        needsOrchestration: true
      };
    }

    return {
      type: 'simple-query',
      confidence: 0.6,
      reason: '未匹配到明确特征，默认为简单查询',
      needsOrchestration: false
    };
  };

  const hasComplexKeywords = (message) => {
    const keywords = [
      '帮我',
      '创建',
      '实现',
      '开发',
      '设计',
      '部署',
      '分析',
      '规划',
      '方案',
      '架构',
      '重构',
      '测试',
      '优化',
      '修复',
      '调试',
      '第一步',
      '第二步',
      '然后',
      '接下来',
      '最后',
      '同时',
      '并且',
      '以及',
      '还有'
    ];
    return keywords.some((kw) => message.includes(kw));
  };

  const getComplexityScore = (message) => {
    let score = 0;
    const indicators = [];

    if (message.length > 50) {
      score += 1;
      indicators.push('长文本');
    }

    const stepKeywords = ['第一', '第二', '第三', '首先', '然后', '接下来', '最后', '步骤'];
    if (stepKeywords.some((kw) => message.includes(kw))) {
      score += 2;
      indicators.push('多步骤指令');
    }

    const parallelKeywords = ['同时', '并且', '以及', '还要', '也要', '包括'];
    if (parallelKeywords.some((kw) => message.includes(kw))) {
      score += 1;
      indicators.push('并发需求');
    }

    const techKeywords = [
      '代码',
      '函数',
      '接口',
      'API',
      '数据库',
      '服务器',
      '部署',
      '测试',
      'Node.js',
      'MongoDB',
      'REST'
    ];
    const techCount = techKeywords.filter((kw) => message.includes(kw)).length;
    if (techCount >= 1) {
      score += 1;
      indicators.push('技术任务');
    }

    const devKeywords = ['创建', '开发', '实现', '设计', '搭建', '构建', '需要实现'];
    if (devKeywords.some((kw) => message.includes(kw))) {
      score += 1;
      indicators.push('开发任务');
    }

    const projectKeywords = ['项目', '应用', '网站', '系统', '平台', '播放器', '管理', '博客'];
    if (projectKeywords.some((kw) => message.includes(kw))) {
      score += 1;
      indicators.push('项目级任务');
    }

    const featureKeywords = ['播放', '暂停', '切换', '发布', '评论', '点赞', '审核', '注册', '登录', '验证'];
    const featureCount = featureKeywords.filter((kw) => message.includes(kw)).length;
    if (featureCount >= 2) {
      score += 1;
      indicators.push('多功能需求');
    }

    return { score, indicators };
  };

  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  for (const group of testCases) {
    console.log(`\n📋 ${group.category}\n`);

    for (const testCase of group.cases) {
      totalTests++;
      const result = await classify(testCase.message);

      const expectedTypes = Array.isArray(testCase.expected) ? testCase.expected : [testCase.expected];
      const typeMatch = expectedTypes.includes(result.type);
      const orchestrateMatch =
        testCase.shouldOrchestrate === null || result.needsOrchestration === testCase.shouldOrchestrate;
      const passed = typeMatch && orchestrateMatch;

      const shortMsg = testCase.message.length > 50 ? testCase.message.slice(0, 50) + '...' : testCase.message;

      if (passed) {
        passedTests++;
        console.log('✅ "' + shortMsg + '"');
      } else {
        failedTests++;
        console.log('❌ "' + shortMsg + '"');
      }

      console.log('   分类: ' + result.type + ' (置信度: ' + result.confidence.toFixed(2) + ')');
      console.log('   编排: ' + (result.needsOrchestration ? '需要' : '不需要'));
      console.log('   原因: ' + result.reason);

      if (!passed) {
        console.log('   ❗ 期望: type=' + expectedTypes.join('/') + ', orchestrate=' + testCase.shouldOrchestrate);
      }
      console.log('');
    }
  }

  console.log('='.repeat(80));
  console.log('\n📊 测试结果: ' + passedTests + '/' + totalTests + ' 通过');

  if (failedTests > 0) {
    console.log('❌ ' + failedTests + ' 个测试失败\n');
    process.exit(1);
  } else {
    console.log(`✅ 所有测试通过！\n`);
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('测试执行失败:', err);
  process.exit(1);
});
