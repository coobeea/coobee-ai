# 禁止使用关键词匹配进行意图识别

## 核心原则

**这是一个 AI 项目，必须使用 LLM 智能判断，禁止使用关键词硬编码方式。**

## ❌ 禁止的做法

```typescript
// ❌ 禁止：关键词列表硬编码
const greetings = ['你好', 'hi', 'hello', '谢谢', '再见'];
if (greetings.includes(message)) {
  return 'simple-chat';
}

// ❌ 禁止：正则匹配模式
const simpleQueryPatterns = [/^现在几点/, /^今天天气/];
if (simpleQueryPatterns.some((p) => p.test(message))) {
  return 'simple-query';
}

// ❌ 禁止：复杂度关键词评分
const complexKeywords = ['开发', '创建', '设计', '系统'];
const score = complexKeywords.filter((k) => message.includes(k)).length;
if (score >= 2) return 'complex-task';
```

## ✅ 正确的做法

```typescript
// ✅ 使用 LLM 判断
const analyzer = new RequirementAnalyzer();
const result = await analyzer.analyze(message);

// LLM 返回：
// { taskType: 'simple-chat', needsOrchestration: false, reason: '...' }
// { taskType: 'complex-task', needsOrchestration: true, analysis: {...} }
```

## 为什么禁止关键词匹配

1. **不智能** - 用户说"你好啊朋友"，关键词匹配可能失败
2. **不灵活** - 每次要加新场景就要改代码
3. **不准确** - 无法理解上下文和语义
4. **维护难** - 关键词列表会越来越长，难以维护
5. **浪费资源** - 我们已经有 LLM，为什么还要自己写规则？

## 唯一例外

**没有例外。** 任何需要意图识别的地方，都应该使用 LLM。

## 相关文件

禁止在以下文件中添加关键词匹配逻辑：

- `src/main/gateway/methods/chat.ts`
- `src/main/ai/orchestration/RequirementAnalyzer.ts`
- 任何涉及用户意图判断的地方

## 检查清单

在 Code Review 时，如果看到以下代码，必须拒绝：

- [ ] 关键词数组（greetings, keywords, patterns）
- [ ] 正则匹配列表
- [ ] 基于关键词的评分逻辑
- [ ] 硬编码的消息长度阈值（除非是技术限制，如 token 限制）

## 正确的实现路径

1. 使用 `RequirementAnalyzer`（LLM-based）判断任务类型
2. 如果需要快速判断，使用轻量级 LLM 调用（如 gpt-4o-mini）
3. 优先考虑用户体验，而不是节省 API 成本

---

**记住：我们是 AI 项目，要充分利用 AI 的能力，而不是退化成传统的规则引擎。**
