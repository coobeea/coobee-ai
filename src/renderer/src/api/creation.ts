import axios from 'axios';
import configManager from '@/config';
import type { CreationSessionMeta, CreationTargetType, FileInfo, KnowledgeItem } from '@shared/types/creation';

const BASE_URL = `${configManager.getBaseUrl()}`;

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export async function startCreation(
  requirement: string,
  targetType: CreationTargetType
): Promise<CreationSessionMeta | null> {
  const res = await axios.post<ApiResponse<CreationSessionMeta>>(`${BASE_URL}/gateway/creation/start`, {
    requirement,
    targetType
  });
  return res.data.data ?? null;
}

export async function chatWithAnalyst(sessionId: string, message: string): Promise<string> {
  const res = await axios.post<ApiResponse<{ reply: string }>>(
    `${BASE_URL}/gateway/creation/sessions/${sessionId}/chat`,
    { message }
  );
  return res.data.data?.reply ?? '';
}

export async function finishRequirements(
  sessionId: string,
  files: { filename: string; content: string }[]
): Promise<void> {
  await axios.post(`${BASE_URL}/gateway/creation/sessions/${sessionId}/finish-requirements`, { files });
}

export async function listSessions(): Promise<CreationSessionMeta[]> {
  const res = await axios.get<ApiResponse<CreationSessionMeta[]>>(`${BASE_URL}/gateway/creation/sessions`);
  return res.data.data ?? [];
}

export async function getSession(sessionId: string): Promise<CreationSessionMeta | null> {
  const res = await axios.get<ApiResponse<CreationSessionMeta>>(`${BASE_URL}/gateway/creation/sessions/${sessionId}`);
  return res.data.data ?? null;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await axios.delete(`${BASE_URL}/gateway/creation/sessions/${sessionId}`);
}

export async function listSessionFiles(sessionId: string): Promise<FileInfo[]> {
  const res = await axios.get<ApiResponse<FileInfo[]>>(`${BASE_URL}/gateway/creation/sessions/${sessionId}/files`);
  return res.data.data ?? [];
}

export async function readSessionFile(sessionId: string, filename: string): Promise<string> {
  const res = await axios.get<ApiResponse<{ filename: string; content: string }>>(
    `${BASE_URL}/gateway/creation/sessions/${sessionId}/files/${filename}`
  );
  return res.data.data?.content ?? '';
}

export async function addKnowledge(sessionId: string, item: KnowledgeItem): Promise<void> {
  await axios.post(`${BASE_URL}/gateway/creation/sessions/${sessionId}/knowledge`, item);
}

export async function removeKnowledge(sessionId: string, name: string): Promise<void> {
  await axios.delete(`${BASE_URL}/gateway/creation/sessions/${sessionId}/knowledge/${name}`);
}

export async function launchAutopilot(sessionId: string): Promise<void> {
  await axios.post(`${BASE_URL}/gateway/creation/sessions/${sessionId}/launch`);
}

export async function pauseAutopilot(sessionId: string): Promise<void> {
  await axios.post(`${BASE_URL}/gateway/creation/sessions/${sessionId}/pause`);
}

export async function resumeAutopilot(sessionId: string): Promise<void> {
  await axios.post(`${BASE_URL}/gateway/creation/sessions/${sessionId}/resume`);
}
