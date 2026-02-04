import ElectronStore from 'electron-store'

import { eventBus } from './eventbus'
import { log } from './logger'

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
  WORKSPACE_PATH = 'workspacePath',
  BACKUP_PATH = 'backupPath',
  LOG_PATH = 'logPath'
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
  workspacePath: string
  backupPath: string
  logPath: string
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
        workspacePath: '',
        backupPath: '',
        logPath: ''
      },
      watch: true
    })
  }

  get<K extends keyof ConfigStore>(key: K): ConfigStore[K] {
    return (this.store.get as any)(key)
  }

  set<K extends keyof ConfigStore>(key: K, value: ConfigStore[K]): void {
    (this.store.set as any)(key, value)
  }

  getTheme(): ThemeMode {
    return this.get(ConfigKey.THEME)
  }

  setTheme(theme: ThemeMode): void {
    log.info(`Setting theme to: ${theme}`)
    const currentTheme = this.get(ConfigKey.THEME)
    if (currentTheme !== theme) {
      this.set(ConfigKey.THEME, theme)
      eventBus.emit('theme:changed', theme)
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
      eventBus.emit('autoStart:changed', value)
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
      eventBus.emit('startToTray:changed', value)
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
      eventBus.emit('closeToTray:changed', value)
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
      eventBus.emit('language:changed', value)
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
      eventBus.emit('autoUpdate:changed', value)
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
      eventBus.emit('betaUpdates:changed', value)
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
      eventBus.emit('memoryLimit:changed', value)
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
      eventBus.emit('hardwareAcceleration:changed', value)
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
      eventBus.emit('showTrayIcon:changed', value)
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
      eventBus.emit('soundEffects:changed', value)
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
      eventBus.emit('alwaysOnTop:changed', value)
    }
  }

  getWorkspacePath(): string {
    return this.get(ConfigKey.WORKSPACE_PATH)
  }

  setWorkspacePath(value: string): void {
    log.info(`Setting workspacePath to: ${value}`)
    const currentValue = this.get(ConfigKey.WORKSPACE_PATH)
    if (currentValue !== value) {
      this.set(ConfigKey.WORKSPACE_PATH, value)
      eventBus.emit('workspacePath:changed', value)
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
      eventBus.emit('backupPath:changed', value)
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
      eventBus.emit('logPath:changed', value)
    }
  }
}

export const config = new Config()
