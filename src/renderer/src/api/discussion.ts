/**
 * Discussion API - 讨论室前端 API
 */

import configManager from '@/config';
import type { DiscussionSession, DiscussionParticipant, TurnStrategy } from '@shared/types/discussion';

const BASE_URL = `${configManager.getBaseUrl()}/gateway/discussion`;

export interface CreateDiscussionParams {
  topic: string;
  participants: DiscussionParticipant[];
  turnStrategy?: TurnStrategy;
  consensusThreshold?: number;
  maxRounds?: number;
}

export async function createDiscussion(params: CreateDiscussionParams): Promise<DiscussionSession> {
  const res = await fetch(`${BASE_URL}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }

  return (data as { session: DiscussionSession }).session;
}

export async function listDiscussions(): Promise<DiscussionSession[]> {
  const res = await fetch(`${BASE_URL}/sessions`);
  const data = await res.json();

  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }

  return (data as { sessions: DiscussionSession[] }).sessions || [];
}

export async function getDiscussion(id: string): Promise<DiscussionSession> {
  const res = await fetch(`${BASE_URL}/sessions/${id}`);
  const data = await res.json();

  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }

  return (data as { session: DiscussionSession }).session;
}

export async function startDiscussion(id: string): Promise<DiscussionSession> {
  const res = await fetch(`${BASE_URL}/sessions/${id}/start`, { method: 'POST' });
  const data = await res.json();

  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }

  return (data as { session: DiscussionSession }).session;
}

export async function pauseDiscussion(id: string): Promise<DiscussionSession> {
  const res = await fetch(`${BASE_URL}/sessions/${id}/pause`, { method: 'POST' });
  const data = await res.json();

  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }

  return (data as { session: DiscussionSession }).session;
}

export async function resumeDiscussion(id: string): Promise<DiscussionSession> {
  const res = await fetch(`${BASE_URL}/sessions/${id}/resume`, { method: 'POST' });
  const data = await res.json();

  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }

  return (data as { session: DiscussionSession }).session;
}

export async function endDiscussion(id: string): Promise<DiscussionSession> {
  const res = await fetch(`${BASE_URL}/sessions/${id}/end`, { method: 'POST' });
  const data = await res.json();

  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }

  return (data as { session: DiscussionSession }).session;
}

/**
 * 继续讨论（追加新问题）
 */
export async function continueDiscussion(id: string, newTopic: string): Promise<DiscussionSession> {
  const res = await fetch(`${BASE_URL}/sessions/${id}/continue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newTopic })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }

  return (data as { session: DiscussionSession }).session;
}

export async function sendMessage(
  id: string,
  agentId: string,
  content: string,
  type?: 'statement' | 'question' | 'answer' | 'objection' | 'agreement' | 'summary'
): Promise<DiscussionSession> {
  const res = await fetch(`${BASE_URL}/sessions/${id}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, content, type })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }

  return (data as { session: DiscussionSession }).session;
}
