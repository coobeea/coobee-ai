/**
 * 内置分析模板
 */

import type { AnalysisTemplate } from '@shared/types/insight';

const now = Date.now();

export const builtinTemplates: AnalysisTemplate[] = [
  {
    id: 'sales-analysis',
    name: '销售对话分析',
    description: '实时分析客户购买意愿、核心需求、价格敏感度和竞品信息',
    icon: '💼',
    category: 'sales',
    dimensions: [
      {
        key: 'purchase_intent',
        label: '购买意愿',
        type: 'enum',
        options: ['强烈', '偏强', '一般', '观望', '拒绝'],
        icon: '🎯',
        prompt: '综合对话中的语气、措辞和提问，判断客户购买意愿。区分礼貌性表达和真实意图。',
        showTrend: true,
        required: true
      },
      {
        key: 'core_needs',
        label: '核心需求',
        type: 'list',
        maxItems: 5,
        icon: '📋',
        prompt: '提取客户直接或间接表达的业务需求，过滤闲聊内容。',
        required: true
      },
      {
        key: 'price_sensitivity',
        label: '价格敏感度',
        type: 'enum',
        options: ['高', '中', '低', '未提及'],
        icon: '💰',
        prompt: '根据客户是否主动询价、对价格的反应、预算相关话题判断。',
        showTrend: true
      },
      {
        key: 'decision_stage',
        label: '决策阶段',
        type: 'progress',
        stages: ['了解', '对比', '评估', '谈判', '签约'],
        icon: '🔄',
        prompt: '根据对话深度和客户关注点，判断客户处于哪个决策阶段。'
      },
      {
        key: 'competitor_mentions',
        label: '竞品提及',
        type: 'tags',
        icon: '⚠️',
        prompt: '提取对话中提到的竞争对手产品或方案名称。'
      },
      {
        key: 'next_action',
        label: '下一步建议',
        type: 'text',
        icon: '💡',
        prompt: '基于当前对话进展，给销售人员最紧急的1-2条行动建议。',
        required: true
      }
    ],
    analysisPrompt:
      '你是一位资深销售分析专家。你正在实时监听一场销售对话。对话内容可能包含口语化表达、闲聊和离题内容，你需要从中提取有价值的销售信号。请保持客观，基于事实分析，不要过度推断。',
    refreshStrategy: {
      trigger: 'hybrid',
      intervalSeconds: 45,
      minNewChars: 80,
      silenceMs: 2000
    },
    builtIn: true,
    createdAt: now,
    updatedAt: now
  },
  {
    id: 'meeting-notes',
    name: '会议纪要',
    description: '实时提取会议要点、决策和行动项',
    icon: '📝',
    category: 'meeting',
    dimensions: [
      {
        key: 'current_topic',
        label: '当前议题',
        type: 'text',
        icon: '🗣️',
        prompt: '识别当前正在讨论的主题或议题。',
        required: true
      },
      {
        key: 'decisions',
        label: '已做决定',
        type: 'list',
        maxItems: 10,
        icon: '✅',
        prompt: '提取对话中明确达成一致的决定。'
      },
      {
        key: 'action_items',
        label: '行动项',
        type: 'list',
        maxItems: 10,
        icon: '📌',
        prompt: '提取待办事项，尽量包含负责人和截止时间。'
      },
      {
        key: 'open_issues',
        label: '待解决问题',
        type: 'list',
        icon: '❓',
        prompt: '提取尚未达成一致或需要后续跟进的问题。'
      },
      {
        key: 'summary',
        label: '进展摘要',
        type: 'text',
        icon: '📄',
        prompt: '用2-3句话概括到目前为止的会议进展。',
        required: true
      }
    ],
    analysisPrompt:
      '你是一位专业的会议记录员。你正在实时记录一场会议。请从对话中提取关键信息，忽略寒暄和重复内容。对于行动项，尽量标注提到的负责人。',
    refreshStrategy: {
      trigger: 'hybrid',
      intervalSeconds: 60,
      minNewChars: 120,
      silenceMs: 3000
    },
    builtIn: true,
    createdAt: now,
    updatedAt: now
  },
  {
    id: 'service-consult',
    name: '专业服务咨询',
    description: '分析客户技术痛点、方案匹配度和风险',
    icon: '🔧',
    category: 'service',
    dimensions: [
      {
        key: 'pain_points',
        label: '客户痛点',
        type: 'list',
        maxItems: 5,
        icon: '🔥',
        prompt: '提取客户明确或暗示的技术/业务痛点。',
        required: true
      },
      {
        key: 'solution_match',
        label: '方案匹配度',
        type: 'score',
        icon: '🎯',
        prompt: '评估当前讨论的方案与客户需求的匹配程度，0-100分。',
        showTrend: true
      },
      {
        key: 'risks',
        label: '风险点',
        type: 'list',
        icon: '⚠️',
        prompt: '提取对话中提到或暗示的潜在风险。'
      },
      {
        key: 'action_items',
        label: '后续行动',
        type: 'list',
        maxItems: 5,
        icon: '📌',
        prompt: '提取需要跟进的行动项和待办事项。'
      },
      {
        key: 'summary',
        label: '咨询摘要',
        type: 'text',
        icon: '📄',
        prompt: '一句话总结当前咨询的进展和状态。',
        required: true
      }
    ],
    analysisPrompt:
      '你是一位专业服务顾问的助手。你正在实时分析一场技术/业务咨询对话。重点关注客户的痛点、方案的匹配度以及潜在风险。忽略无关闲聊。',
    refreshStrategy: {
      trigger: 'hybrid',
      intervalSeconds: 50,
      minNewChars: 100,
      silenceMs: 2500
    },
    builtIn: true,
    createdAt: now,
    updatedAt: now
  },
  {
    id: 'interview-eval',
    name: '面试评估',
    description: '实时评估候选人的技术能力和沟通表达',
    icon: '🎓',
    category: 'interview',
    dimensions: [
      {
        key: 'technical_score',
        label: '技术能力',
        type: 'score',
        icon: '💻',
        prompt: '根据候选人的回答质量评估技术能力，0-100分。',
        showTrend: true,
        required: true
      },
      {
        key: 'communication',
        label: '沟通表达',
        type: 'enum',
        options: ['优秀', '良好', '一般', '较差'],
        icon: '🗣️',
        prompt: '评估候选人的表达清晰度、逻辑性和条理性。'
      },
      {
        key: 'highlights',
        label: '亮点',
        type: 'list',
        maxItems: 5,
        icon: '⭐',
        prompt: '提取候选人在回答中的亮点和突出表现。'
      },
      {
        key: 'concerns',
        label: '疑点',
        type: 'list',
        icon: '🔍',
        prompt: '标记需要进一步验证或不确定的地方。'
      },
      {
        key: 'recommendation',
        label: '综合建议',
        type: 'enum',
        options: ['强烈推荐', '推荐', '待定', '不推荐'],
        icon: '📊',
        prompt: '基于目前的面试表现，给出综合建议。',
        showTrend: true,
        required: true
      }
    ],
    analysisPrompt:
      '你是一位经验丰富的面试评估助手。你正在实时分析一场面试对话。客观评估候选人的技术能力和沟通能力。注意区分面试官的引导性提问和候选人的实际回答。',
    refreshStrategy: {
      trigger: 'hybrid',
      intervalSeconds: 60,
      minNewChars: 150,
      silenceMs: 3000
    },
    builtIn: true,
    createdAt: now,
    updatedAt: now
  }
];
