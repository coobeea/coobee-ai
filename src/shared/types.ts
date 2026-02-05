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
