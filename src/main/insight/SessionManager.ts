/**
 * SessionManager — 洞察会话生命周期管理
 *
 * 管理会话的创建、暂停、恢复、结束。
 * 存储路径: ~/.coobee-data/insight/sessions/{date}/
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { log } from '@main/common/logger';
import type { InsightSession, InsightSessionStatus, AnalysisResult } from '@shared/types/insight';

export class SessionManager {
  private dataDir: string;
  private active: InsightSession | null = null;

  constructor(dataRoot: string) {
    this.dataDir = path.join(dataRoot, 'insight', 'sessions');
    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  start(templateId: string, templateName: string): InsightSession {
    if (this.active && this.active.status !== 'completed') {
      throw new Error('已有活跃洞察会话，请先结束当前会话');
    }
    const now = Date.now();
    const session: InsightSession = {
      id: `insight-${now}`,
      templateId,
      templateName,
      status: 'recording',
      startTime: now,
      transcript: '',
      snapshotCount: 0
    };
    this.active = session;
    this.save(session);
    log.info(`[SessionManager] Started session ${session.id}, template=${templateId}`);
    return session;
  }

  pause(sessionId: string): InsightSession | null {
    if (!this.active || this.active.id !== sessionId) return null;
    this.active.status = 'paused';
    this.save(this.active);
    return this.active;
  }

  resume(sessionId: string): InsightSession | null {
    if (!this.active || this.active.id !== sessionId) return null;
    if (this.active.status !== 'paused') return null;
    this.active.status = 'recording';
    this.save(this.active);
    return this.active;
  }

  complete(sessionId: string): InsightSession | null {
    if (!this.active || this.active.id !== sessionId) return null;
    this.active.status = 'completed';
    this.active.endTime = Date.now();
    this.save(this.active);
    const completed = this.active;
    this.active = null;
    log.info(`[SessionManager] Completed session ${sessionId}`);
    return completed;
  }

  updateStatus(sessionId: string, status: InsightSessionStatus): void {
    if (!this.active || this.active.id !== sessionId) return;
    this.active.status = status;
    this.save(this.active);
  }

  appendTranscript(sessionId: string, text: string): void {
    if (!this.active || this.active.id !== sessionId) return;
    this.active.transcript += text;
    this.save(this.active);
  }

  updateLatestResult(sessionId: string, result: AnalysisResult, snapshotCount: number): void {
    if (!this.active || this.active.id !== sessionId) return;
    this.active.latestResult = result;
    this.active.snapshotCount = snapshotCount;
    this.save(this.active);
  }

  getActive(): InsightSession | null {
    return this.active;
  }

  get(sessionId: string): InsightSession | null {
    if (this.active?.id === sessionId) return this.active;
    return this.loadFromDisk(sessionId);
  }

  list(filter?: { date?: string }): InsightSession[] {
    const sessions: InsightSession[] = [];
    try {
      const dateDirs = fs.readdirSync(this.dataDir).filter((d) => {
        const fullPath = path.join(this.dataDir, d);
        return fs.statSync(fullPath).isDirectory();
      });

      const dirs = filter?.date ? dateDirs.filter((d) => d === filter.date) : dateDirs;

      for (const dir of dirs.sort().reverse()) {
        const dirPath = path.join(this.dataDir, dir);
        const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.json') && !f.includes('snapshots'));
        for (const file of files) {
          try {
            const raw = fs.readFileSync(path.join(dirPath, file), 'utf-8');
            sessions.push(JSON.parse(raw) as InsightSession);
          } catch {
            /* skip corrupt files */
          }
        }
      }
    } catch {
      /* dir may not exist yet */
    }

    return sessions.sort((a, b) => b.startTime - a.startTime);
  }

  deleteSession(sessionId: string): boolean {
    const dateDir = this.findSessionDir(sessionId);
    if (!dateDir) return false;
    const sessionFile = path.join(dateDir, `${sessionId}.json`);
    const snapshotDir = path.join(dateDir, sessionId);
    try {
      if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
      if (fs.existsSync(snapshotDir)) fs.rmSync(snapshotDir, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }

  private save(session: InsightSession): void {
    const dateStr = new Date(session.startTime).toISOString().slice(0, 10);
    const dateDir = path.join(this.dataDir, dateStr);
    fs.mkdirSync(dateDir, { recursive: true });

    const { transcript: _t, latestResult: _r, ...meta } = session;
    const filePath = path.join(dateDir, `${session.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify({ ...meta, snapshotCount: session.snapshotCount }, null, 2), 'utf-8');

    const transcriptPath = path.join(dateDir, session.id);
    fs.mkdirSync(transcriptPath, { recursive: true });
    fs.writeFileSync(path.join(transcriptPath, 'transcript.txt'), session.transcript, 'utf-8');

    if (session.latestResult) {
      fs.writeFileSync(
        path.join(transcriptPath, 'latest-result.json'),
        JSON.stringify(session.latestResult, null, 2),
        'utf-8'
      );
    }
  }

  private loadFromDisk(sessionId: string): InsightSession | null {
    const dateDir = this.findSessionDir(sessionId);
    if (!dateDir) return null;
    try {
      const metaPath = path.join(dateDir, `${sessionId}.json`);
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as InsightSession;
      const transcriptPath = path.join(dateDir, sessionId, 'transcript.txt');
      meta.transcript = fs.existsSync(transcriptPath) ? fs.readFileSync(transcriptPath, 'utf-8') : '';
      const resultPath = path.join(dateDir, sessionId, 'latest-result.json');
      if (fs.existsSync(resultPath)) {
        meta.latestResult = JSON.parse(fs.readFileSync(resultPath, 'utf-8')) as AnalysisResult;
      }
      return meta;
    } catch {
      return null;
    }
  }

  private findSessionDir(sessionId: string): string | null {
    try {
      const dateDirs = fs.readdirSync(this.dataDir);
      for (const dir of dateDirs) {
        const filePath = path.join(this.dataDir, dir, `${sessionId}.json`);
        if (fs.existsSync(filePath)) return path.join(this.dataDir, dir);
      }
    } catch {
      /* ignore */
    }
    return null;
  }
}
