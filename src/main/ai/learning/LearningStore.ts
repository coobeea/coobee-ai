/**
 * LearningStore - 学习记录持久化
 */

import fs from 'fs';
import path from 'path';
import { createLogger } from '@main/common/logger';
import type { LearningRecord, LearningPattern } from './types';

const log = createLogger('learning-store');

export class LearningStore {
  private storageDir: string;
  private recordsFile: string;
  private patternsFile: string;

  constructor(storageDir: string) {
    this.storageDir = storageDir;
    this.recordsFile = path.join(storageDir, 'records.jsonl');
    this.patternsFile = path.join(storageDir, 'patterns.json');

    this.initialize();
  }

  /**
   * 初始化存储
   */
  private initialize(): void {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    if (!fs.existsSync(this.recordsFile)) {
      fs.writeFileSync(this.recordsFile, '', 'utf-8');
    }

    if (!fs.existsSync(this.patternsFile)) {
      fs.writeFileSync(this.patternsFile, JSON.stringify([]), 'utf-8');
    }

    log.info(`[LearningStore] Initialized at ${this.storageDir}`);
  }

  /**
   * 添加学习记录
   */
  addRecord(record: LearningRecord): void {
    const line = JSON.stringify(record) + '\n';
    fs.appendFileSync(this.recordsFile, line, 'utf-8');

    log.debug(`[LearningStore] Record added: ${record.id}`);
  }

  /**
   * 读取所有记录
   */
  readRecords(limit?: number): LearningRecord[] {
    if (!fs.existsSync(this.recordsFile)) return [];

    const content = fs.readFileSync(this.recordsFile, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    const records = lines.map((line) => JSON.parse(line) as LearningRecord).reverse();

    return limit ? records.slice(0, limit) : records;
  }

  /**
   * 查询记录
   */
  queryRecords(filters: { taskType?: string; agentId?: string; outcome?: string }): LearningRecord[] {
    const allRecords = this.readRecords();

    return allRecords.filter((r) => {
      if (filters.taskType && r.taskType !== filters.taskType) return false;
      if (filters.agentId && r.agentId !== filters.agentId) return false;
      if (filters.outcome && r.outcome !== filters.outcome) return false;
      return true;
    });
  }

  /**
   * 保存模式
   */
  savePatterns(patterns: LearningPattern[]): void {
    fs.writeFileSync(this.patternsFile, JSON.stringify(patterns, null, 2), 'utf-8');
    log.info(`[LearningStore] Saved ${patterns.length} patterns`);
  }

  /**
   * 读取模式
   */
  readPatterns(): LearningPattern[] {
    if (!fs.existsSync(this.patternsFile)) return [];

    const content = fs.readFileSync(this.patternsFile, 'utf-8');
    return JSON.parse(content) as LearningPattern[];
  }

  /**
   * 获取统计信息
   */
  getStatistics(): {
    totalRecords: number;
    successRate: number;
    avgQualityScore: number;
    totalPatterns: number;
  } {
    const records = this.readRecords();
    const patterns = this.readPatterns();

    const successCount = records.filter((r) => r.outcome === 'success').length;
    const totalQuality = records.reduce((sum, r) => sum + r.qualityScore, 0);

    return {
      totalRecords: records.length,
      successRate: records.length > 0 ? successCount / records.length : 0,
      avgQualityScore: records.length > 0 ? totalQuality / records.length : 0,
      totalPatterns: patterns.length
    };
  }
}
