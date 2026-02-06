import { log } from '../common/logger'
import { LifecycleHook, LifecyclePhase, LifecycleContext } from '../common/types'
import { SQLiteService, DuckDBService } from '../common/database'

/**
 * 数据库清理 Hook
 * 在应用退出前清理 SQLite 和 DuckDB 服务的单例实例
 */
export const BeforeQuitDatabaseHook: LifecycleHook = {
  name: 'before-quit-database-services',
  phase: LifecyclePhase.BEFORE_QUIT,
  priority: 100,
  critical: false,

  async execute(_context: LifecycleContext): Promise<void> {
    try {
      // 清理 SQLite 服务
      SQLiteService.destroyInstance()
      log.info('[BeforeQuitDatabaseHook] SQLite 数据库服务已清理')

      // 清理 DuckDB 服务（如果已初始化）
      try {
        DuckDBService.destroyInstance()
        log.info('[BeforeQuitDatabaseHook] DuckDB 数据库服务已清理')
      } catch (duckdbError) {
        log.debug('[BeforeQuitDatabaseHook] DuckDB 服务未初始化或清理失败:', duckdbError)
      }

      log.info('[BeforeQuitDatabaseHook] 数据库服务清理完成')
    } catch (error) {
      log.error('[BeforeQuitDatabaseHook] 数据库服务清理失败:', error)
    }
  }
}
