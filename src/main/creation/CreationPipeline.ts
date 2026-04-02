import { ChannelRuntime } from '@main/channels/ChannelRuntime';
import { log } from '@main/common/logger';
import { eventBus } from '@main/common/eventbus';
import { generateSnowflakeId } from '@main/utils/SnowflakeIdGenerator';
import { CreationStore } from './CreationStore';
import { KnowledgeStore } from '@main/knowledge/KnowledgeStore';
import type { CreationSessionMeta, PhaseId, CreationTargetType } from '@shared/types/creation';
import { PHASE_ORDER, PHASE_AGENTS, KB_PHASE_AGENTS, PHASE_LABELS } from '@shared/types/creation';

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
   *
   * 会话连续性由 sessionMode('file') 保证：
   *   - 同一 sessionId 的所有交互共享同一个 .jsonl 文件
   *   - SDK 自动加载历史消息，Agent 天然能看到完整对话上下文
   *   - transcript 另存一份供前端恢复 UI 状态
   */
  async chat(sessionId: string, message: string): Promise<string> {
    const meta = this.store.loadMeta(sessionId);
    if (!meta) throw new Error(`Session ${sessionId} not found`);
    if (meta.status !== 'requirements') {
      throw new Error(`Session is not in requirements phase (current: ${meta.status})`);
    }

    const transcript = this.store.loadTranscript(sessionId);
    const isFirstMessage = transcript.length === 0;

    const agentMessage = isFirstMessage
      ? `## 创建目标\n\n- 类型：${meta.targetType}\n- 名称：${meta.name}\n- 原始需求：${meta.userRequirement}\n\n## 用户消息\n\n${message}`
      : message;

    const runtime = ChannelRuntime.getInstance();
    const agentId = this.resolveAgentId(meta.targetType, 'requirements');
    // 🔧 使用独立的 Snowflake ID，而不是拼接 sessionId
    const result = await runtime.executeAgent({
      agentId,
      sessionId: generateSnowflakeId(),
      message: agentMessage,
      context: { channel: 'creation', sessionId, phase: 'requirements' }
    });

    if (result.error) {
      log.error(`[CreationPipeline] Phase 1 chat error: ${result.error}`);
    }

    this.store.appendTranscript(sessionId, [
      { role: 'user', content: message },
      { role: 'assistant', content: result.output }
    ]);

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
        agentId: this.resolveAgentId(meta.targetType, phaseId),
        label: PHASE_LABELS[phaseId]
      });

      try {
        const agentId = this.resolveAgentId(meta.targetType, phaseId);

        const context = this.buildPhaseContext(sessionId, phaseId);
        // 🔧 使用独立的 Snowflake ID，而不是拼接 sessionId
        const result = await runtime.executeAgent({
          agentId,
          sessionId: generateSnowflakeId(),
          message: context,
          context: { channel: 'creation', sessionId, phase: phaseId }
        });

        if (result.error) {
          throw new Error(result.error);
        }

        const outputFilename = this.getPhaseOutputFilename(phaseId, sessionId, iterationCount, meta.targetType);
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
      if (meta.targetType === 'knowledge') {
        this.publishKnowledgeBase(sessionId, meta);
      }
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

  private resolveAgentId(targetType: CreationTargetType, phaseId: PhaseId): string {
    if (targetType === 'knowledge') {
      return KB_PHASE_AGENTS[phaseId];
    }
    if (phaseId === 'implement' && targetType === 'agent') {
      return 'agent-builder';
    }
    return PHASE_AGENTS[phaseId];
  }

  private getPhaseOutputFilename(
    phaseId: PhaseId,
    _sessionId: string,
    iteration: number,
    targetType?: CreationTargetType
  ): string {
    const phaseNum = String(PHASE_ORDER.indexOf(phaseId) + 1).padStart(2, '0');
    const version = iteration > 0 ? `v${iteration + 1}-` : 'v1-';

    if (targetType === 'knowledge') {
      switch (phaseId) {
        case 'design':
          return `${phaseNum}-toc.md`;
        case 'implement':
          return `${phaseNum}-${version}content.md`;
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

  /**
   * 将流水线构建产物整理为标准知识库目录
   */
  private publishKnowledgeBase(sessionId: string, meta: CreationSessionMeta): void {
    try {
      const kbStore = KnowledgeStore.getInstance();
      const kbId = sessionId.replace('creation-', 'kb-');

      const kbDir = kbStore.createFromPipeline(kbId, {
        name: meta.name,
        description: meta.userRequirement,
        sourceSessionId: sessionId
      });

      const contentFile = this.store.readFile(sessionId, this.findLatestContentFile(sessionId));
      if (contentFile) {
        this.parseAndWriteKbContent(kbStore, kbId, contentFile);
      }

      const tocFile = this.store.readFile(sessionId, '02-toc.md');
      if (tocFile) {
        kbStore.writeFile(kbId, 'index.md', tocFile);
      }

      kbStore.updateMeta(kbId, {
        chapterCount: kbStore.get(kbId)?.chapterCount ?? 0,
        totalFiles: kbStore.get(kbId)?.totalFiles ?? 0
      });

      log.info(`[CreationPipeline] Published knowledge base: ${kbId} at ${kbDir}`);
    } catch (err) {
      log.error(`[CreationPipeline] Failed to publish KB for ${sessionId}:`, err);
    }
  }

  private findLatestContentFile(sessionId: string): string {
    const files = this.store.listFiles(sessionId);
    const contentFiles = files.filter((f) => f.filename.startsWith('03-'));
    if (contentFiles.length === 0) return '03-v1-content.md';
    return contentFiles[contentFiles.length - 1].filename;
  }

  /**
   * 将 Agent 输出的 Markdown 内容按章节结构写入 KB 目录
   */
  private parseAndWriteKbContent(kbStore: KnowledgeStore, kbId: string, content: string): void {
    const lines = content.split('\n');
    let chapterIdx = 0;
    let sectionIdx = 0;
    let currentChapter = '';
    let currentBuffer: string[] = [];

    const flush = (): void => {
      if (currentChapter && currentBuffer.length > 0) {
        const filename = `${String(sectionIdx).padStart(2, '0')}-content.md`;
        kbStore.writeFile(kbId, `${currentChapter}/${filename}`, currentBuffer.join('\n'));
      }
      currentBuffer = [];
    };

    for (const line of lines) {
      const h1Match = line.match(/^#\s+(.+)/);
      const h2Match = line.match(/^##\s+(.+)/);

      if (h1Match) {
        flush();
        chapterIdx++;
        sectionIdx = 0;
        const chapterName = h1Match[1]
          .trim()
          .replace(/[^a-zA-Z0-9\u4e00-\u9fff-_\s]/g, '')
          .replace(/\s+/g, '-')
          .toLowerCase();
        currentChapter = `${String(chapterIdx).padStart(2, '0')}-${chapterName}`;
        kbStore.writeFile(kbId, `${currentChapter}/_overview.md`, `# ${h1Match[1].trim()}\n`);
        currentBuffer = [];
      } else if (h2Match && currentChapter) {
        flush();
        sectionIdx++;
        currentBuffer.push(line);
      } else {
        currentBuffer.push(line);
      }
    }
    flush();
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
