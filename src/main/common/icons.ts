import { app, nativeImage } from 'electron';
import fs from 'fs';
import path from 'path';

import { log } from './logger';

export class IconManager {
  private static basePath: string = path.join(app.getAppPath(), 'resources');

  static getAppIcon(): string {
    const iconPath = path.join(this.basePath, process.platform === 'win32' ? 'logo.ico' : 'logo.png');
    log.debug('应用图标路径:', iconPath);
    return iconPath;
  }

  /**
   * 获取托盘图标的 NativeImage 对象
   * macOS: 使用 tray-logo.png（Template 模式，支持明暗主题）
   * Windows: 使用 tray-logo.ico
   *
   * @returns NativeImage 对象，如果图标不存在则返回空图标
   */
  static getTrayIcon(): Electron.NativeImage {
    if (process.platform === 'darwin') {
      // macOS: 使用 tray-logo.png（黑白单色，支持明暗主题）
      const templatePath = path.join(this.basePath, 'tray-logo.png');
      const retinaPath = path.join(this.basePath, 'tray-logo@2x.png');

      if (this.checkIconExists(templatePath)) {
        const icon = nativeImage.createFromPath(templatePath);

        // 添加 Retina 版本
        if (this.checkIconExists(retinaPath)) {
          icon.addRepresentation({
            scaleFactor: 2.0,
            buffer: fs.readFileSync(retinaPath)
          });
        }

        // 设置为 Template 图像（关键：自动适配系统主题）
        icon.setTemplateImage(true);

        log.info('[IconManager] 使用托盘图标: tray-logo.png (22x22)');
        return icon;
      }

      log.warn('[IconManager] 托盘图标不存在，使用空图标');
      return nativeImage.createEmpty();
    }

    // Windows/Linux: 使用 tray-logo.ico 或 tray-logo.png
    const iconPath = path.join(this.basePath, process.platform === 'win32' ? 'tray-logo.ico' : 'tray-logo.png');
    const icon = nativeImage.createFromPath(iconPath);

    if (icon.isEmpty()) {
      log.error('[IconManager] 托盘图标不存在:', iconPath);
    } else {
      log.debug('[IconManager] 托盘图标加载成功:', iconPath);
    }

    return icon;
  }

  /**
   * 检查图标文件是否存在（私有方法）
   */
  private static checkIconExists(iconPath: string): boolean {
    try {
      return fs.existsSync(iconPath);
    } catch (error) {
      log.error('[IconManager] 检查图标文件失败:', error);
      return false;
    }
  }
}

/**
 * 便捷导出函数
 */

/** 获取应用图标路径 */
export const getAppIcon = (): string => IconManager.getAppIcon();

/** 获取托盘图标的 NativeImage（推荐使用，自动处理跨平台兼容和错误处理） */
export const getTrayNativeImage = (): Electron.NativeImage => IconManager.getTrayIcon();
