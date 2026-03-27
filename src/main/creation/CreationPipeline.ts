import { ChannelRuntime } from '@main/channels/ChannelRuntime';
import { log } from '@main/common/logger';
import { eventBus } from '@main/common/eventbus';
import { CreationStore } from './CreationStore';
import type { CreationSessionMeta, PhaseId, CreationTargetType } from '@shared/types/creation';
import { PHASE_ORDER, PHASE_AGENTS, PHASE_LABELS } from '@shared/types/creation';

const MAX_ITERATIONS = 2;

export class CreationPipeline {
  private static instance: CreationPipeline;
  private store: CreationStore;
  private runningSessionIds = new Set<string>();

  private constructor() {
    this.store = CreationStore.getInstance();
  }

  static getInstance(): CreationPipeline {
    if (!CreationPipeline.instance) {
      CreationPipeline.instance = new CreationPipeline();
    }
    return CreationPipeline.instance;
  }

  async start(userRequirement: string, targetType: CreationTargetType): Promise<CreationSessionMeta> {
    const name = this.extractName(userRequirement);
    const meta = this.store.createSession(targetType, name, userRequirement);
    meta.phases.requirements.status = 'running';
    meta.phases.requirements.startedAt = Date.now();
    this.store.saveMeta(meta);
    this.store.saveMetaJson(meta);
    return meta;
  }

  /**
   * Phase 1：处理用户对话消息
   * 返回 Agent 的回复文本
   */
  async chat(sessionId: string, message: string): Promise<string> {
    const meta = this.store.loadMeta(sessionId);
    if (!meta) throw new Error(`Session ${sessionId} not found`);
    if (meta.status !== 'requirements') {
      throw new Error(`Session is not in requirements phase (current: ${meta.status})`);
    }

    const runtime = ChannelRuntime.getInstance();
    const result = await runtime.executeAgent({
      agentId: PHASE_AGENTS.requirements,
      sessionId: `creation-${sessionId}-req`,
      message,
      context: { channel: 'creation', sessionId, phase: 'requirements' }
    });

    if (result.error) {
      log.error(`[CreationPipeline] Phase 1 chat error: ${result.error}`);
    }

    return result.output;
  }

  /**
   * Phase 1 完成后：写入标准化文件集并启动自动执行
   */
  async finishRequirements(sessionId: string, files: { filename: string; content: string }[]): Promise<void> {
    const meta = this.store.loadMeta(sessionId);
    if (!meta) throw new Error(`Session ${sessionId} not found`);

    for (const file of files) {
      this.store.writeFile(sessionId, file.filename, file.content);
      eventBus.emit('creation:file-created', { sessionId, filename: file.filename, phase: 'requirements' });
    }

    meta.phases.requirements.status = 'completed';
    meta.phases.requirements.completedAt = Date.now();
    this.store.saveMeta(meta);
    this.store.saveMetaJson(meta);

    eventBus.emit('creation:requirements-ready', { sessionId, files: files.map((f) => f.filename) });
  }

  /**
   * 启动 Phase 2-6 自动执行
   */
  async launchAutopilot(sessionId: string): Promise<void> {
    const meta = this.store.loadMeta(sessionId);
    if (!meta) throw new Error(`Session ${sessionId} not found`);

    if (meta.phases.requirements.status !== 'completed') {
      throw new Error('Requirements phase must be completed before launching autopilot');
    }

    if (this.runningSessionIds.has(sessionId)) {
      throw new Error('Autopilot is already running for this session');
    }

    meta.status = 'autopilot';
    this.store.saveMeta(meta);
    this.store.saveMetaJson(meta);

    this.runAutopilot(sessionId).catch((err) => {
      log.error(`[CreationPipeline] Autopilot failed for ${sessionId}:`, err);
    });
  }

  async pause(sessionId: string): Promise<void> {
    this.runningSessionIds.delete(sessionId);
    const meta = this.store.loadMeta(sessionId);
    if (meta) {
      meta.status = 'paused';
      this.store.saveMeta(meta);
      this.store.saveMetaJson(meta);
    }
  }

  async resume(sessionId: string): Promise<void> {
    const meta = this.store.loadMeta(sessionId);
    if (!meta) throw new Error(`Session ${sessionId} not found`);

    meta.status = 'autopilot';
    this.store.saveMeta(meta);
    this.store.saveMetaJson(meta);

    this.runAutopilot(sessionId).catch((err) => {
      log.error(`[CreationPipeline] Resume failed for ${sessionId}:`, err);
    });
  }

