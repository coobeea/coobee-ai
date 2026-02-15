import { describe, expect, it } from 'vitest'

import { buildReloadPlan, diffConfigPaths } from '../ConfigDiff'

describe('diffConfigPaths', () => {
  it('should return empty for identical objects', () => {
    const obj = { a: 1, b: { c: 'hello' } }
    expect(diffConfigPaths(obj, obj)).toEqual([])
  })

  it('should detect primitive value changes', () => {
    const prev = { theme: 'dark', level: 'info' }
    const next = { theme: 'light', level: 'info' }
    expect(diffConfigPaths(prev, next)).toEqual(['theme'])
  })

  it('should detect nested changes', () => {
    const prev = { ui: { theme: 'dark', language: 'zh-CN' } }
    const next = { ui: { theme: 'light', language: 'zh-CN' } }
    expect(diffConfigPaths(prev, next)).toEqual(['ui.theme'])
  })

  it('should detect added keys', () => {
    const prev = { a: 1 }
    const next = { a: 1, b: 2 }
    const changes = diffConfigPaths(prev, next)
    expect(changes).toContain('b')
  })

  it('should detect removed keys', () => {
    const prev = { a: 1, b: 2 }
    const next = { a: 1 }
    const changes = diffConfigPaths(prev, next)
    expect(changes).toContain('b')
  })

  it('should detect array changes', () => {
    const prev = { list: [1, 2, 3] }
    const next = { list: [1, 2, 4] }
    expect(diffConfigPaths(prev, next)).toEqual(['list'])
  })

  it('should detect type changes', () => {
    const prev = { val: 'string' }
    const next = { val: 123 }
    expect(diffConfigPaths(prev, next)).toEqual(['val'])
  })

  it('should handle null/undefined transitions', () => {
    expect(diffConfigPaths(null, { a: 1 })).toEqual(['.'])
    expect(diffConfigPaths({ a: 1 }, null)).toEqual(['.'])
    expect(diffConfigPaths(null, null)).toEqual([])
  })

  it('should detect deeply nested changes', () => {
    const prev = { models: { providers: { openai: { apiKey: 'old' } } } }
    const next = { models: { providers: { openai: { apiKey: 'new' } } } }
    expect(diffConfigPaths(prev, next)).toEqual(['models.providers.openai.apiKey'])
  })

  it('should detect multiple changes at different levels', () => {
    const prev = { ui: { theme: 'dark' }, logging: { level: 'info' } }
    const next = { ui: { theme: 'light' }, logging: { level: 'debug' } }
    const changes = diffConfigPaths(prev, next)
    expect(changes).toContain('ui.theme')
    expect(changes).toContain('logging.level')
  })
})

describe('buildReloadPlan', () => {
  it('should classify hot paths', () => {
    const plan = buildReloadPlan(['ui.theme', 'logging.level'])
    expect(plan.hotPaths).toEqual(['ui.theme', 'logging.level'])
    expect(plan.nonePaths).toEqual([])
  })

  it('should classify none paths', () => {
    const plan = buildReloadPlan(['models.providers.openai.apiKey', 'agents.defaults.model'])
    expect(plan.nonePaths).toEqual(['models.providers.openai.apiKey', 'agents.defaults.model'])
    expect(plan.hotPaths).toEqual([])
  })

  it('should handle mixed paths', () => {
    const plan = buildReloadPlan([
      'ui.theme',
      'models.providers.openai.apiKey',
      'logging.level',
      'tools.exec.timeout'
    ])
    expect(plan.hotPaths).toEqual(['ui.theme', 'logging.level'])
    expect(plan.nonePaths).toEqual(['models.providers.openai.apiKey', 'tools.exec.timeout'])
  })

  it('should return all changed paths', () => {
    const paths = ['ui.theme', 'models.providers.openai']
    const plan = buildReloadPlan(paths)
    expect(plan.changedPaths).toEqual(paths)
  })

  it('should handle empty changes', () => {
    const plan = buildReloadPlan([])
    expect(plan.changedPaths).toEqual([])
    expect(plan.hotPaths).toEqual([])
    expect(plan.nonePaths).toEqual([])
  })
})
