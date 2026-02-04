import { DatabaseService } from '../database/DatabaseService'

export interface Migration {
  version: number
  description: string
  up: (dbService: DatabaseService) => Promise<void>
  down: (dbService: DatabaseService) => Promise<void>
  dependencies?: number[]
  isBreaking?: boolean
}

export interface MigrationHistory {
  version: number
  description: string
  appliedAt: string
}

export interface DatabaseStatus {
  currentVersion: number
  latestVersion: number
  pendingMigrations: number
  history: MigrationHistory[]
}

export interface MigrationResult {
  success: boolean
  version: number
  description: string
  error?: Error
  executionTime: number
}
