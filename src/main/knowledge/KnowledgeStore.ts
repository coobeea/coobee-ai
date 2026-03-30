import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import mammoth from 'mammoth';
import { Env } from '@main/common/env';
import { log } from '@main/common/logger';
import type {
  KnowledgeBaseMeta,
  KnowledgeBaseStatus,
  KnowledgeTreeNode,
  SourceMaterial
} from '@shared/types/knowledge';

const KB_DIR = 'knowledge';
const SOURCES_DIR = '_sources';
const META_FILE = 'meta.json';
const CONTENT_DIR = 'content';

export class KnowledgeStore {
  private static instance: KnowledgeStore;
  private root: string;

  private constructor() {
    this.root = path.join(Env.paths.userHome, KB_DIR);
    fs.mkdirSync(this.root, { recursive: true });
  }

  static getInstance(): KnowledgeStore {
    if (!KnowledgeStore.instance) {
      KnowledgeStore.instance = new KnowledgeStore();
    }
    return KnowledgeStore.instance;
  }

  private kbDir(id: string): string {
    return path.join(this.root, id);
  }

  private contentDir(id: string): string {
    return path.join(this.kbDir(id), CONTENT_DIR);
  }

  private sourcesDir(id: string): string {
    return path.join(this.kbDir(id), SOURCES_DIR);
  }

  // ==================== CRUD ====================

  list(): KnowledgeBaseMeta[] {
    if (!fs.existsSync(this.root)) return [];
    const entries = fs.readdirSync(this.root, { withFileTypes: true });
    const results: KnowledgeBaseMeta[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = this.get(entry.name);
      if (meta) results.push(meta);
    }
    return results.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): KnowledgeBaseMeta | null {
    const dir = this.kbDir(id);
    if (!fs.existsSync(dir)) return null;
    const metaPath = path.join(dir, META_FILE);
    if (fs.existsSync(metaPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as KnowledgeBaseMeta;
        raw.totalFiles = this.countFiles(this.contentDir(id));
        raw.chapterCount = this.countChapters(this.contentDir(id));
        raw.sourceCount = this.countSources(id);
        return raw;
      } catch {
        /* fallback */
      }
    }
    const stat = fs.statSync(dir);
    return {
      id,
      name: id,
      description: '',
      status: 'empty',
      chapterCount: 0,
      totalFiles: 0,
      sourceCount: 0,
      createdAt: stat.birthtimeMs,
      updatedAt: stat.mtimeMs
    };
  }

  delete(id: string): boolean {
    const dir = this.kbDir(id);
    if (!fs.existsSync(dir)) return false;
    fs.rmSync(dir, { recursive: true, force: true });
    log.info(`[KnowledgeStore] Deleted knowledge base: ${id}`);
    return true;
  }

  // ==================== 创建知识库 ====================

  create(name: string, description: string): KnowledgeBaseMeta {
    const id = `kb-${Date.now()}`;
    const dir = this.kbDir(id);
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(this.sourcesDir(id), { recursive: true });
    fs.mkdirSync(this.contentDir(id), { recursive: true });

    const now = Date.now();
    const meta: KnowledgeBaseMeta = {
      id,
      name,
      description,
      status: 'empty',
      chapterCount: 0,
      totalFiles: 0,
      sourceCount: 0,
      createdAt: now,
      updatedAt: now
    };
    this.saveMeta(id, meta);
    log.info(`[KnowledgeStore] Created KB: ${id}`);
    return meta;
  }

  // ==================== 源材料管理 ====================

  addSource(id: string, fileName: string, data: Buffer): SourceMaterial {
    const srcDir = this.sourcesDir(id);
    fs.mkdirSync(srcDir, { recursive: true });

    const safeName = fileName.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, '_');
    const filePath = path.join(srcDir, safeName);
    fs.writeFileSync(filePath, data);

    const ext = path.extname(safeName).toLowerCase();
    const typeMap: Record<string, SourceMaterial['type']> = {
      '.zip': 'zip',
      '.pdf': 'pdf',
      '.doc': 'word',
      '.docx': 'word',
      '.md': 'markdown',
      '.txt': 'text',
      '.png': 'image',
      '.jpg': 'image',
      '.jpeg': 'image',
      '.gif': 'image',
      '.webp': 'image'
    };

