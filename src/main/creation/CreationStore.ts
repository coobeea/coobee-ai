import * as fs from 'fs';
import * as path from 'path';
import { Env } from '@main/common/env';
import { log } from '@main/common/logger';
import type {
  CreationSessionMeta,
  CreationStatus,
  FileInfo,
  KnowledgeItem,
  PhaseId,
  PhaseState
} from '@shared/types/creation';
import { PHASE_NUM, PHASE_ORDER } from '@shared/types/creation';

const SESSIONS_DIR = 'creation/sessions';

function defaultPhases(): Record<PhaseId, PhaseState> {
  const phases = {} as Record<PhaseId, PhaseState>;
  for (const id of PHASE_ORDER) {
    phases[id] = { status: 'pending' };
  }
  return phases;
}

function generateSessionId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 8);
  return `creation-${date}-${rand}`;
}

/**
 * 将 CreationSessionMeta 序列化为 00-session.md（YAML frontmatter + Markdown）
 */
function serializeSession(meta: CreationSessionMeta): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push(`id: '${meta.id}'`);
  lines.push(`targetType: ${meta.targetType}`);
  lines.push(`name: '${meta.name}'`);
  lines.push(`status: ${meta.status}`);
  lines.push(`currentPhase: ${meta.currentPhase}`);
  lines.push(`createdAt: ${new Date(meta.createdAt).toISOString()}`);
  lines.push(`updatedAt: ${new Date(meta.updatedAt).toISOString()}`);
  lines.push('---');
  lines.push('');
  lines.push(`# 创建会话：${meta.name}`);
  lines.push('');
  lines.push('## 进度');
  lines.push('');
  lines.push('| Phase | 状态 | 开始时间 | 完成时间 |');
  lines.push('| ----- | ---- | -------- | -------- |');

  const phaseLabels: Record<PhaseId, string> = {
    requirements: '① 需求分析',
    design: '② 方案设计',
    implement: '③ 实施生成',
    validate: '④ 验证测试',
    iterate: '⑤ 迭代优化',
    release: '⑥ 发布'
  };
  const statusIcons: Record<string, string> = {
    pending: '○ 等待',
    running: '🔄 进行中',
    completed: '✅ 完成',
    skipped: '⏭ 跳过',
    failed: '❌ 失败'
  };

  for (const id of PHASE_ORDER) {
    const ps = meta.phases[id];
    const label = phaseLabels[id];
    const status = statusIcons[ps.status] || ps.status;
    const start = ps.startedAt ? new Date(ps.startedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '-';
    const end = ps.completedAt ? new Date(ps.completedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '-';
    lines.push(`| ${label} | ${status} | ${start} | ${end} |`);
  }

  if (meta.knowledgeBase.length > 0) {
    lines.push('');
    lines.push('## 知识库');
    lines.push('');
    for (const kb of meta.knowledgeBase) {
      lines.push(`- \`${kb.name}\` — ${kb.type}`);
    }
  }

  lines.push('');
  lines.push('## 原始需求');
  lines.push('');
  lines.push(meta.userRequirement);
  lines.push('');

  return lines.join('\n');
}

/**
 * 解析 00-session.md 的 YAML frontmatter 还原 meta 的关键字段
 */
function parseSessionFrontmatter(content: string): Partial<CreationSessionMeta> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const yaml = match[1];
  const result: Record<string, string> = {};
  for (const line of yaml.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }

  return {
    id: result.id,
    targetType: result.targetType as CreationSessionMeta['targetType'],
    name: result.name,
    status: result.status as CreationStatus,
    currentPhase: result.currentPhase as PhaseId,
    createdAt: result.createdAt ? new Date(result.createdAt).getTime() : undefined,
    updatedAt: result.updatedAt ? new Date(result.updatedAt).getTime() : undefined
  };
}

export class CreationStore {
  private static instance: CreationStore;
  private sessionsRoot: string;

  private constructor() {
    this.sessionsRoot = path.join(Env.paths.userHome, SESSIONS_DIR);
    fs.mkdirSync(this.sessionsRoot, { recursive: true });
  }

  static getInstance(): CreationStore {
    if (!CreationStore.instance) {
      CreationStore.instance = new CreationStore();
    }
    return CreationStore.instance;
  }

  private sessionDir(sessionId: string): string {
    return path.join(this.sessionsRoot, sessionId);
  }

  private sessionFile(sessionId: string): string {
    return path.join(this.sessionDir(sessionId), '00-session.md');
  }

  createSession(targetType: CreationSessionMeta['targetType'], name: string, requirement: string): CreationSessionMeta {
    const now = Date.now();
    const meta: CreationSessionMeta = {
      id: generateSessionId(),
      targetType,
      name,
      userRequirement: requirement,
      status: 'requirements',
      currentPhase: 'requirements',
      phases: defaultPhases(),
      knowledgeBase: [],
      createdAt: now,
      updatedAt: now
    };

    const dir = this.sessionDir(meta.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(dir, 'knowledge'), { recursive: true });
    this.saveMeta(meta);

    log.info(`[CreationStore] Created session: ${meta.id} (${targetType}: ${name})`);
    return meta;
  }

  saveMeta(meta: CreationSessionMeta): void {
    meta.updatedAt = Date.now();
    const content = serializeSession(meta);
    fs.writeFileSync(this.sessionFile(meta.id), content, 'utf-8');
  }

