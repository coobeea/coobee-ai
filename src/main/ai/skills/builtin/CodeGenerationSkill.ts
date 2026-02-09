/**
 * 代码生成技能
 */

import type { AISkill } from '../types'

/**
 * 检测编程语言
 */
function detectLanguage(input: string): string {
  const lowerInput = input.toLowerCase()
  if (lowerInput.includes('typescript') || lowerInput.includes('ts')) return 'TypeScript'
  if (lowerInput.includes('javascript') || lowerInput.includes('js')) return 'JavaScript'
  if (lowerInput.includes('python') || lowerInput.includes('py')) return 'Python'
  if (lowerInput.includes('java')) return 'Java'
  if (lowerInput.includes('c++') || lowerInput.includes('cpp')) return 'C++'
  return 'TypeScript' // 默认
}

/**
 * 获取代码模板
 */
function getTemplate(language: string, input: string): string {
  const templates: Record<string, string> = {
    TypeScript: `// ${input}\nexport function generatedFunction() {\n  // TODO: 实现功能\n  return null\n}`,
    JavaScript: `// ${input}\nfunction generatedFunction() {\n  // TODO: 实现功能\n  return null\n}`,
    Python: `# ${input}\ndef generated_function():\n    # TODO: 实现功能\n    pass`,
    Java: `// ${input}\npublic class GeneratedClass {\n  public void generatedMethod() {\n    // TODO: 实现功能\n  }\n}`,
    'C++': `// ${input}\nvoid generatedFunction() {\n  // TODO: 实现功能\n}`
  }

  return templates[language] || templates.TypeScript
}

export const codeGenerationSkill: AISkill = {
  id: 'code-generation',
  name: 'Code Generation',
  description: '生成高质量的代码，遵循最佳实践和项目规范',
  category: 'code-generation',
  keywords: ['代码', '编程', '生成', 'code', 'generate', 'implement', 'typescript', 'javascript'],
  examples: [
    '生成一个用户认证的 TypeScript 类',
    '实现一个 React 组件，支持拖拽排序',
    '创建一个 Express 路由处理器'
  ],
  execute: async (context) => {
    console.log(`[CodeGenerationSkill] Executing for session: ${context.sessionId}`)

    // 解析输入以识别语言和需求
    const input = context.userInput || ''
    const language = detectLanguage(input)
    const template = getTemplate(language, input)

    return {
      code: template,
      explanation: `生成的 ${language} 代码模板。实际使用时应集成 LLM API 进行智能代码生成。`,
      metadata: {
        language,
        sessionId: context.sessionId
      }
    }
  }
}
