import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SnapshotStore } from '../SnapshotStore';
import type { AnalysisSnapshot } from '@shared/types/insight';

describe('SnapshotStore', () => {
  let tmpDir: string;
  let store: SnapshotStore;
  const sessionId = 'insight-test-session';

  function makeSnapshot(seq: number): AnalysisSnapshot {
    return {
      id: `snap-${String(seq).padStart(3, '0')}`,
      sessionId,
      sequence: seq,
      timestamp: Date.now(),
      trigger: 'manual',
      transcriptRange: { start: 0, end: 100 * seq },
      fullTranscript: 'test text '.repeat(10 * seq),
      newText: 'new text '.repeat(seq),
      result: {
        dimensions: {
          test_dim: {
            key: 'test_dim',
            label: 'Test',
            type: 'score',
            value: 50 + seq * 10
          }
        },
        summary: `Summary for snapshot ${seq}`,
        confidence: 0.7 + seq * 0.05
      },
      latencyMs: 1000 + seq * 100
    };
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-test-'));
    const dateDir = new Date().toISOString().slice(0, 10);
    fs.mkdirSync(path.join(tmpDir, 'insight', 'sessions', dateDir, sessionId), { recursive: true });
    store = new SnapshotStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saves and retrieves snapshots', () => {
    store.save(makeSnapshot(1));
    store.save(makeSnapshot(2));
    const all = store.getAll(sessionId);
    expect(all).toHaveLength(2);
    expect(all[0].sequence).toBe(1);
    expect(all[1].sequence).toBe(2);
  });

  it('gets snapshot by sequence', () => {
    store.save(makeSnapshot(1));
    store.save(makeSnapshot(2));
    const snap = store.getBySequence(sessionId, 2);
    expect(snap).not.toBeNull();
    expect(snap!.sequence).toBe(2);
  });

  it('gets snapshot by id', () => {
    store.save(makeSnapshot(1));
    const snap = store.getById(sessionId, 'snap-001');
    expect(snap).not.toBeNull();
    expect(snap!.id).toBe('snap-001');
  });

  it('returns empty array for unknown session', () => {
    const all = store.getAll('nonexistent');
    expect(all).toHaveLength(0);
  });

  it('compares two snapshots', () => {
    store.save(makeSnapshot(1));
    store.save(makeSnapshot(2));
    const changes = store.compare(sessionId, 1, 2);
    expect(changes.length).toBeGreaterThan(0);
    const testChange = changes.find((c) => c.key === 'test_dim');
    expect(testChange).toBeDefined();
    expect(testChange!.direction).toBe('up');
  });
});
