/**
 * 共享类型定义
 * 主进程和渲染进程都可以使用
 */

export interface User {
  id: string
  name: string
  email: string
}

export interface AppSettings {
  theme: 'light' | 'dark' | 'auto'
  language: string
  fontSize: number
}

export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

/**
 * Platform 相关类型定义
 */
export interface DeviceInfo {
  platform: string
  arch: string
  cpuModel: string
  totalMemory: number
  osVersion: string
  osVersionMetadata: Array<{
    name: string
    build: number
  }>
}

export interface MemoryInfo {
  total: number
  free: number
  used: number
}

export interface DiskInfo {
  total: number
  free: number
  used: number
}

export interface HardwareSerialNumbers {
  cpuId?: string
  boardSerial?: string
  machineUUID?: string
  diskSerial?: string
  platform: string
}

// ==================== 快捷键类型 ====================

/**
 * 快捷键配置接口
 */
export interface Shortcut {
  /** 快捷键标识 */
  key: string
  /** 快捷键组合（如 'CommandOrControl+Q'） */
  shortcut: string
  /** 是否可编辑 */
  editable: boolean
  /** 是否启用 */
  enabled: boolean
  /** 是否为全局快捷键 */
  global: boolean
  /** 是否已注册 */
  registered: boolean
}
