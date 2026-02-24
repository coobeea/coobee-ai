import { Env } from '../common/env';
import { log } from '../common/logger';
import { LifecycleHook, LifecyclePhase, LifecycleContext } from '../common/types';
import { SQLiteService, DuckDBService } from '../common/database';

/**
 * 数据库初始化 Hook
 * 在应用初始化阶段创建 SQLite 和 DuckDB 服务的单例实例
 */
export const InitDatabaseHook: LifecycleHook = {
  name: 'init-database-services',
  phase: LifecyclePhase.INIT,
  priority: 100,
  critical: true,

  async execute(_context: LifecycleContext): Promise<void> {
    try {
      const dataPath = Env.paths.userData;

      // 初始化 SQLite 服务（OLTP）
      SQLiteService.initialize(dataPath);
      log.info('[InitDatabaseHook] SQLite 数据库服务初始化完成');

      // 初始化 DuckDB 服务（OLAP）- 可选，失败不影响应用启动
      try {
        DuckDBService.initialize(dataPath);
        log.info('[InitDatabaseHook] DuckDB 数据库服务初始化完成');
      } catch (duckdbError) {
        log.warn('[InitDatabaseHook] DuckDB 数据库服务初始化失败（非关键服务）:', duckdbError);
        log.warn('[InitDatabaseHook] 应用将继续运行，但 OLAP 分析功能将不可用');
      }

      log.info('[InitDatabaseHook] 数据库服务初始化完成');
    } catch (error) {
      log.error('[InitDatabaseHook] 数据库服务初始化失败:', error);
      throw error;
    }
  }
};
