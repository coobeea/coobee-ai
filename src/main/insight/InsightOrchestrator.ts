/**
 * InsightOrchestrator — 洞察会话编排器
 *
 * 将 SessionManager、SnapshotStore、TranscriptBuffer、AnalysisTrigger、InsightAnalyzer
 * 组合在一起，提供统一的操作入口。每个活跃会话有自己的 buffer 和 trigger。
 */

import { log } from '@main/common/logger';
import { Env } from '@main/common/env';
import { TemplateStore } from './TemplateStore';
import { SessionManager } from './SessionManager';
import { SnapshotStore } from './SnapshotStore';
import { TranscriptBuffer } from './TranscriptBuffer';
import { AnalysisTrigger } from './AnalysisTrigger';
import { InsightAnalyzer } from './InsightAnalyzer';
import type { AnalysisSnapshot, InsightSession, AnalysisTemplate, SessionConfig } from '@shared/types/insight';

export class InsightOrchestrator {
  private templateStore: TemplateStore;
  private sessionManager: SessionManager;
  private snapshotStore: SnapshotStore;
  private analyzer: InsightAnalyzer;
  private buffer: TranscriptBuffer | null = null;
  private trigger: AnalysisTrigger | null = null;

  private static instance: InsightOrchestrator | null = null;

  static getInstance(): InsightOrchestrator {
    if (!InsightOrchestrator.instance) {
      InsightOrchestrator.instance = new InsightOrchestrator();
    }
    return InsightOrchestrator.instance;
  }

  private constructor() {
    const dataRoot = Env.paths.userHome;
    this.templateStore = new TemplateStore(dataRoot);
    this.sessionManager = new SessionManager(dataRoot);
    this.snapshotStore = new SnapshotStore(dataRoot);
    this.analyzer = new InsightAnalyzer();
  }

  // ==================== Template ====================

  listTemplates(): AnalysisTemplate[] {
    return this.templateStore.list();
  }

  getTemplate(id: string): AnalysisTemplate | null {
    return this.templateStore.get(id);
  }

  createTemplate(input: Omit<AnalysisTemplate, 'id' | 'createdAt' | 'updatedAt' | 'builtIn'>): AnalysisTemplate {
    return this.templateStore.create(input);
  }

  updateTemplate(id: string, updates: Partial<AnalysisTemplate>): AnalysisTemplate | null {
    return this.templateStore.update(id, updates);
  }

  deleteTemplate(id: string): boolean {
    return this.templateStore.delete(id);
  }

  // ==================== Session ====================

  startSession(templateId: string): InsightSession {
    const template = this.templateStore.get(templateId);
    if (!template) throw new Error(`模板 ${templateId} 不存在`);

    const session = this.sessionManager.start(templateId, template.name);

    this.buffer = new TranscriptBuffer();
    this.trigger = new AnalysisTrigger(template.refreshStrategy, () => this.runAnalysis());

    log.info(`[InsightOrchestrator] Session started: ${session.id}`);
    return session;
  }

  pauseSession(sessionId: string): InsightSession | null {
    this.trigger?.destroy();
    this.trigger = null;
    return this.sessionManager.pause(sessionId);
  }

  resumeSession(sessionId: string): InsightSession | null {
    const session = this.sessionManager.resume(sessionId);
    if (!session) return null;

    const template = this.templateStore.get(session.templateId);
    if (template) {
      this.trigger = new AnalysisTrigger(template.refreshStrategy, () => this.runAnalysis());
    }
    return session;
  }

  completeSession(sessionId: string): InsightSession | null {
    this.trigger?.destroy();
    this.trigger = null;
    this.buffer = null;
    return this.sessionManager.complete(sessionId);
  }

  getActiveSession(): InsightSession | null {
    return this.sessionManager.getActive();
  }

  getSession(sessionId: string): InsightSession | null {
    return this.sessionManager.get(sessionId);
  }

  listSessions(filter?: { date?: string }): InsightSession[] {
    return this.sessionManager.list(filter);
  }

