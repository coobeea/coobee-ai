/**
 * InterventionManager - 人工介入管理器
 *
 * 管理自动化流程中的人工介入点
 */

import { createLogger } from '@main/common/logger';
import type { InterventionPoint } from './types';

const log = createLogger('intervention-manager');

export class InterventionManager {
  private interventionPoints = new Map<string, InterventionPoint>();

  /**
   * 注册介入点
   */
  registerPoint(point: InterventionPoint): void {
    this.interventionPoints.set(point.id, point);
    log.info(`[InterventionManager] Registered intervention point: ${point.name}`);
  }

  /**
   * 移除介入点
   */
  removePoint(pointId: string): void {
    this.interventionPoints.delete(pointId);
    log.info(`[InterventionManager] Removed intervention point: ${pointId}`);
  }

  /**
   * 检查是否需要人工介入
   */
  checkIntervention(context: unknown): InterventionPoint[] {
    const triggered: InterventionPoint[] = [];

    for (const point of this.interventionPoints.values()) {
      if (!point.enabled) continue;

      try {
        if (point.trigger(context)) {
          triggered.push(point);
          log.info(`[InterventionManager] Intervention triggered: ${point.name}`);
        }
      } catch (err) {
        log.error(`[InterventionManager] Failed to check intervention point "${point.name}":`, err);
      }
    }

    return triggered;
  }

  /**
   * 列出所有介入点
   */
  listPoints(): InterventionPoint[] {
    return Array.from(this.interventionPoints.values());
  }

  /**
   * 启用/禁用介入点
   */
  setEnabled(pointId: string, enabled: boolean): void {
    const point = this.interventionPoints.get(pointId);
    if (point) {
      point.enabled = enabled;
      log.info(`[InterventionManager] Intervention point "${pointId}" ${enabled ? 'enabled' : 'disabled'}`);
    }
  }
}
