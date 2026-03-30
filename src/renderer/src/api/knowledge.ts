import axios from 'axios';
import configManager from '@/config';
import type { KnowledgeBaseMeta, KnowledgeTreeNode, SourceMaterial } from '@shared/types/knowledge';

const BASE_URL = `${configManager.getBaseUrl()}`;

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export async function listKnowledgeBases(): Promise<KnowledgeBaseMeta[]> {
  const res = await axios.get<ApiResponse<KnowledgeBaseMeta[]>>(`${BASE_URL}/gateway/knowledge/list`);
  return res.data.data ?? [];
}

export async function getKnowledgeBase(id: string): Promise<KnowledgeBaseMeta | null> {
  const res = await axios.get<ApiResponse<KnowledgeBaseMeta>>(`${BASE_URL}/gateway/knowledge/${id}`);
  return res.data.data ?? null;
}

export async function getKnowledgeTree(id: string): Promise<KnowledgeTreeNode[]> {
  const res = await axios.get<ApiResponse<KnowledgeTreeNode[]>>(`${BASE_URL}/gateway/knowledge/${id}/tree`);
  return res.data.data ?? [];
}

export async function readKnowledgeFile(id: string, filePath: string): Promise<string> {
  const res = await axios.get<ApiResponse<{ path: string; content: string }>>(
    `${BASE_URL}/gateway/knowledge/${id}/read`,
    { params: { path: filePath } }
  );
  return res.data.data?.content ?? '';
}

export async function listSources(id: string): Promise<SourceMaterial[]> {
  const res = await axios.get<ApiResponse<SourceMaterial[]>>(`${BASE_URL}/gateway/knowledge/${id}/sources`);
  return res.data.data ?? [];
}

export async function createKnowledgeBase(name: string, description: string): Promise<KnowledgeBaseMeta> {
  const res = await axios.post<ApiResponse<KnowledgeBaseMeta>>(`${BASE_URL}/gateway/knowledge/create`, {
    name,
    description
  });
  return res.data.data!;
}

export async function uploadSource(id: string, fileName: string, fileBase64: string): Promise<SourceMaterial> {
  const res = await axios.post<ApiResponse<SourceMaterial>>(`${BASE_URL}/gateway/knowledge/${id}/upload`, {
    fileName,
    fileBase64
  });
  return res.data.data!;
}

export async function uploadZipSource(id: string, zipBase64: string): Promise<SourceMaterial> {
  const res = await axios.post<ApiResponse<SourceMaterial>>(`${BASE_URL}/gateway/knowledge/${id}/upload-zip`, {
    zipBase64
  });
  return res.data.data!;
}

export async function buildKnowledgeBase(id: string): Promise<void> {
  await axios.post(`${BASE_URL}/gateway/knowledge/${id}/build`);
}

export async function deleteKnowledgeBase(id: string): Promise<void> {
  await axios.delete(`${BASE_URL}/gateway/knowledge/${id}`);
}
