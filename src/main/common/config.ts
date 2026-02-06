import ElectronStore from 'electron-store'

import { eventBus } from './eventbus'
import { log } from './logger'
import { EventTypes } from '@shared/ipc/events'
import type { Shortcut } from '@shared/types'

enum ConfigKey {
  THEME = 'theme',
  AUTO_START = 'autoStart',
  START_TO_TRAY = 'startToTray',
  CLOSE_TO_TRAY = 'closeToTray',
  LANGUAGE = 'language',
  AUTO_UPDATE = 'autoUpdate',
  BETA_UPDATES = 'betaUpdates',
  MEMORY_LIMIT = 'memoryLimit',
  HARDWARE_ACCELERATION = 'hardwareAcceleration',
  SHOW_TRAY_ICON = 'showTrayIcon',
  SOUND_EFFECTS = 'soundEffects',
  ALWAYS_ON_TOP = 'alwaysOnTop',
  BACKUP_PATH = 'backupPath',
  LOG_PATH = 'logPath',
  SHORTCUTS = 'shortcuts'
}

type ThemeMode = 'light' | 'dark' | 'auto'

interface ConfigStore {
  theme: ThemeMode
  autoStart: boolean
  startToTray: boolean
  closeToTray: boolean
  language: string
  autoUpdate: boolean
  betaUpdates: boolean
  memoryLimit: number
  hardwareAcceleration: boolean
  showTrayIcon: boolean
  soundEffects: boolean
  alwaysOnTop: boolean
  backupPath: string
  logPath: string
  shortcuts: Shortcut[]
}

const STORE_NAME = 'app-config'

export class Config {
  private store: ElectronStore<ConfigStore>

  constructor() {
    this.store = new ElectronStore<ConfigStore>({
      name: STORE_NAME,
      defaults: {
        theme: 'auto',
        autoStart: false,
        startToTray: false,
        closeToTray: true,
        language: 'zh-CN',
        autoUpdate: true,
        betaUpdates: false,
        memoryLimit: 2048,
        hardwareAcceleration: true,
        showTrayIcon: true,
        soundEffects: true,
        alwaysOnTop: false,
        backupPath: '',
        logPath: '',
        shortcuts: []
      },
      watch: true
    })
  }

  get<K extends keyof ConfigStore>(key: K): ConfigStore[K] {
    return (this.store.get as unknown as (key: K) => ConfigStore[K])(key)
  }

  set<K extends keyof ConfigStore>(key: K, value: ConfigStore[K]): void {
    ;(this.store.set as unknown as (key: K, value: ConfigStore[K]) => void)(key, value)
  }

  getTheme(): ThemeMode {
    return this.get(ConfigKey.THEME)
  }

  setTheme(theme: ThemeMode): void {
    log.info(`Setting theme to: ${theme}`)
    const currentTheme = this.get(ConfigKey.THEME)
    if (currentTheme !== theme) {
      this.set(ConfigKey.THEME, theme)
      eventBus.emit(EventTypes.CONFIG_THEME_CHANGED, { theme })
    }
  }

  getAutoStart(): boolean {
    return this.get(ConfigKey.AUTO_START)
  }

  setAutoStart(value: boolean): void {
    log.info(`Setting autoStart to: ${value}`)
    const currentValue = this.get(ConfigKey.AUTO_START)
    if (currentValue !== value) {
      this.set(ConfigKey.AUTO_START, value)
      eventBus.emit(EventTypes.CONFIG_AUTO_START_CHANGED, { value })
    }
  }

  getStartToTray(): boolean {
    return this.get(ConfigKey.START_TO_TRAY)
  }

  setStartToTray(value: boolean): void {
    log.info(`Setting startToTray to: ${value}`)
    const currentValue = this.get(ConfigKey.START_TO_TRAY)
    if (currentValue !== value) {
      this.set(ConfigKey.START_TO_TRAY, value)
      eventBus.emit(EventTypes.CONFIG_START_TO_TRAY_CHANGED, { value })
    }
  }

  getCloseToTray(): boolean {
    return this.get(ConfigKey.CLOSE_TO_TRAY)
  }

  setCloseToTray(value: boolean): void {
    log.info(`Setting closeToTray to: ${value}`)
    const currentValue = this.get(ConfigKey.CLOSE_TO_TRAY)
    if (currentValue !== value) {
      this.set(ConfigKey.CLOSE_TO_TRAY, value)
      eventBus.emit(EventTypes.CONFIG_CLOSE_TO_TRAY_CHANGED, { value })
    }
  }

  getLanguage(): string {
    return this.get(ConfigKey.LANGUAGE)
  }

  setLanguage(value: string): void {
    log.info(`Setting language to: ${value}`)
    const currentValue = this.get(ConfigKey.LANGUAGE)
    if (currentValue !== value) {
      this.set(ConfigKey.LANGUAGE, value)
      eventBus.emit(EventTypes.CONFIG_LANGUAGE_CHANGED, { language: value })
    }
  }

  getAutoUpdate(): boolean {
    return this.get(ConfigKey.AUTO_UPDATE)
  }

