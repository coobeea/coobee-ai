/**
 * 普通群聊 API
 */

import configManager from '@/config';
import type { DiscussionSession, DiscussionParticipant } from '@shared/types/discussion';

const BASE_URL = `${configManager.getBaseUrl()}/gateway/groupchat`;

export interface CreateGroupChatParams {
  topic: string;
  participants: DiscussionParticipant[];
}

export async function createGroupChat(params: CreateGroupChatParams): Promise<DiscussionSession> {
  const res = await fetch(`${BASE_URL}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return (data as { session: DiscussionSession }).session;
}

export async function listGroupChats(): Promise<DiscussionSession[]> {
  const res = await fetch(`${BASE_URL}/sessions`);
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return (data as { sessions: DiscussionSession[] }).sessions || [];
}

export async function getGroupChat(id: string): Promise<DiscussionSession> {
  const res = await fetch(`${BASE_URL}/sessions/${id}`);
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return (data as { session: DiscussionSession }).session;
}

export async function sendMessage(id: string, content: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/sessions/${id}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }
}

export async function endGroupChat(id: string): Promise<DiscussionSession> {
  const res = await fetch(`${BASE_URL}/sessions/${id}/end`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return (data as { session: DiscussionSession }).session;
}

export async function deleteGroupChat(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/sessions/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json();
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }
}
