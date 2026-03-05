/**
 * Consultation API - 专家会诊前端 API
 */

import configManager from '@/config';
import type { ConsultationSession } from '@shared/types/consultation';

const BASE_URL = `${configManager.getBaseUrl()}/gateway/consultation`;

export interface CreateConsultationParams {
  question: string;
  experts: Array<{
    agentId: string;
    roleName: string;
    specialty: string;
  }>;
  aggregationStrategy?: 'weighted-voting' | 'confidence-based' | 'majority' | 'unanimous';
  timeout?: number;
}

export async function createConsultation(params: CreateConsultationParams): Promise<ConsultationSession> {
  const res = await fetch(`${BASE_URL}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }

  return (data as { session: ConsultationSession }).session;
}

export async function listConsultations(): Promise<ConsultationSession[]> {
  const res = await fetch(`${BASE_URL}/sessions`);
  const data = await res.json();

  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }

  return (data as { sessions: ConsultationSession[] }).sessions || [];
}

export async function getConsultation(id: string): Promise<ConsultationSession> {
  const res = await fetch(`${BASE_URL}/sessions/${id}`);
  const data = await res.json();

  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }

  return (data as { session: ConsultationSession }).session;
}