  loadMeta(sessionId: string): CreationSessionMeta | null {
    const filePath = this.sessionFile(sessionId);
    if (!fs.existsSync(filePath)) return null;

    const content = fs.readFileSync(filePath, 'utf-8');
    const partial = parseSessionFrontmatter(content);
    if (!partial.id) return null;

    const metaJsonPath = path.join(this.sessionDir(sessionId), '.meta.json');
    if (fs.existsSync(metaJsonPath)) {
      try {
        return JSON.parse(fs.readFileSync(metaJsonPath, 'utf-8')) as CreationSessionMeta;
      } catch {
        // fallback
      }
    }

    return {
      id: partial.id || sessionId,
      targetType: partial.targetType || 'skill',
      name: partial.name || '',
      userRequirement: '',
      status: partial.status || 'requirements',
      currentPhase: partial.currentPhase || 'requirements',
      phases: defaultPhases(),
      knowledgeBase: [],
      createdAt: partial.createdAt || 0,
      updatedAt: partial.updatedAt || 0
    };
  }

  /**
   * 保存完整的 meta JSON（用于精确还原 phases、knowledgeBase 等）
   */
  saveMetaJson(meta: CreationSessionMeta): void {
    const jsonPath = path.join(this.sessionDir(meta.id), '.meta.json');
    fs.writeFileSync(jsonPath, JSON.stringify(meta, null, 2), 'utf-8');
  }

  listSessions(): CreationSessionMeta[] {
    if (!fs.existsSync(this.sessionsRoot)) return [];

    const entries = fs.readdirSync(this.sessionsRoot, { withFileTypes: true });
    const sessions: CreationSessionMeta[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = this.loadMeta(entry.name);
      if (meta) sessions.push(meta);
    }

    return sessions.sort((a, b) => b.createdAt - a.createdAt);
  }

  deleteSession(sessionId: string): boolean {
    const dir = this.sessionDir(sessionId);
    if (!fs.existsSync(dir)) return false;
    fs.rmSync(dir, { recursive: true, force: true });
    log.info(`[CreationStore] Deleted session: ${sessionId}`);
    return true;
  }

  writeFile(sessionId: string, filename: string, content: string): void {
    const filePath = path.join(this.sessionDir(sessionId), filename);
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  readFile(sessionId: string, filename: string): string | null {
    const filePath = path.join(this.sessionDir(sessionId), filename);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  }

  listFiles(sessionId: string): FileInfo[] {
    const dir = this.sessionDir(sessionId);
    if (!fs.existsSync(dir)) return [];

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: FileInfo[] = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (entry.name.startsWith('.')) continue;
      if (!entry.name.endsWith('.md')) continue;

      const stat = fs.statSync(path.join(dir, entry.name));
      const phase = this.inferPhase(entry.name);

      files.push({
        filename: entry.name,
        phase,
        status: 'completed',
        size: stat.size,
        updatedAt: stat.mtimeMs
      });
    }

    return files.sort((a, b) => a.filename.localeCompare(b.filename));
  }

  listKnowledgeFiles(sessionId: string): string[] {
    const kDir = path.join(this.sessionDir(sessionId), 'knowledge');
    if (!fs.existsSync(kDir)) return [];
    return fs.readdirSync(kDir).filter((f) => !f.startsWith('.'));
  }

  addKnowledge(sessionId: string, item: KnowledgeItem): void {
    if (item.type === 'text' && item.content) {
      const kDir = path.join(this.sessionDir(sessionId), 'knowledge');
      fs.mkdirSync(kDir, { recursive: true });
      fs.writeFileSync(path.join(kDir, item.name), item.content, 'utf-8');
    } else if (item.type === 'file' && item.path) {
      const kDir = path.join(this.sessionDir(sessionId), 'knowledge');
      fs.mkdirSync(kDir, { recursive: true });
      fs.copyFileSync(item.path, path.join(kDir, item.name));
    }
  }

  removeKnowledge(sessionId: string, name: string): boolean {
    const filePath = path.join(this.sessionDir(sessionId), 'knowledge', name);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  }

  // ==================== Chat Transcript ====================

  private transcriptPath(sessionId: string): string {
    return path.join(this.sessionDir(sessionId), '.chat-transcript.json');
  }

  loadTranscript(sessionId: string): { role: 'user' | 'assistant'; content: string }[] {
    const fp = this.transcriptPath(sessionId);
    if (!fs.existsSync(fp)) return [];
    try {
      return JSON.parse(fs.readFileSync(fp, 'utf-8'));
    } catch {
      return [];
    }
  }

  appendTranscript(sessionId: string, messages: { role: 'user' | 'assistant'; content: string }[]): void {
    const existing = this.loadTranscript(sessionId);
    existing.push(...messages);
    fs.writeFileSync(this.transcriptPath(sessionId), JSON.stringify(existing, null, 2), 'utf-8');
  }

  private inferPhase(filename: string): FileInfo['phase'] {
    if (filename === '00-session.md') return 'meta';
    const prefix = filename.split('-')[0];
    const num = parseInt(prefix);
    if (isNaN(num)) return 'meta';

    for (const [phaseId, phaseNum] of Object.entries(PHASE_NUM)) {
      if (phaseNum === num) return phaseId as PhaseId;
    }
    return 'meta';
  }
}