  setAutoUpdate(value: boolean): void {
    log.info(`Setting autoUpdate to: ${value}`)
    const currentValue = this.get(ConfigKey.AUTO_UPDATE)
    if (currentValue !== value) {
      this.set(ConfigKey.AUTO_UPDATE, value)
      eventBus.emit(EventTypes.CONFIG_AUTO_UPDATE_CHANGED, { value })
    }
  }

  getBetaUpdates(): boolean {
    return this.get(ConfigKey.BETA_UPDATES)
  }

  setBetaUpdates(value: boolean): void {
    log.info(`Setting betaUpdates to: ${value}`)
    const currentValue = this.get(ConfigKey.BETA_UPDATES)
    if (currentValue !== value) {
      this.set(ConfigKey.BETA_UPDATES, value)
      eventBus.emit(EventTypes.CONFIG_BETA_UPDATES_CHANGED, { value })
    }
  }

  getMemoryLimit(): number {
    return this.get(ConfigKey.MEMORY_LIMIT)
  }

  setMemoryLimit(value: number): void {
    log.info(`Setting memoryLimit to: ${value}`)
    const currentValue = this.get(ConfigKey.MEMORY_LIMIT)
    if (currentValue !== value) {
      this.set(ConfigKey.MEMORY_LIMIT, value)
      eventBus.emit(EventTypes.CONFIG_MEMORY_LIMIT_CHANGED, { limit: value })
    }
  }

  getHardwareAcceleration(): boolean {
    return this.get(ConfigKey.HARDWARE_ACCELERATION)
  }

  setHardwareAcceleration(value: boolean): void {
    log.info(`Setting hardwareAcceleration to: ${value}`)
    const currentValue = this.get(ConfigKey.HARDWARE_ACCELERATION)
    if (currentValue !== value) {
      this.set(ConfigKey.HARDWARE_ACCELERATION, value)
      eventBus.emit(EventTypes.CONFIG_HARDWARE_ACCELERATION_CHANGED, { value })
    }
  }

  getShowTrayIcon(): boolean {
    return this.get(ConfigKey.SHOW_TRAY_ICON)
  }

  setShowTrayIcon(value: boolean): void {
    log.info(`Setting showTrayIcon to: ${value}`)
    const currentValue = this.get(ConfigKey.SHOW_TRAY_ICON)
    if (currentValue !== value) {
      this.set(ConfigKey.SHOW_TRAY_ICON, value)
      eventBus.emit(EventTypes.CONFIG_SHOW_TRAY_ICON_CHANGED, { value })
    }
  }

  getSoundEffects(): boolean {
    return this.get(ConfigKey.SOUND_EFFECTS)
  }

  setSoundEffects(value: boolean): void {
    log.info(`Setting soundEffects to: ${value}`)
    const currentValue = this.get(ConfigKey.SOUND_EFFECTS)
    if (currentValue !== value) {
      this.set(ConfigKey.SOUND_EFFECTS, value)
      eventBus.emit(EventTypes.CONFIG_SOUND_EFFECTS_CHANGED, { value })
    }
  }

  getAlwaysOnTop(): boolean {
    return this.get(ConfigKey.ALWAYS_ON_TOP)
  }

  setAlwaysOnTop(value: boolean): void {
    log.info(`Setting alwaysOnTop to: ${value}`)
    const currentValue = this.get(ConfigKey.ALWAYS_ON_TOP)
    if (currentValue !== value) {
      this.set(ConfigKey.ALWAYS_ON_TOP, value)
      eventBus.emit(EventTypes.CONFIG_ALWAYS_ON_TOP_CHANGED, { value })
    }
  }

  getBackupPath(): string {
    return this.get(ConfigKey.BACKUP_PATH)
  }

  setBackupPath(value: string): void {
    log.info(`Setting backupPath to: ${value}`)
    const currentValue = this.get(ConfigKey.BACKUP_PATH)
    if (currentValue !== value) {
      this.set(ConfigKey.BACKUP_PATH, value)
      eventBus.emit(EventTypes.CONFIG_BACKUP_PATH_CHANGED, { path: value })
    }
  }

  getLogPath(): string {
    return this.get(ConfigKey.LOG_PATH)
  }

  setLogPath(value: string): void {
    log.info(`Setting logPath to: ${value}`)
    const currentValue = this.get(ConfigKey.LOG_PATH)
    if (currentValue !== value) {
      this.set(ConfigKey.LOG_PATH, value)
      eventBus.emit(EventTypes.CONFIG_LOG_PATH_CHANGED, { path: value })
    }
  }

  getShortcuts(): Shortcut[] {
    return this.get(ConfigKey.SHORTCUTS)
  }

  setShortcuts(value: Shortcut[]): void {
    log.info(`Setting shortcuts, count: ${value.length}`)
    this.set(ConfigKey.SHORTCUTS, value)
    eventBus.emit(EventTypes.CONFIG_SHORTCUTS_CHANGED, { shortcuts: value })
  }
}

export const config = new Config()
