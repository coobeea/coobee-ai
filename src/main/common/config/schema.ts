/**
 * Coobee AI 统一配置 Zod Schema
 *
 * 所有配置通过此 schema 进行校验，确保类型安全。
 * 对应配置文件：~/.coobee-ai/coobee.json5
 */
import { z } from 'zod'

// ─── 模型相关 ───────────────────────────────────────

export const ModelApiSchema = z.enum(['openai-compatible', 'anthropic', 'google'])

export const ModelCostSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number().optional(),
  cacheWrite: z.number().optional()
})

export const ModelConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  api: ModelApiSchema.optional(),
  reasoning: z.boolean().optional().default(false),
  vision: z.boolean().optional().default(false),
  functionCalling: z.boolean().optional().default(false),
  webSearch: z.boolean().optional().default(false),
  input: z
    .array(z.enum(['text', 'image']))
    .optional()
    .default(['text']),
  contextWindow: z.number().optional(),
  maxInputTokens: z.number().optional(),
  maxOutputTokens: z.number().optional(),
  maxThinkingTokens: z.number().optional(),
  /** @deprecated 使用 maxOutputTokens */
  maxTokens: z.number().optional(),
  free: z.boolean().optional().default(false),
  features: z.array(z.string()).optional(),
  cost: ModelCostSchema.optional()
})

export const ProviderWebsitesSchema = z.object({
  official: z.string().optional(),
  apiKey: z.string().optional(),
  docs: z.string().optional(),
  models: z.string().optional()
})

export const ProviderConfigSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  baseUrl: z.string(),
  apiKey: z.string().optional(),
  api: ModelApiSchema.default('openai-compatible'),
  headers: z.record(z.string(), z.string()).optional(),
  models: z.array(ModelConfigSchema),
  enabled: z.boolean().optional().default(true),
  websites: ProviderWebsitesSchema.optional()
})

// ─── 模型选择 ───────────────────────────────────────

export const ModelSelectionSchema = z.object({
  primary: z.string(),
  fallbacks: z.array(z.string()).optional()
})

// ─── Agent 配置 ──────────────────────────────────────

export const AgentEntrySchema = z.object({
  agentId: z.string(),
  model: z.string().optional()
})

// ─── 队列配置 ───────────────────────────────────────

export const QueueModeSchema = z.enum(['followup', 'steer', 'collect', 'interrupt'])

export const QueueSettingsSchema = z.object({
  mode: QueueModeSchema.default('collect'),
  debounceMs: z.number().default(500),
  cap: z.number().default(20),
  dropPolicy: z.enum(['old', 'new', 'summarize']).default('summarize')
})

// ─── 主 Schema ──────────────────────────────────────

export const CoobeeConfigSchema = z.object({
  models: z
    .object({
      providers: z.record(z.string(), ProviderConfigSchema).optional()
    })
    .optional(),

  agents: z
    .object({
      defaults: z
        .object({
          model: ModelSelectionSchema.optional(),
          thinkingLevel: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).optional()
        })
        .optional(),
      list: z.array(AgentEntrySchema).optional()
    })
    .optional(),

  messages: z
    .object({
      queue: QueueSettingsSchema.optional()
    })
    .optional(),

  tools: z
    .object({
      exec: z
        .object({
          timeout: z.number().default(30000),
          blacklist: z.array(z.string()).optional()
        })
        .optional()
    })
    .optional(),

  security: z
    .object({
      sandbox: z
        .object({
          mode: z.enum(['off', 'path-only', 'docker']).default('path-only')
        })
        .optional(),
      approvals: z
        .object({
          exec: z.enum(['auto', 'always', 'never']).default('auto')
        })
        .optional()
    })
    .optional(),

  ui: z
    .object({
      theme: z.enum(['auto', 'light', 'dark']).default('auto'),
      language: z.string().default('zh-CN'),
      soundEffects: z.boolean().default(true)
    })
    .optional(),

  logging: z
    .object({
      level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
      file: z.boolean().default(true)
    })
    .optional()
})

/** Zod 推断的配置类型（输出类型，含 .default() 填充） */
export type CoobeeConfig = z.output<typeof CoobeeConfigSchema>