  getSession(sessionId: string): CreationSessionMeta | null {
    return this.store.loadMeta(sessionId);
  }

  listSessions(): CreationSessionMeta[] {
    return this.store.listSessions();
  }

  deleteSession(sessionId: string): boolean {
    this.runningSessionIds.delete(sessionId);
    return this.store.deleteSession(sessionId);
  }

  private async runAutopilot(sessionId: string): Promise<void> {
    this.runningSessionIds.add(sessionId);
    const runtime = ChannelRuntime.getInstance();

    let iterationCount = 0;
    const autopilotPhases: PhaseId[] = ['design', 'implement', 'validate', 'iterate', 'release'];

    let meta = this.store.loadMeta(sessionId);
    if (!meta) return;

    const startIdx = autopilotPhases.findIndex((p) => meta!.phases[p].status !== 'completed');
    const phasesToRun = startIdx >= 0 ? autopilotPhases.slice(startIdx) : [];

    for (const phaseId of phasesToRun) {
      if (!this.runningSessionIds.has(sessionId)) {
        log.info(`[CreationPipeline] Autopilot paused for ${sessionId}`);
        return;
      }

      meta = this.store.loadMeta(sessionId);
      if (!meta) return;

      if (phaseId === 'iterate') {
        const validationContent = this.store.readFile(sessionId, this.findLatestValidationFile(sessionId));
        if (validationContent && !this.validationFailed(validationContent)) {
          meta.phases.iterate.status = 'skipped';
          meta.currentPhase = 'release';
          this.store.saveMeta(meta);
          this.store.saveMetaJson(meta);
          continue;
        }

        if (iterationCount >= MAX_ITERATIONS) {
          meta.phases.iterate.status = 'skipped';
          meta.currentPhase = 'release';
          this.store.saveMeta(meta);
          this.store.saveMetaJson(meta);
          log.info(`[CreationPipeline] Max iterations reached for ${sessionId}`);
          continue;
        }
      }

      log.info(`[CreationPipeline] Starting phase ${phaseId} for ${sessionId}`);

      meta.currentPhase = phaseId;
      meta.phases[phaseId].status = 'running';
      meta.phases[phaseId].startedAt = Date.now();
      this.store.saveMeta(meta);
      this.store.saveMetaJson(meta);

      eventBus.emit('creation:phase-started', {
        sessionId,
        phaseId,
        agentId: PHASE_AGENTS[phaseId],
        label: PHASE_LABELS[phaseId]
      });

      try {
        let agentId = PHASE_AGENTS[phaseId];
        if (phaseId === 'implement' && meta.targetType === 'agent') {
          agentId = 'agent-builder';
        }

        const context = this.buildPhaseContext(sessionId, phaseId);
        const result = await runtime.executeAgent({
          agentId,
          sessionId: `creation-${sessionId}-${phaseId}`,
          message: context,
          context: { channel: 'creation', sessionId, phase: phaseId }
        });

        if (result.error) {
          throw new Error(result.error);
        }

        const outputFilename = this.getPhaseOutputFilename(phaseId, sessionId, iterationCount);
        this.store.writeFile(sessionId, outputFilename, result.output);
        eventBus.emit('creation:file-created', { sessionId, filename: outputFilename, phase: phaseId });

        meta = this.store.loadMeta(sessionId);
        if (!meta) return;

        meta.phases[phaseId].status = 'completed';
        meta.phases[phaseId].completedAt = Date.now();
        this.store.saveMeta(meta);
        this.store.saveMetaJson(meta);

        eventBus.emit('creation:phase-complete', {
          sessionId,
          phaseId,
          summary: `${PHASE_LABELS[phaseId]} 完成`
        });

        if (phaseId === 'validate') {
          if (this.validationFailed(result.output) && iterationCount < MAX_ITERATIONS) {
            iterationCount++;
            const iterateIdx = autopilotPhases.indexOf('implement');
            const remaining = autopilotPhases.slice(iterateIdx);
            for (const p of remaining) {
              if (p !== 'release') {
                meta.phases[p].status = 'pending';
                meta.phases[p].startedAt = undefined;
                meta.phases[p].completedAt = undefined;
              }
            }
            meta.currentPhase = 'implement';
            this.store.saveMeta(meta);
            this.store.saveMetaJson(meta);

            const backIdx = phasesToRun.indexOf('implement');
            if (backIdx >= 0) {
              phasesToRun.splice(0, phasesToRun.indexOf(phaseId) + 1, ...autopilotPhases.slice(iterateIdx));
            }
          }
        }
      } catch (err) {
        log.error(`[CreationPipeline] Phase ${phaseId} failed for ${sessionId}:`, err);

        meta = this.store.loadMeta(sessionId);
        if (!meta) return;

        meta.phases[phaseId].status = 'failed';
        meta.phases[phaseId].error = err instanceof Error ? err.message : String(err);
        meta.status = 'paused';
        this.store.saveMeta(meta);
        this.store.saveMetaJson(meta);

        eventBus.emit('creation:needs-attention', {
          sessionId,
          phaseId,
          reason: err instanceof Error ? err.message : String(err)
        });

        this.runningSessionIds.delete(sessionId);
        return;
      }
    }

    meta = this.store.loadMeta(sessionId);
    if (meta) {
      meta.status = 'completed';
      this.store.saveMeta(meta);
      this.store.saveMetaJson(meta);
    }

    this.runningSessionIds.delete(sessionId);
    eventBus.emit('creation:completed', { sessionId });
    log.info(`[CreationPipeline] Session ${sessionId} completed`);
  }

