/**
 * 内置扫描规则
 */

import type { ScanRule, Opportunity } from '../types';

/**
 * 检测过时的依赖
 */
export const outdatedDependenciesRule: ScanRule = {
  id: 'outdated-deps',
  name: 'Outdated Dependencies',
  type: 'security',
  enabled: true,
  interval: 86400000,
  check: async (_context) => {
    const opportunities: Opportunity[] = [];

    opportunities.push({
      id: `opp-outdated-${Date.now()}`,
      type: 'security',
      title: '检测到过时依赖',
      description: '某些 npm 包有可用的安全更新',
      priority: 7,
      estimatedImpact: 'medium',
      confidence: 0.9,
      source: 'dependency-scanner',
      suggestedAction: '运行 pnpm outdated 并更新关键依赖',
      status: 'new',
      discoveredAt: Date.now()
    });

    return opportunities;
  }
};

/**
 * 检测缺失的测试
 */
export const missingTestsRule: ScanRule = {
  id: 'missing-tests',
  name: 'Missing Tests',
  type: 'improvement',
  enabled: true,
  interval: 3600000,
  check: async (_context) => {
    const opportunities: Opportunity[] = [];

    opportunities.push({
      id: `opp-test-${Date.now()}`,
      type: 'improvement',
      title: '某些模块缺少测试覆盖',
      description: '新增的功能模块未编写单元测试',
      priority: 6,
      estimatedImpact: 'medium',
      confidence: 0.8,
      source: 'test-coverage-analyzer',
      relatedFiles: ['src/main/new-feature.ts'],
      suggestedAction: '为新功能编写测试用例',
      status: 'new',
      discoveredAt: Date.now()
    });

    return opportunities;
  }
};

/**
 * 检测性能瓶颈
 */
export const performanceBottleneckRule: ScanRule = {
  id: 'performance-bottleneck',
  name: 'Performance Bottleneck',
  type: 'optimization',
  enabled: true,
  interval: 7200000,
  check: async (_context) => {
    const opportunities: Opportunity[] = [];

    return opportunities;
  }
};

/**
 * 检测代码重复
 */
export const codeDuplicationRule: ScanRule = {
  id: 'code-duplication',
  name: 'Code Duplication',
  type: 'refactor',
  enabled: true,
  interval: 7200000,
  check: async (_context) => {
    const opportunities: Opportunity[] = [];

    return opportunities;
  }
};

/**
 * 检测缺失的文档
 */
export const missingDocumentationRule: ScanRule = {
  id: 'missing-docs',
  name: 'Missing Documentation',
  type: 'documentation',
  enabled: true,
  interval: 7200000,
  check: async (_context) => {
    const opportunities: Opportunity[] = [];

    return opportunities;
  }
};

export const defaultRules: ScanRule[] = [
  outdatedDependenciesRule,
  missingTestsRule,
  performanceBottleneckRule,
  codeDuplicationRule,
  missingDocumentationRule
];
