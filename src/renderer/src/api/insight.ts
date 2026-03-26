/**
 * 实时洞察 API
 */

import axios from 'axios';
import type { AnalysisTemplate, InsightSession, AnalysisSnapshot, AnalysisResult } from '@shared/types/insight';

const BASE_URL = 'http://localhost:3000';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ==================== Templates ====================

export async function listTemplates(): Promise<AnalysisTemplate[]> {
  const res = await axios.get<ApiResponse<AnalysisTemplate[]>>(`${BASE_URL}/gateway/insight/templates`);
  return res.data.data ?? [];
}

export async function getTemplate(id: string): Promise<AnalysisTemplate | null> {
  const res = await axios.get<ApiResponse<AnalysisTemplate>>(`${BASE_URL}/gateway/insight/templates/${id}`);
  return res.data.data ?? null;
}

export async function createTemplate(
  input: Omit<AnalysisTemplate, 'id' | 'createdAt' | 'updatedAt' | 'builtIn'>
): Promise<AnalysisTemplate> {
  const res = await axios.post<ApiResponse<AnalysisTemplate>>(`${BASE_URL}/gateway/insight/templates`, input);
  return res.data.data!;
}

export async function deleteTemplate(id: string): Promise<boolean> {
  const res = await axios.delete<ApiResponse<void>>(`${BASE_URL}/gateway/insight/templates/${id}`);
  return res.data.success;
}

// ==================== Sessions ====================

export async function startSession(templateId: string): Promise<InsightSession> {
  const res = await axios.post<ApiResponse<InsightSession>>(`${BASE_URL}/gateway/insight/sessions`, {
    templateId
  });
  return res.data.data!;
}

export async function listSessions(): Promise<InsightSession[]> {
  const res = await axios.get<ApiResponse<InsightSession[]>>(`${BASE_URL}/gateway/insight/sessions`);
  return res.data.data ?? [];
}

export async function getActiveSession(): Promise<InsightSession | null> {
  const res = await axios.get<ApiResponse<InsightSession | null>>(`${BASE_URL}/gateway/insight/sessions/active`);
  return res.data.data ?? null;
}

export async function getSession(id: string): Promise<InsightSession | null> {
  const res = await axios.get<ApiResponse<InsightSession>>(`${BASE_URL}/gateway/insight/sessions/${id}`);
  return res.data.data ?? null;
}

export async function pauseSession(id: string): Promise<InsightSession | null> {
  const res = await axios.put<ApiResponse<InsightSession>>(`${BASE_URL}/gateway/insight/sessions/${id}/pause`);
  return res.data.data ?? null;
}

export async function resumeSession(id: string): Promise<InsightSession | null> {
  const res = await axios.put<ApiResponse<InsightSession>>(`${BASE_URL}/gateway/insight/sessions/${id}/resume`);
  return res.data.data ?? null;
}

export async function completeSession(id: string): Promise<InsightSession | null> {
  const res = await axios.put<ApiResponse<InsightSession>>(`${BASE_URL}/gateway/insight/sessions/${id}/complete`);
  return res.data.data ?? null;
}

export async function deleteSession(id: string): Promise<boolean> {
  const res = await axios.delete<ApiResponse<void>>(`${BASE_URL}/gateway/insight/sessions/${id}`);
  return res.data.success;
}

// ==================== Transcript & Analysis ====================

export async function appendTranscript(sessionId: string, text: string): Promise<void> {
  await axios.post(`${BASE_URL}/gateway/insight/sessions/${sessionId}/transcript`, { text });
}

export async function notifySilence(sessionId: string): Promise<void> {
  await axios.post(`${BASE_URL}/gateway/insight/sessions/${sessionId}/silence`);
}

export async function triggerAnalysis(sessionId: string): Promise<void> {
  await axios.post(`${BASE_URL}/gateway/insight/sessions/${sessionId}/analyze`);
}

export async function getLatestResult(sessionId: string): Promise<AnalysisResult | null> {
  const res = await axios.get<ApiResponse<AnalysisResult | null>>(
    `${BASE_URL}/gateway/insight/sessions/${sessionId}/result`
  );
  return res.data.data ?? null;
}

// ==================== Snapshots ====================

export async function getSnapshots(sessionId: string): Promise<AnalysisSnapshot[]> {
  const res = await axios.get<ApiResponse<AnalysisSnapshot[]>>(
    `${BASE_URL}/gateway/insight/sessions/${sessionId}/snapshots`
  );
  return res.data.data ?? [];
}

export async function getSnapshot(sessionId: string, snapshotId: string): Promise<AnalysisSnapshot | null> {
  const res = await axios.get<ApiResponse<AnalysisSnapshot>>(
    `${BASE_URL}/gateway/insight/sessions/${sessionId}/snapshots/${snapshotId}`
  );
  return res.data.data ?? null;
}
