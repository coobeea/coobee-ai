/**
 * MentorshipProgram - 导师制项目
 *
 * 管理导师-学徒关系和教学流程
 */

import { createLogger } from '@main/common/logger';
import type { Mentor, Apprentice, Lesson, MentorshipSession, MentorshipConfig } from './types';

const log = createLogger('mentorship-program');

export class MentorshipProgram {
  private mentors = new Map<string, Mentor>();
  private apprentices = new Map<string, Apprentice>();
  private sessions = new Map<string, MentorshipSession>();
  private lessons = new Map<string, Lesson>();
  private config: MentorshipConfig;

  constructor(config: MentorshipConfig) {
    this.config = config;
    this.initializeLessons();
  }

  /**
   * 注册导师
   */
  registerMentor(agentId: string, expertise: string[], teachingStyle: Mentor['teachingStyle'] = 'mixed'): Mentor {
    const mentor: Mentor = {
      agentId,
      expertise,
      teachingStyle,
      apprentices: [],
      successRate: 0
    };

    this.mentors.set(agentId, mentor);

    log.info(`[MentorshipProgram] Mentor registered: ${agentId} (${expertise.join(', ')})`);

    return mentor;
  }

  /**
   * 注册学徒
   */
  registerApprentice(agentId: string, weaknesses: string[] = []): Apprentice {
    const apprentice: Apprentice = {
      agentId,
      skillLevel: 0,
      progress: {
        lessonsCompleted: 0,
        totalLessons: this.lessons.size,
        successRate: 0
      },
      weaknesses,
      startedAt: Date.now()
    };

    this.apprentices.set(agentId, apprentice);

    log.info(`[MentorshipProgram] Apprentice registered: ${agentId}`);

    return apprentice;
  }

  /**
   * 匹配导师和学徒
   */
  matchMentorApprentice(mentorId: string, apprenticeId: string): MentorshipSession {
    const mentor = this.mentors.get(mentorId);
    const apprentice = this.apprentices.get(apprenticeId);

    if (!mentor || !apprentice) {
      throw new Error('Mentor or apprentice not found');
    }

    if (mentor.apprentices.length >= this.config.maxApprenticesPerMentor) {
      throw new Error('Mentor has reached maximum apprentices');
    }

    const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const session: MentorshipSession = {
      id: sessionId,
      mentorId,
      apprenticeId,
      feedbackHistory: [],
      status: 'active',
      createdAt: Date.now()
    };

    mentor.apprentices.push(apprenticeId);
    apprentice.mentorId = mentorId;

    this.sessions.set(sessionId, session);

    log.info(`[MentorshipProgram] Matched ${mentorId} with ${apprenticeId}`);

    return session;
  }

  /**
   * 开始课程
   */
  startLesson(sessionId: string, lessonId: string): void {
    const session = this.sessions.get(sessionId);
    const lesson = this.lessons.get(lessonId);

    if (!session || !lesson) {
      throw new Error('Session or lesson not found');
    }

    session.currentLesson = lesson;

    log.info(`[MentorshipProgram] Starting lesson "${lesson.name}" for session ${sessionId}`);
  }

  /**
   * 提交反馈
   */
  submitFeedback(sessionId: string, lessonId: string, feedback: string, score: number): void {
    const session = this.sessions.get(sessionId);

    if (!session) return;

    session.feedbackHistory.push({
      lessonId,
      feedback,
      score: Math.max(0, Math.min(1, score)),
      timestamp: Date.now()
    });

    const apprentice = this.apprentices.get(session.apprenticeId);
    if (apprentice) {
      apprentice.progress.lessonsCompleted++;
      apprentice.skillLevel = this.calculateSkillLevel(session.feedbackHistory);

      const totalScore = session.feedbackHistory.reduce((sum, f) => sum + f.score, 0);
      apprentice.progress.successRate = totalScore / session.feedbackHistory.length;
    }

    log.info(`[MentorshipProgram] Feedback submitted for session ${sessionId}: score ${score}`);
  }

  /**
   * 计算技能水平
   */
  private calculateSkillLevel(feedbackHistory: MentorshipSession['feedbackHistory']): number {
    if (feedbackHistory.length === 0) return 0;

    const recentFeedback = feedbackHistory.slice(-5);
    const avgScore = recentFeedback.reduce((sum, f) => sum + f.score, 0) / recentFeedback.length;

    const progressFactor = Math.min(1, feedbackHistory.length / 20);

    return avgScore * progressFactor;
  }

  /**
   * 初始化课程库
   */
  private initializeLessons(): void {
    const lessons: Lesson[] = [
      {
        id: 'lesson-1',
        name: '基础任务理解',
        description: '学习如何正确理解用户意图',
        skillArea: 'intent-recognition',
        difficulty: 1,
        content: '用户意图识别是 Agent 的核心能力...',
        exercises: [
          {
            id: 'ex-1',
            description: '识别用户请求中的核心动作',
            expectedOutput: '能够识别创建、查询、修改等动作'
          }
        ]
      },
      {
        id: 'lesson-2',
        name: '工具选择与使用',
        description: '学习何时使用哪些工具',
        skillArea: 'tool-usage',
        difficulty: 3,
        prerequisites: ['lesson-1'],
        content: '正确的工具选择能极大提升效率...'
      }
    ];

    for (const lesson of lessons) {
      this.lessons.set(lesson.id, lesson);
    }

    log.info(`[MentorshipProgram] Initialized ${lessons.length} lessons`);
  }

  /**
   * 获取会话
   */
  getSession(sessionId: string): MentorshipSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 获取学徒
   */
  getApprentice(agentId: string): Apprentice | undefined {
    return this.apprentices.get(agentId);
  }

  /**
   * 获取导师
   */
  getMentor(agentId: string): Mentor | undefined {
    return this.mentors.get(agentId);
  }

  /**
   * 列出所有课程
   */
  listLessons(): Lesson[] {
    return Array.from(this.lessons.values()).sort((a, b) => a.difficulty - b.difficulty);
  }
}
