/**
 * SnapshotStore — 分析快照存储
 *
 * 存储和查询分析快照。快照保存在会话目录下。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { log } from '@main/common/logger';
import type { AnalysisSnapshot, DimensionChange } from '@shared/types/insight';

interface SnapshotsFile {
  sessionId: string;
  snapshots: AnalysisSnapshot[];
}

export class SnapshotStore {
  private dataDir: string;

  constructor(dataRoot: string) {
    this.dataDir = path.join(dataRoot, 'insight', 'sessions');
  }

  save(snapshot: AnalysisSnapshot): void {
    const file = this.getSnapshotsFile(snapshot.sessionId);
    const data = this.readFile(file, snapshot.sessionId);
    data.snapshots.push(snapshot);
    this.writeFile(file, data);
    log.info(`[SnapshotStore] Saved snapshot #${snapshot.sequence} for session ${snapshot.sessionId}`);
  }

  getAll(sessionId: string): AnalysisSnapshot[] {
    const file = this.getSnapshotsFile(sessionId);
    return this.readFile(file, sessionId).snapshots;
  }

  getBySequence(sessionId: string, sequence: number): AnalysisSnapshot | null {
    const all = this.getAll(sessionId);
    return all.find((s) => s.sequence === sequence) ?? null;
  }

  getById(sessionId: string, snapshotId: string): AnalysisSnapshot | null {
    const all = this.getAll(sessionId);
    return all.find((s) => s.id === snapshotId) ?? null;
  }

  compare(sessionId: string, seq1: number, seq2: number): DimensionChange[] {
    const snap1 = this.getBySequence(sessionId, seq1);
    const snap2 = this.getBySequence(sessionId, seq2);
    if (!snap1 || !snap2) return [];

    const changes: DimensionChange[] = [];
    const allKeys = new Set([...Object.keys(snap1.result.dimensions), ...Object.keys(snap2.result.dimensions)]);

    for (const key of allKeys) {
      const d1 = snap1.result.dimensions[key];
      const d2 = snap2.result.dimensions[key];
      if (!d1 || !d2) continue;

      const prev = JSON.stringify(d1.value);
      const curr = JSON.stringify(d2.value);
      if (prev !== curr) {
        changes.push({
          key,
          label: d2.label,
          previousValue: d1.value,
          currentValue: d2.value,
          direction: this.detectDirection(d1.value, d2.value)
        });
      }
    }
    return changes;
  }

  private detectDirection(prev: unknown, curr: unknown): DimensionChange['direction'] {
    if (typeof prev === 'number' && typeof curr === 'number') {
      if (curr > prev) return 'up';
      if (curr < prev) return 'down';
      return 'stable';
    }
    return 'changed';
  }

  private getSnapshotsFile(sessionId: string): string {
    const dateDirs = this.findSessionDateDir(sessionId);
    if (dateDirs) return path.join(dateDirs, sessionId, 'snapshots.json');
    const today = new Date().toISOString().slice(0, 10);
    const dir = path.join(this.dataDir, today, sessionId);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'snapshots.json');
  }

  private findSessionDateDir(sessionId: string): string | null {
    try {
      const dateDirs = fs.readdirSync(this.dataDir);
      for (const dir of dateDirs) {
        const sessionDir = path.join(this.dataDir, dir, sessionId);
        if (fs.existsSync(sessionDir)) return path.join(this.dataDir, dir);
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  private readFile(filePath: string, sessionId: string): SnapshotsFile {
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SnapshotsFile;
      }
    } catch {
      /* ignore */
    }
    return { sessionId, snapshots: [] };
  }

  private writeFile(filePath: string, data: SnapshotsFile): void {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }
}
