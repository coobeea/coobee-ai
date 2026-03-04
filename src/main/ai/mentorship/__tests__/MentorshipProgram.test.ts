/**
 * MentorshipProgram 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MentorshipProgram } from '../MentorshipProgram';
import type { MentorshipConfig } from '../types';

describe('MentorshipProgram', () => {
  let program: MentorshipProgram;

  const config: MentorshipConfig = {
    maxApprenticesPerMentor: 5,
    autoMatch: true,
    evaluationInterval: 5
  };

  beforeEach(() => {
    program = new MentorshipProgram(config);
  });

  describe('Registration', () => {
    it('should register mentor', () => {
      const mentor = program.registerMentor('expert-agent', ['TypeScript', 'Testing'], 'hands-on');

      expect(mentor.agentId).toBe('expert-agent');
      expect(mentor.expertise).toContain('TypeScript');
      expect(mentor.teachingStyle).toBe('hands-on');
    });

    it('should register apprentice', () => {
      const apprentice = program.registerApprentice('junior-agent', ['debugging', 'architecture']);

      expect(apprentice.agentId).toBe('junior-agent');
      expect(apprentice.weaknesses).toContain('debugging');
      expect(apprentice.skillLevel).toBe(0);
    });
  });

  describe('Mentorship matching', () => {
    it('should match mentor with apprentice', () => {
      program.registerMentor('mentor-1', ['frontend'], 'mixed');
      program.registerApprentice('apprentice-1');

      const session = program.matchMentorApprentice('mentor-1', 'apprentice-1');

      expect(session.mentorId).toBe('mentor-1');
      expect(session.apprenticeId).toBe('apprentice-1');
      expect(session.status).toBe('active');
    });

    it('should enforce max apprentices limit', () => {
      const mentor = program.registerMentor('mentor-1', ['testing']);

      for (let i = 0; i < config.maxApprenticesPerMentor; i++) {
        const apprentice = program.registerApprentice(`apprentice-${i}`);
        program.matchMentorApprentice(mentor.agentId, apprentice.agentId);
      }

      const extraApprentice = program.registerApprentice('extra');

      expect(() => {
        program.matchMentorApprentice(mentor.agentId, extraApprentice.agentId);
      }).toThrow('maximum apprentices');
    });
  });

  describe('Learning process', () => {
    it('should start lesson', () => {
      program.registerMentor('mentor-1', ['testing']);
      program.registerApprentice('apprentice-1');

      const session = program.matchMentorApprentice('mentor-1', 'apprentice-1');
      const lessons = program.listLessons();

      expect(() => {
        program.startLesson(session.id, lessons[0].id);
      }).not.toThrow();

      const updated = program.getSession(session.id);
      expect(updated?.currentLesson).toBeDefined();
    });

    it('should submit feedback and update progress', () => {
      program.registerMentor('mentor-1', ['testing']);
      const apprentice = program.registerApprentice('apprentice-1');

      const session = program.matchMentorApprentice('mentor-1', apprentice.agentId);
      const lessons = program.listLessons();

      program.startLesson(session.id, lessons[0].id);
      program.submitFeedback(session.id, lessons[0].id, '表现出色，理解正确', 0.9);

      const updated = program.getApprentice(apprentice.agentId);
      expect(updated?.progress.lessonsCompleted).toBe(1);
      expect(updated?.skillLevel).toBeGreaterThan(0);
    });

    it('should track success rate', () => {
      program.registerMentor('mentor-1', ['testing']);
      const apprentice = program.registerApprentice('apprentice-1');

      const session = program.matchMentorApprentice('mentor-1', apprentice.agentId);
      const lessons = program.listLessons();

      program.submitFeedback(session.id, lessons[0].id, 'Good', 0.8);
      program.submitFeedback(session.id, lessons[1].id, 'Excellent', 0.9);

      const updated = program.getApprentice(apprentice.agentId);
      expect(updated?.progress.successRate).toBeCloseTo(0.85);
    });
  });

  describe('Lesson management', () => {
    it('should list lessons', () => {
      const lessons = program.listLessons();

      expect(lessons.length).toBeGreaterThan(0);
      expect(lessons[0].difficulty).toBeLessThanOrEqual(lessons[lessons.length - 1].difficulty);
    });
  });
});
