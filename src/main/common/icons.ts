import { app, nativeImage } from 'electron'
import fs from 'fs'
import path from 'path'

import { log } from './logger'

export class IconManager {
  private static basePath: string = path.join(app.getAppPath(), 'resources')

  static getAppIcon(): string {
    const iconPath = path.join(
      this.basePath,
      process.platform === 'win32' ? 'logo.ico' : 'logo.png'
    )
    log.debug('应用图标路径:', iconPath)
    return iconPath
  }

  static getTrayIcon(): string {
    const iconPath = path.join(
      this.basePath,
      process.platform === 'win32' ? 'tray-icon.ico' : 'tray-icon.png'
    )
    log.debug('托盘图标路径:', iconPath)
    return iconPath
  }

  static getTrayNativeImage(): Electron.NativeImage {
    if (process.platform === 'darwin') {
      const optimizedPath = path.join(this.basePath, 'tray-icon.png')
      const retinaPath = path.join(this.basePath, 'tray-icon@2x.png')

      if (this.checkIconExists(optimizedPath)) {
        const icon = nativeImage.createFromPath(optimizedPath)

        if (this.checkIconExists(retinaPath)) {
          icon.addRepresentation({
            scaleFactor: 2.0,
            buffer: fs.readFileSync(retinaPath)
          })
        }

        log.info('使用彩色托盘图标 (22x22)')
        return icon
      }

      log.warn('macOS 优化托盘图标不存在，使用运行时调整')
      const iconPath = this.getTrayIcon()
      const icon = nativeImage.createFromPath(iconPath)
      return icon.resize({ width: 22, height: 22 })
    }

    const iconPath = this.getTrayIcon()
    return nativeImage.createFromPath(iconPath)
  }

  static checkIconExists(iconPath: string): boolean {
    try {
      return fs.existsSync(iconPath)
    } catch (error) {
      log.error('检查图标文件失败:', error)
      return false
    }
  }

  static validateIcons(): { app: boolean; tray: boolean } {
    const appIcon = this.getAppIcon()
    const trayIcon = this.getTrayIcon()

    const appExists = this.checkIconExists(appIcon)
    const trayExists = this.checkIconExists(trayIcon)

    if (!appExists) {
      log.warn('应用图标文件不存在:', appIcon)
    }
    if (!trayExists) {
      log.warn('托盘图标文件不存在:', trayIcon)
    }

    return {
      app: appExists,
      tray: trayExists
    }
  }
}

export const getAppIcon = (): string => IconManager.getAppIcon()
export const getTrayIcon = (): string => IconManager.getTrayIcon()
export const getTrayNativeImage = (): Electron.NativeImage => IconManager.getTrayNativeImage()
export const validateIcons = (): { app: boolean; tray: boolean } => IconManager.validateIcons()
