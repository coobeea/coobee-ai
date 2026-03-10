/**
 * Mentorship Types
 *
 * 导师-学徒类型定义
 */

/**
 * 学徒
 */
export interface Apprentice {
  /** Agent ID */
  agentId: string;

  /** 当前技能水平 */
  skillLevel: number;

  /** 学习进度 */
  progress: {
    lessonsCompleted: number;
    totalLessons: number;
    successRate: number;
  };

  /** 弱点领域 */
  weaknesses: string[];

  /** 导师 ID */
  mentorId?: string;

  /** 开始时间 */
  startedAt: number;
}

/**
 * 导师
 */
export interface Mentor {
  /** Agent ID */
  agentId: string;

  /** 专长领域 */
  expertise: string[];

  /** 教学风格 */
  teachingStyle: 'hands-on' | 'theoretical' | 'mixed';

  /** 学徒列表 */
  apprentices: string[];

  /** 成功率 */
  successRate: number;
}

/**
 * 教学课程
 */
export interface Lesson {
  /** 课程 ID */
  id: string;

  /** 课程名称 */
  name: string;

  /** 描述 */
  description: string;

  /** 技能领域 */
  skillArea: string;

  /** 难度（1-10） */
  difficulty: number;

  /** 前置课程 */
  prerequisites?: string[];

  /** 课程内容 */
  content: string;

  /** 练习任务 */
  exercises?: Array<{
    id: string;
    description: string;
    expectedOutput: string;
  }>;
}

/**
 * 学习会话
 */
export interface MentorshipSession {
  /** 会话 ID */
  id: string;

  /** 导师 ID */
  mentorId: string;

  /** 学徒 ID */
  apprenticeId: string;

  /** 当前课程 */
  currentLesson?: Lesson;

  /** 反馈历史 */
  feedbackHistory: Array<{
    lessonId: string;
    feedback: string;
    score: number;
    timestamp: number;
  }>;

  /** 状态 */
  status: 'active' | 'paused' | 'completed';

  /** 创建时间 */
  createdAt: number;
}

/**
 * 导师制配置
 */
export interface MentorshipConfig {
  /** 最大学徒数 */
  maxApprenticesPerMentor: number;

  /** 自动匹配 */
  autoMatch: boolean;

  /** 评估间隔（完成多少课程后评估） */
  evaluationInterval: number;
}