  deleteSession(sessionId: string): boolean {
    return this.sessionManager.deleteSession(sessionId);
  }

  updateSessionConfig(sessionId: string, config: SessionConfig): InsightSession | null {
    const active = this.sessionManager.getActive();
    if (!active || active.id !== sessionId) return null;

    active.config = { ...active.config, ...config };

    if (config.refreshStrategy && this.trigger) {
      this.trigger.destroy();
      this.trigger = new AnalysisTrigger(config.refreshStrategy, () => this.runAnalysis());
    }

    this.sessionManager.patchSession(sessionId, { config: active.config });
    log.info(`[InsightOrchestrator] Session config updated: ${sessionId}`);
    return active;
  }

  // ==================== Transcript ====================

  appendTranscript(sessionId: string, text: string): void {
    const active = this.sessionManager.getActive();
    if (!active || active.id !== sessionId || !this.buffer) return;

    this.buffer.append(text);
    this.sessionManager.appendTranscript(sessionId, text);
    this.trigger?.onTextAppended(text);
  }

  notifySilence(sessionId: string): void {
    const active = this.sessionManager.getActive();
    if (!active || active.id !== sessionId) return;
    this.trigger?.onSilenceDetected();
  }

  triggerAnalysis(sessionId: string): void {
    const active = this.sessionManager.getActive();
    if (!active || active.id !== sessionId) return;
    this.trigger?.onManualTrigger();
  }

  // ==================== Snapshots ====================

  getSnapshots(sessionId: string): AnalysisSnapshot[] {
    return this.snapshotStore.getAll(sessionId);
  }

  getSnapshot(sessionId: string, snapshotId: string): AnalysisSnapshot | null {
    return this.snapshotStore.getById(sessionId, snapshotId);
  }

  // ==================== Internal ====================

  private async runAnalysis(): Promise<void> {
    const session = this.sessionManager.getActive();
    if (!session || !this.buffer) return;

    const baseTemplate = this.templateStore.get(session.templateId);
    if (!baseTemplate) return;

    const template: AnalysisTemplate = session.config
      ? {
          ...baseTemplate,
          analysisPrompt: session.config.analysisPrompt ?? baseTemplate.analysisPrompt,
          dimensions: session.config.dimensions ?? baseTemplate.dimensions,
          refreshStrategy: session.config.refreshStrategy ?? baseTemplate.refreshStrategy
        }
      : baseTemplate;

    const fullTranscript = this.buffer.getFullText();
    const newText = this.buffer.getNewText();
    if (!newText.trim()) return;

    const existingSnapshots = this.snapshotStore.getAll(session.id);
    const sequence = existingSnapshots.length + 1;

    this.sessionManager.updateStatus(session.id, 'analyzing');
    log.info(`[InsightOrchestrator] Running analysis #${sequence} for session ${session.id}`);

    const startTime = Date.now();
    try {
      const { result, changes } = await this.analyzer.analyze({
        template,
        fullTranscript,
        newText,
        previousResult: session.latestResult,
        snapshotSequence: sequence
      });

      const snapshot: AnalysisSnapshot = {
        id: `snap-${String(sequence).padStart(3, '0')}`,
        sessionId: session.id,
        sequence,
        timestamp: Date.now(),
        trigger: 'manual',
        transcriptRange: {
          start: this.buffer.getLastAnalyzedPos(),
          end: fullTranscript.length
        },
        fullTranscript,
        newText,
        result,
        changes,
        latencyMs: Date.now() - startTime
      };

      this.snapshotStore.save(snapshot);
      this.buffer.markAnalyzed();
      this.sessionManager.updateLatestResult(session.id, result, sequence);
      this.sessionManager.updateStatus(session.id, 'recording');

      log.info(`[InsightOrchestrator] Analysis #${sequence} complete (${snapshot.latencyMs}ms)`);
    } catch (err) {
      log.error(`[InsightOrchestrator] Analysis #${sequence} failed:`, err);
      this.sessionManager.updateStatus(session.id, 'recording');
    }
  }
}