  private buildPhaseContext(sessionId: string, phaseId: PhaseId): string {
    const files = this.store.listFiles(sessionId);
    const targetPhaseNum = PHASE_ORDER.indexOf(phaseId) + 1;
    const priorFiles = files.filter((f) => {
      if (f.filename === '00-session.md') return true;
      const prefix = parseInt(f.filename.split('-')[0]);
      return !isNaN(prefix) && prefix < targetPhaseNum;
    });

    let context = '';
    for (const file of priorFiles) {
      const content = this.store.readFile(sessionId, file.filename);
      if (content) {
        context += `## 📄 ${file.filename}\n\n${content}\n\n---\n\n`;
      }
    }

    const kFiles = this.store.listKnowledgeFiles(sessionId);
    if (kFiles.length > 0) {
      context += `## 📁 知识库（${kFiles.length} 个文件）\n\n`;
      for (const kf of kFiles) {
        const kContent = this.store.readFile(sessionId, `knowledge/${kf}`);
        if (kContent) {
          const truncated = kContent.length > 2000 ? kContent.slice(0, 2000) + '\n\n...(截断)' : kContent;
          context += `### ${kf}\n\n${truncated}\n\n`;
        }
      }
    }

    context += `\n\n请根据以上上下文，执行 **${PHASE_LABELS[phaseId]}** 阶段的任务。`;
    context += `\n输出格式为 Markdown，直接输出文件内容即可。`;

    return context;
  }

  private getPhaseOutputFilename(phaseId: PhaseId, _sessionId: string, iteration: number): string {
    const phaseNum = String(PHASE_ORDER.indexOf(phaseId) + 1).padStart(2, '0');
    const version = iteration > 0 ? `v${iteration + 1}-` : 'v1-';

    switch (phaseId) {
      case 'design':
        return `${phaseNum}-comparison.md`;
      case 'implement':
        return `${phaseNum}-${version}SKILL.md`;
      case 'validate':
        return `${phaseNum}-${version}validation-report.md`;
      case 'iterate':
        return `${phaseNum}-iteration-record.md`;
      case 'release':
        return `${phaseNum}-release-summary.md`;
      default:
        return `${phaseNum}-output.md`;
    }
  }

  private findLatestValidationFile(sessionId: string): string {
    const files = this.store.listFiles(sessionId);
    const validationFiles = files.filter((f) => f.filename.startsWith('04-'));
    if (validationFiles.length === 0) return '04-v1-validation-report.md';
    return validationFiles[validationFiles.length - 1].filename;
  }

  private validationFailed(content: string): boolean {
    const lower = content.toLowerCase();
    return lower.includes('passed: false') || lower.includes('❌') || lower.includes('未通过');
  }

  private extractName(requirement: string): string {
    const firstLine = requirement.split('\n')[0].trim();
    if (firstLine.length <= 30) return firstLine;
    return firstLine.slice(0, 30) + '...';
  }
}
