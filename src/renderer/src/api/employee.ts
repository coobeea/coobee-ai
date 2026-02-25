import axios from 'axios';
import configManager from '@/config';

const client = axios.create({
  baseURL: configManager.getBaseUrl(),
  timeout: 10000
});

export interface EmployeeAvatar {
  model?: string;
  texture?: string;
  scale?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  animation?: string;
}

export interface EmployeeVoice {
  provider: 'local' | 'azure' | 'openai' | 'edge';
  voiceId?: string;
  speed?: number;
  pitch?: number;
  style?: string;
  samplePath?: string;
}

export interface DigitalEmployee {
  id: string;
  name: string;
  description?: string;
  role: string;
  avatar: EmployeeAvatar;
  voice: EmployeeVoice;
  persona: string;
  knowledgeBaseId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateEmployeeParams {
  name: string;
  description?: string;
  role: string;
  avatar?: EmployeeAvatar;
  voice?: EmployeeVoice;
  persona?: string;
}

export const employeeApi = {
  /** 获取员工列表 */
  async listEmployees(): Promise<DigitalEmployee[]> {
    const res = await client.get<{ success: boolean; data: DigitalEmployee[] }>('/gateway/employee/list');
    return res.data.data;
  },

  /** 获取员工详情 */
  async getEmployee(id: string): Promise<DigitalEmployee> {
    const res = await client.get<{ success: boolean; data: DigitalEmployee }>(`/gateway/employee/${id}`);
    return res.data.data;
  },

  /** 创建员工 */
  async createEmployee(params: CreateEmployeeParams): Promise<DigitalEmployee> {
    const res = await client.post<{ success: boolean; data: DigitalEmployee }>('/gateway/employee', params);
    return res.data.data;
  },

  /** 更新员工 */
  async updateEmployee(id: string, updates: Partial<CreateEmployeeParams>): Promise<DigitalEmployee> {
    const res = await client.patch<{ success: boolean; data: DigitalEmployee }>(`/gateway/employee/${id}`, updates);
    return res.data.data;
  },

  /** 删除员工 */
  async deleteEmployee(id: string): Promise<void> {
    await client.delete<{ success: boolean }>(`/gateway/employee/${id}`);
  }
};
