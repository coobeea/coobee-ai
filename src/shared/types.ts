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
