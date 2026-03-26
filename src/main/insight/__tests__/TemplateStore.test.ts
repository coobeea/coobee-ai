import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TemplateStore } from '../TemplateStore';
import { builtinTemplates } from '../builtin-templates';

describe('TemplateStore', () => {
  let tmpDir: string;
  let store: TemplateStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'insight-test-'));
    store = new TemplateStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads builtin templates', () => {
    const templates = store.list();
    expect(templates.length).toBeGreaterThanOrEqual(builtinTemplates.length);
    const salesTpl = store.get('sales-analysis');
    expect(salesTpl).not.toBeNull();
    expect(salesTpl!.builtIn).toBe(true);
    expect(salesTpl!.name).toBe('销售对话分析');
  });

  it('creates a user template', () => {
    const created = store.create({
      name: 'Test Template',
      description: 'A test',
      category: 'custom',
      dimensions: [{ key: 'test_dim', label: 'Test', type: 'text', prompt: 'test prompt' }],
      analysisPrompt: 'test system prompt',
      refreshStrategy: { trigger: 'manual' }
    });

    expect(created.id).toMatch(/^tpl-/);
    expect(created.builtIn).toBe(false);
    expect(store.get(created.id)).not.toBeNull();
  });

  it('updates a user template', () => {
    const created = store.create({
      name: 'Original',
      description: 'desc',
      category: 'custom',
      dimensions: [],
      analysisPrompt: 'prompt',
      refreshStrategy: { trigger: 'manual' }
    });

    const updated = store.update(created.id, { name: 'Updated' });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('Updated');
  });

  it('cannot update builtin template', () => {
    const result = store.update('sales-analysis', { name: 'Modified' });
    expect(result).toBeNull();
  });

  it('deletes a user template', () => {
    const created = store.create({
      name: 'To Delete',
      description: 'desc',
      category: 'custom',
      dimensions: [],
      analysisPrompt: 'prompt',
      refreshStrategy: { trigger: 'manual' }
    });

    expect(store.delete(created.id)).toBe(true);
    expect(store.get(created.id)).toBeNull();
  });

  it('cannot delete builtin template', () => {
    expect(store.delete('sales-analysis')).toBe(false);
  });

  it('persists user templates to disk', () => {
    store.create({
      name: 'Persistent',
      description: 'desc',
      category: 'custom',
      dimensions: [],
      analysisPrompt: 'prompt',
      refreshStrategy: { trigger: 'manual' }
    });

    const store2 = new TemplateStore(tmpDir);
    const templates = store2.list();
    const userTemplates = templates.filter((t) => !t.builtIn);
    expect(userTemplates.length).toBe(1);
    expect(userTemplates[0].name).toBe('Persistent');
  });
});
