import * as fs from 'node:fs';
import * as path from 'node:path';
import { createLogger } from '@main/common/logger';
import { nanoid } from 'nanoid';

const log = createLogger('employee-store');

export interface EmployeeAvatar {
  model?: string; // 相对路径，如 "avatar.glb"
  texture?: string;
  scale?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  animation?: string; // 默认待机动画名称
}

export interface EmployeeVoice {
  provider: 'local' | 'azure' | 'openai' | 'edge';
  voiceId?: string; // 音色 ID
  speed?: number; // 语速 0.5-2.0
  pitch?: number; // 音调
  style?: string; // 情感风格 (Azure/Qwen)
  samplePath?: string; // 声音样本文件路径 (用于克隆)
}

export interface DigitalEmployee {
  id: string;
  name: string;
  description?: string;
  role: string; // 角色设定 (职位)
  avatar: EmployeeAvatar;
  voice: EmployeeVoice;
  persona: string; // System Prompt
  knowledgeBaseId?: string; // 关联的知识库 ID

  createdAt: number;
  updatedAt: number;
}

export class EmployeeStore {
  private static instance: EmployeeStore | null = null;
  private employeeDir!: string;

  static async getInstance(): Promise<EmployeeStore> {
    if (!EmployeeStore.instance) {
      const { Env } = await import('@main/common/env');
      const store = new EmployeeStore();
      store.employeeDir = path.join(Env.paths.userHome, 'employees');
      await store.ensureDir(store.employeeDir);
      EmployeeStore.instance = store;
    }
    return EmployeeStore.instance;
  }

  private async ensureDir(dirPath: string): Promise<void> {
    await fs.promises.mkdir(dirPath, { recursive: true });
  }

  private getEmployeeDir(id: string): string {
    return path.join(this.employeeDir, id);
  }

  /**
   * 列出所有数字员工
   */
  async listEmployees(): Promise<DigitalEmployee[]> {
    try {
      const entries = await fs.promises.readdir(this.employeeDir, { withFileTypes: true });
      const employees: DigitalEmployee[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const metaPath = path.join(this.employeeDir, entry.name, 'meta.json');
          try {
            const content = await fs.promises.readFile(metaPath, 'utf-8');
            employees.push(JSON.parse(content));
          } catch (e) {
            log.warn(`Failed to read employee meta for ${entry.name}: ${e}`);
          }
        }
      }

      // 按更新时间倒序排列
      return employees.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      log.error(`Failed to list employees: ${e}`);
      return [];
    }
  }

  /**
   * 获取单个员工详情
   */
  async getEmployee(id: string): Promise<DigitalEmployee | null> {
    const metaPath = path.join(this.getEmployeeDir(id), 'meta.json');
    try {
      const content = await fs.promises.readFile(metaPath, 'utf-8');
      return JSON.parse(content);
    } catch (_) {
      return null;
    }
  }

  /**
   * 创建新员工
   */
  async createEmployee(data: Omit<DigitalEmployee, 'id' | 'createdAt' | 'updatedAt'>): Promise<DigitalEmployee> {
    const id = nanoid();
    const now = Date.now();

    const defaultVoice: EmployeeVoice = { provider: 'local', speed: 1.0, pitch: 1.0 };
    const voice = { ...defaultVoice, ...data.voice };

    const employee: DigitalEmployee = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now,
      // 默认值填充
      avatar: { scale: 1, position: [0, -1, 0], ...data.avatar },
      voice
    };

    const dir = this.getEmployeeDir(id);
    await this.ensureDir(dir);

    const metaPath = path.join(dir, 'meta.json');
    await fs.promises.writeFile(metaPath, JSON.stringify(employee, null, 2), 'utf-8');

    log.info(`Created employee: ${id} (${employee.name})`);
    return employee;
  }

  /**
   * 更新员工信息
   */
  async updateEmployee(
    id: string,
    updates: Partial<Omit<DigitalEmployee, 'id' | 'createdAt'>>
  ): Promise<DigitalEmployee> {
    const current = await this.getEmployee(id);
    if (!current) {
      throw new Error(`Employee not found: ${id}`);
    }

    const updated: DigitalEmployee = {
      ...current,
      ...updates,
      // 深度合并 avatar 和 voice 配置
      avatar: { ...current.avatar, ...(updates.avatar || {}) },
      voice: { ...current.voice, ...(updates.voice || {}) },
      updatedAt: Date.now()
    };

    const metaPath = path.join(this.getEmployeeDir(id), 'meta.json');
    await fs.promises.writeFile(metaPath, JSON.stringify(updated, null, 2), 'utf-8');

    log.info(`Updated employee: ${id}`);
    return updated;
  }

  /**
   * 删除员工
   */
  async deleteEmployee(id: string): Promise<void> {
    const dir = this.getEmployeeDir(id);
    await fs.promises.rm(dir, { recursive: true, force: true });
    log.info(`Deleted employee: ${id}`);
  }

  /**
   * 保存资源文件 (头像模型/声音样本)
   */
  async saveAsset(id: string, fileName: string, buffer: Buffer): Promise<string> {
    const dir = this.getEmployeeDir(id);
    await this.ensureDir(dir);

    const filePath = path.join(dir, fileName);
    await fs.promises.writeFile(filePath, buffer);

    return filePath; // 返回绝对路径
  }
}