    const material: SourceMaterial = {
      name: safeName,
      path: safeName,
      type: typeMap[ext] || 'other',
      size: data.length,
      addedAt: Date.now()
    };

    if (ext === '.zip') {
      this.extractZipToSources(id, filePath);
    }

    this.updateStatus(id, 'empty');
    log.info(`[KnowledgeStore] Added source: ${id}/${safeName} (${material.type}, ${data.length} bytes)`);
    return material;
  }

  listSources(id: string): SourceMaterial[] {
    const srcDir = this.sourcesDir(id);
    if (!fs.existsSync(srcDir)) return [];

    const materials: SourceMaterial[] = [];
    this.walkSources(srcDir, '', materials);
    return materials.sort((a, b) => b.addedAt - a.addedAt);
  }

  readSourceContent(id: string, filePath: string): string | null {
    const safePath = filePath.replace(/\.\./g, '');
    const fullPath = path.join(this.sourcesDir(id), safePath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return null;
    try {
      return fs.readFileSync(fullPath, 'utf-8');
    } catch {
      return null;
    }
  }

  async getSourcesAsText(id: string): Promise<string> {
    const srcDir = this.sourcesDir(id);
    if (!fs.existsSync(srcDir)) return '';

    const TEXT_EXTS = new Set(['.md', '.txt', '.csv', '.json', '.xml', '.html', '.htm', '.yaml', '.yml']);
    const DOCX_EXTS = new Set(['.docx', '.doc']);

    const parts: string[] = [];
    const files: { fullPath: string; rel: string; ext: string }[] = [];

    const collect = (dir: string, prefix: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          collect(fullPath, rel);
        } else {
          files.push({ fullPath, rel, ext: path.extname(entry.name).toLowerCase() });
        }
      }
    };
    collect(srcDir, '');

    for (const file of files) {
      if (TEXT_EXTS.has(file.ext)) {
        try {
          const content = fs.readFileSync(file.fullPath, 'utf-8');
          parts.push(`\n===== 文件: ${file.rel} =====\n${content}`);
        } catch {
          /* skip unreadable */
        }
      } else if (DOCX_EXTS.has(file.ext)) {
        try {
          const result = await mammoth.extractRawText({ path: file.fullPath });
          if (result.value.trim()) {
            parts.push(`\n===== 文件: ${file.rel} =====\n${result.value}`);
          }
        } catch (err) {
          log.warn(`[KnowledgeStore] Failed to extract text from ${file.rel}:`, err);
        }
      }
    }

    return parts.join('\n');
  }

  // ==================== 构建内容（由 KnowledgeBuilder 调用） ====================

  writeContentFile(id: string, filePath: string, content: string): void {
    const fullPath = path.join(this.contentDir(id), filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
  }

  clearContent(id: string): void {
    const dir = this.contentDir(id);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    fs.mkdirSync(dir, { recursive: true });
  }

  updateStatus(id: string, status: KnowledgeBaseStatus, buildProgress?: string): void {
    const metaPath = path.join(this.kbDir(id), META_FILE);
    if (!fs.existsSync(metaPath)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      raw.status = status;
      raw.updatedAt = Date.now();
      if (buildProgress !== undefined) raw.buildProgress = buildProgress;
      if (status === 'ready') {
        raw.totalFiles = this.countFiles(this.contentDir(id));
        raw.chapterCount = this.countChapters(this.contentDir(id));
        raw.buildProgress = undefined;
      }
      fs.writeFileSync(metaPath, JSON.stringify(raw, null, 2), 'utf-8');
    } catch {
      /* ignore */
    }
  }

  // ==================== 内容读取（浏览用） ====================

  readFile(id: string, filePath: string): string | null {
    const safePath = filePath.replace(/\.\./g, '');
    const fullPath = path.join(this.contentDir(id), safePath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return null;
    return fs.readFileSync(fullPath, 'utf-8');
  }

  getIndex(id: string): string | null {
    const indexPath = path.join(this.contentDir(id), 'index.md');
    if (!fs.existsSync(indexPath)) return null;
    return fs.readFileSync(indexPath, 'utf-8');
  }

  listTree(id: string): KnowledgeTreeNode[] {
    const dir = this.contentDir(id);
    if (!fs.existsSync(dir)) return [];
    return this.buildTree(dir, '');
  }

  // ==================== Pipeline 兼容 ====================

  createFromPipeline(kbId: string, meta: { name: string; description: string; sourceSessionId?: string }): string {
    const dir = this.kbDir(kbId);
    fs.mkdirSync(dir, { recursive: true });
    const contentDir = this.contentDir(kbId);
    fs.mkdirSync(contentDir, { recursive: true });

    const now = Date.now();
    const metaObj: KnowledgeBaseMeta = {
      id: kbId,
      name: meta.name,
      description: meta.description,
      status: 'building',
      chapterCount: 0,
      totalFiles: 0,
      sourceCount: 0,
      createdAt: now,
      updatedAt: now,
      sourceSessionId: meta.sourceSessionId
    };
    this.saveMeta(kbId, metaObj);
    log.info(`[KnowledgeStore] Created KB from pipeline: ${kbId}`);
    return contentDir;
  }

  /** Pipeline 兼容：写文件到 content 目录 */
  writeFile(id: string, filePath: string, content: string): void {
    this.writeContentFile(id, filePath, content);
  }

  updateMeta(id: string, updates: Partial<KnowledgeBaseMeta>): void {
    const existing = this.get(id);
    if (!existing) return;
    const merged = { ...existing, ...updates, updatedAt: Date.now() };
    this.saveMeta(id, merged);
  }

  // ==================== Private helpers ====================

  private saveMeta(id: string, meta: KnowledgeBaseMeta): void {
    fs.writeFileSync(path.join(this.kbDir(id), META_FILE), JSON.stringify(meta, null, 2), 'utf-8');
  }

  private extractZipToSources(id: string, zipPath: string): void {
    try {
      const extractDir = path.join(this.sourcesDir(id), `_extracted_${Date.now()}`);
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(extractDir, true);
      log.info(`[KnowledgeStore] Extracted ZIP to sources: ${extractDir}`);
    } catch (err) {
      log.error(`[KnowledgeStore] Failed to extract ZIP:`, err);
    }
  }

  private walkSources(dir: string, prefix: string, out: SourceMaterial[]): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        this.walkSources(fullPath, rel, out);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        const typeMap: Record<string, SourceMaterial['type']> = {
          '.zip': 'zip',
          '.pdf': 'pdf',
          '.doc': 'word',
          '.docx': 'word',
          '.md': 'markdown',
          '.txt': 'text',
          '.png': 'image',
          '.jpg': 'image',
          '.jpeg': 'image'
        };
        const stat = fs.statSync(fullPath);
        out.push({
          name: entry.name,
          path: rel,
          type: typeMap[ext] || 'other',
          size: stat.size,
          addedAt: stat.mtimeMs
        });
      }
    }
  }

  private countSources(id: string): number {
    const srcDir = this.sourcesDir(id);
    if (!fs.existsSync(srcDir)) return 0;
    let count = 0;
    const walk = (d: string): void => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        if (entry.isDirectory()) walk(path.join(d, entry.name));
        else count++;
      }
    };
    walk(srcDir);
    return count;
  }

  private buildTree(baseDir: string, relativePath: string): KnowledgeTreeNode[] {
    const fullDir = relativePath ? path.join(baseDir, relativePath) : baseDir;
    if (!fs.existsSync(fullDir)) return [];
    const entries = fs.readdirSync(fullDir, { withFileTypes: true });
    const nodes: KnowledgeTreeNode[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === META_FILE) continue;
      const rel = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        nodes.push({
          name: entry.name,
          path: rel,
          type: 'directory',
          children: this.buildTree(baseDir, rel)
        });
      } else if (entry.name.endsWith('.md')) {
        nodes.push({ name: entry.name, path: rel, type: 'file' });
      }
    }
    return nodes.sort((a, b) => a.name.localeCompare(b.name));
  }

  private countChapters(dir: string): number {
    if (!fs.existsSync(dir)) return 0;
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && /^\d{2}-/.test(e.name)).length;
  }

  private countFiles(dir: string): number {
    if (!fs.existsSync(dir)) return 0;
    let count = 0;
    const walk = (d: string): void => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        if (entry.isDirectory()) walk(path.join(d, entry.name));
        else if (entry.name.endsWith('.md')) count++;
      }
    };
    walk(dir);
    return count;
  }
}
