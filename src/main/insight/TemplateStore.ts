/**
 * TemplateStore — 分析模板管理
 *
 * 管理内置模板和用户自定义模板的 CRUD。
 * 存储路径: ~/.coobee-data/insight/templates/
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { log } from '@main/common/logger';
import type { AnalysisTemplate } from '@shared/types/insight';
import { builtinTemplates } from './builtin-templates';

export class TemplateStore {
  private dataDir: string;
  private userDir: string;
  private cache: Map<string, AnalysisTemplate> = new Map();

  constructor(dataRoot: string) {
    this.dataDir = path.join(dataRoot, 'insight', 'templates');
    this.userDir = path.join(this.dataDir, 'user');
    this.ensureDirs();
    this.loadAll();
  }

  private ensureDirs(): void {
    fs.mkdirSync(this.userDir, { recursive: true });
  }

  private loadAll(): void {
    this.cache.clear();

    for (const t of builtinTemplates) {
      this.cache.set(t.id, t);
    }

    try {
      const files = fs.readdirSync(this.userDir).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        const raw = fs.readFileSync(path.join(this.userDir, file), 'utf-8');
        const t = JSON.parse(raw) as AnalysisTemplate;
        this.cache.set(t.id, t);
      }
    } catch (err) {
      log.warn('[TemplateStore] Failed to load user templates:', err);
    }
  }

  list(): AnalysisTemplate[] {
    return Array.from(this.cache.values());
  }

  get(id: string): AnalysisTemplate | null {
    return this.cache.get(id) ?? null;
  }

  create(input: Omit<AnalysisTemplate, 'id' | 'createdAt' | 'updatedAt' | 'builtIn'>): AnalysisTemplate {
    const now = Date.now();
    const template: AnalysisTemplate = {
      ...input,
      id: `tpl-${now}`,
      builtIn: false,
      createdAt: now,
      updatedAt: now
    };
    this.saveUserTemplate(template);
    this.cache.set(template.id, template);
    log.info(`[TemplateStore] Created template: ${template.id} "${template.name}"`);
    return template;
  }

  update(id: string, updates: Partial<AnalysisTemplate>): AnalysisTemplate | null {
    const existing = this.cache.get(id);
    if (!existing) return null;
    if (existing.builtIn) {
      log.warn(`[TemplateStore] Cannot update built-in template: ${id}`);
      return null;
    }
    const updated: AnalysisTemplate = { ...existing, ...updates, id, updatedAt: Date.now() };
    this.saveUserTemplate(updated);
    this.cache.set(id, updated);
    return updated;
  }

  delete(id: string): boolean {
    const existing = this.cache.get(id);
    if (!existing || existing.builtIn) return false;
    const filePath = path.join(this.userDir, `${id}.json`);
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* ignore */
    }
    this.cache.delete(id);
    return true;
  }

  private saveUserTemplate(template: AnalysisTemplate): void {
    const filePath = path.join(this.userDir, `${template.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(template, null, 2), 'utf-8');
  }
}
