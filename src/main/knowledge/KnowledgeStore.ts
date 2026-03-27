import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { Env } from '@main/common/env';
import { log } from '@main/common/logger';
import type { KnowledgeBaseMeta, KnowledgeTreeNode } from '@shared/types/knowledge';

const KB_DIR = 'knowledge';

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

  list(): KnowledgeBaseMeta[] {
    if (!fs.existsSync(this.root)) return [];

    const entries = fs.readdirSync(this.root, { withFileTypes: true });
    const results: KnowledgeBaseMeta[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = this.get(entry.name);
      if (meta) results.push(meta);
    }

    return results.sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): KnowledgeBaseMeta | null {
    const dir = this.kbDir(id);
    if (!fs.existsSync(dir)) return null;

    const metaPath = path.join(dir, 'meta.json');
    if (fs.existsSync(metaPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as KnowledgeBaseMeta;
        raw.totalFiles = this.countFiles(dir);
        raw.chapterCount = this.countChapters(dir);
        return raw;
      } catch {
        // fallback below
      }
    }

    const stat = fs.statSync(dir);
    return {
      id,
      name: id,
      description: '',
      chapterCount: this.countChapters(dir),
      totalFiles: this.countFiles(dir),
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

  getIndex(id: string): string | null {
    const indexPath = path.join(this.kbDir(id), 'index.md');
    if (!fs.existsSync(indexPath)) return null;
    return fs.readFileSync(indexPath, 'utf-8');
  }

  readFile(id: string, filePath: string): string | null {
    const safePath = filePath.replace(/\.\./g, '');
    const fullPath = path.join(this.kbDir(id), safePath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return null;
    return fs.readFileSync(fullPath, 'utf-8');
  }

  listTree(id: string): KnowledgeTreeNode[] {
    const dir = this.kbDir(id);
    if (!fs.existsSync(dir)) return [];
    return this.buildTree(dir, '');
  }

  /**
   * 简单创建：只提供名称和描述，创建一个空知识库
   */
  createSimple(name: string, description: string): KnowledgeBaseMeta {
    const id = `kb-${Date.now()}`;
    const dir = this.kbDir(id);
    fs.mkdirSync(dir, { recursive: true });

    const now = Date.now();
    const meta: KnowledgeBaseMeta = {
      id,
      name,
      description,
      chapterCount: 0,
      totalFiles: 0,
      createdAt: now,
      updatedAt: now
    };
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
    fs.writeFileSync(
      path.join(dir, 'index.md'),
      `# ${name}\n\n> ${description}\n\n## 目录\n\n（空知识库，请导入内容）\n`,
      'utf-8'
    );
    log.info(`[KnowledgeStore] Created simple KB: ${id}`);
    return meta;
  }

  /**
   * 从 ZIP 文件导入知识库
   */
  importFromZip(name: string, description: string, zipPath: string): KnowledgeBaseMeta {
    const id = `kb-${Date.now()}`;
    const dir = this.kbDir(id);
    fs.mkdirSync(dir, { recursive: true });

    const zip = new AdmZip(zipPath);
    zip.extractAllTo(dir, true);

    const now = Date.now();
    const meta: KnowledgeBaseMeta = {
      id,
      name,
      description,
      chapterCount: this.countChapters(dir),
      totalFiles: this.countFiles(dir),
      createdAt: now,
      updatedAt: now
    };
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');

    if (!fs.existsSync(path.join(dir, 'index.md'))) {
      const tree = this.buildTree(dir, '');
      const indexContent = this.generateIndexFromTree(name, description, tree);
      fs.writeFileSync(path.join(dir, 'index.md'), indexContent, 'utf-8');
    }

    log.info(`[KnowledgeStore] Imported KB from ZIP: ${id} (${meta.totalFiles} files)`);
    return meta;
  }

  private generateIndexFromTree(name: string, description: string, tree: KnowledgeTreeNode[]): string {
    let content = `# ${name}\n\n> ${description}\n\n## 目录\n\n`;
    for (const node of tree) {
      if (node.type === 'directory') {
        content += `### ${node.name}\n`;
        if (node.children) {
          for (const child of node.children) {
            content += `- ${child.name}\n`;
          }
        }
        content += '\n';
      } else if (node.name !== 'index.md' && node.name !== 'meta.json') {
        content += `- ${node.name}\n`;
      }
    }
    return content;
  }

  /**
   * 由 CreationPipeline release 阶段调用：
   * 根据构建产物初始化一个知识库目录
   */
  createFromPipeline(kbId: string, meta: { name: string; description: string; sourceSessionId?: string }): string {
    const dir = this.kbDir(kbId);
    fs.mkdirSync(dir, { recursive: true });

    const now = Date.now();
    const metaObj: KnowledgeBaseMeta = {
      id: kbId,
      name: meta.name,
      description: meta.description,
      chapterCount: 0,
      totalFiles: 0,
      createdAt: now,
      updatedAt: now,
      sourceSessionId: meta.sourceSessionId
    };
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(metaObj, null, 2), 'utf-8');
    log.info(`[KnowledgeStore] Created KB from pipeline: ${kbId}`);
    return dir;
  }

  writeFile(id: string, filePath: string, content: string): void {
    const fullPath = path.join(this.kbDir(id), filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
  }

  updateMeta(id: string, updates: Partial<KnowledgeBaseMeta>): void {
    const existing = this.get(id);
    if (!existing) return;
    const merged = { ...existing, ...updates, updatedAt: Date.now() };
    fs.writeFileSync(path.join(this.kbDir(id), 'meta.json'), JSON.stringify(merged, null, 2), 'utf-8');
  }

  private buildTree(baseDir: string, relativePath: string): KnowledgeTreeNode[] {
    const fullDir = relativePath ? path.join(baseDir, relativePath) : baseDir;
    const entries = fs.readdirSync(fullDir, { withFileTypes: true });
    const nodes: KnowledgeTreeNode[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'meta.json') continue;
      const rel = relativePath ? `${relativePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        nodes.push({
          name: entry.name,
          path: rel,
          type: 'directory',
          children: this.buildTree(baseDir, rel)
        });
      } else if (entry.name.endsWith('.md')) {
        nodes.push({
          name: entry.name,
          path: rel,
          type: 'file'
        });
      }
    }

    return nodes.sort((a, b) => a.name.localeCompare(b.name));
  }

  private countChapters(dir: string): number {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && /^\d{2}-/.test(e.name)).length;
  }

  private countFiles(dir: string): number {
    let count = 0;
    const walk = (d: string): void => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        if (entry.isDirectory()) {
          walk(path.join(d, entry.name));
        } else if (entry.name.endsWith('.md')) {
          count++;
        }
      }
    };
    walk(dir);
    return count;
  }
}
