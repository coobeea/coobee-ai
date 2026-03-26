/**
 * 训练相关 API
 */

import axios from 'axios';
import configManager from '@/config';
import type { TrainingSession, TrainingStatus } from '@shared/types/training';

const BASE_URL = `${configManager.getBaseUrl()}`;

/**
 * 弱点分析结果
 */
export interface WeaknessAnalysis {
  dimensionStats: Array<{
    dimension: string;
    avgScore: number;
    failureCount: number;
    totalCount: number;
    failureRate: number;
    isWeak: boolean;
  }>;
  weakDimensions: Array<{
    dimension: string;
    avgScore: number;
    failureCount: number;
    totalCount: number;
    failureRate: number;
    isWeak: boolean;
  }>;
  weakestDimension?: {
    dimension: string;
    avgScore: number;
    failureCount: number;
    totalCount: number;
    failureRate: number;
    isWeak: boolean;
  };
  overallPassRate: number;
  analyzedRounds: number;
}

/**
 * 创建训练会话
 */
export async function createTraining(params: {
  agentId: string;
  skillName: string;
  goalDescription: string;
  dataSource: {
    type: 'knowledge-base' | 'history' | 'auto';
    path?: string;
  };
  maxRounds: number;
  strategy?: string;
  parallelCount?: number;
}): Promise<TrainingSession> {
  const res = await axios.post(`${BASE_URL}/training/sessions`, params);
  return res.data.session;
}

/**
 * 获取训练列表
 */
export async function getTrainingSessions(filter?: {
  agentId?: string;
  status?: TrainingStatus;
  goalName?: string;
}): Promise<TrainingSession[]> {
  const res = await axios.get(`${BASE_URL}/training/sessions`, { params: filter });
  return res.data.sessions;
}

/**
 * 获取训练详情
 */
export async function getTrainingSession(sessionId: string): Promise<TrainingSession> {
  const res = await axios.get(`${BASE_URL}/training/sessions/${sessionId}`);
  return res.data.session;
}

/**
 * 暂停训练
 */
export async function pauseTraining(sessionId: string): Promise<void> {
  await axios.post(`${BASE_URL}/training/sessions/${sessionId}/pause`);
}

/**
 * 恢复训练
 */
export async function resumeTraining(sessionId: string): Promise<void> {
  await axios.post(`${BASE_URL}/training/sessions/${sessionId}/resume`);
}

/**
 * 停止训练
 */
export async function stopTraining(sessionId: string): Promise<void> {
  await axios.post(`${BASE_URL}/training/sessions/${sessionId}/stop`);
}

/**
 * 删除训练
 */
export async function deleteTraining(sessionId: string): Promise<void> {
  await axios.delete(`${BASE_URL}/training/sessions/${sessionId}`);
}

/**
 * 获取弱点分析
 */
export async function getWeaknessAnalysis(sessionId: string): Promise<WeaknessAnalysis> {
  const response = await axios.get<{ success: boolean; data: WeaknessAnalysis }>(
    `${BASE_URL}/training/sessions/${sessionId}/weakness`
  );
  return response.data.data;
}
