import { DatabaseService } from '../database/DatabaseService'
import { log } from '../logger'
import { DatabaseStatus, Migration, MigrationHistory, MigrationResult } from './types'

export class MigrationManager {
  private migrations: Migration[] = []
  private dbService: DatabaseService

  constructor(dbService: DatabaseService) {
    this.dbService = dbService
  }

  async initialize(): Promise<void> {
    await this.ensureMigrationTable()
    log.info('[Migration] Initialized')
  }

  private async ensureMigrationTable(): Promise<void> {
    const sql = `
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `
    await this.dbService.execute(sql)
  }

  register(migration: Migration): void {
    this.migrations.push(migration)
    this.migrations.sort((a, b) => a.version - b.version)
    log.info(`[Migration] Registered v${migration.version}: ${migration.description}`)
  }

  async migrate(): Promise<MigrationResult[]> {
    const currentVersion = await this.getCurrentVersion()
    const pendingMigrations = this.migrations.filter((m) => m.version > currentVersion)

    log.info(`[Migration] Current version: ${currentVersion}`)
    log.info(`[Migration] Pending migrations: ${pendingMigrations.length}`)

    const results: MigrationResult[] = []

    for (const migration of pendingMigrations) {
      const result = await this.executeMigration(migration)
      results.push(result)

      if (!result.success) {
        log.error(`[Migration] Failed at v${migration.version}, stopping`)
        break
      }
    }

    return results
  }

  private async executeMigration(migration: Migration): Promise<MigrationResult> {
    const startTime = Date.now()

    try {
      log.info(`[Migration] Applying v${migration.version}: ${migration.description}`)

      await this.dbService.transaction(async (tx) => {
        await migration.up(this.dbService)

        const sql = `INSERT INTO migrations (version, description, applied_at) VALUES (?, ?, ?)`
        await tx.insert(sql, [migration.version, migration.description, new Date().toISOString()])
      })

      const executionTime = Date.now() - startTime
      log.info(`[Migration] Applied v${migration.version} in ${executionTime}ms`)

      return {
        success: true,
        version: migration.version,
        description: migration.description,
        executionTime
      }
    } catch (error) {
      const executionTime = Date.now() - startTime
      log.error(`[Migration] Failed v${migration.version}:`, error)

      return {
        success: false,
        version: migration.version,
        description: migration.description,
        error: error instanceof Error ? error : new Error(String(error)),
        executionTime
      }
    }
  }

  async rollback(targetVersion?: number): Promise<MigrationResult[]> {
    const currentVersion = await this.getCurrentVersion()
    const target = targetVersion ?? currentVersion - 1

    const migrationsToRollback = this.migrations
      .filter((m) => m.version <= currentVersion && m.version > target)
      .reverse()

    log.info(`[Migration] Rolling back from v${currentVersion} to v${target}`)

    const results: MigrationResult[] = []

    for (const migration of migrationsToRollback) {
      const result = await this.executeRollback(migration)
      results.push(result)

      if (!result.success) {
        log.error(`[Migration] Rollback failed at v${migration.version}`)
        break
      }
    }

    return results
  }

  private async executeRollback(migration: Migration): Promise<MigrationResult> {
    const startTime = Date.now()

    try {
      log.info(`[Migration] Rolling back v${migration.version}: ${migration.description}`)

      await this.dbService.transaction(async (tx) => {
        await migration.down(this.dbService)

        const sql = `DELETE FROM migrations WHERE version = ?`
        await tx.delete(sql, [migration.version])
      })

      const executionTime = Date.now() - startTime
      log.info(`[Migration] Rolled back v${migration.version} in ${executionTime}ms`)

      return {
        success: true,
        version: migration.version,
        description: migration.description,
        executionTime
      }
    } catch (error) {
      const executionTime = Date.now() - startTime
      log.error(`[Migration] Rollback failed v${migration.version}:`, error)

      return {
        success: false,
        version: migration.version,
        description: migration.description,
        error: error instanceof Error ? error : new Error(String(error)),
        executionTime
      }
    }
  }

  async getCurrentVersion(): Promise<number> {
    try {
      const sql = `SELECT MAX(version) as version FROM migrations`
      const result = await this.dbService.query<{ version: number | null }>(sql)
      return result[0]?.version ?? 0
    } catch (error) {
      return 0
    }
  }

  async getHistory(): Promise<MigrationHistory[]> {
    const sql = `SELECT version, description, applied_at FROM migrations ORDER BY version`
    return await this.dbService.query<MigrationHistory>(sql)
  }

  async getStatus(): Promise<DatabaseStatus> {
    const currentVersion = await this.getCurrentVersion()
    const latestVersion = this.migrations.length > 0 ? Math.max(...this.migrations.map((m) => m.version)) : 0
    const history = await this.getHistory()

    return {
      currentVersion,
      latestVersion,
      pendingMigrations: this.migrations.filter((m) => m.version > currentVersion).length,
      history
    }
  }
}
