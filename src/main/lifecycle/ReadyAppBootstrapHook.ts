/**
 * App Bootstrap Hook
 *
 * 初始化应用级别的基础设置
 * - 系统托盘图标
 * - 应用图标和名称
 * - 其他全局配置
 */

import { LifecyclePhase, LifecycleContext, LifecycleHook } from '@main/common/types';
import { log } from '@main/common/logger';
import { app, nativeImage } from 'electron';

/**
 * App Bootstrap Hook
 *
 * 在 READY 阶段初始化应用基础设置
 * - 设置应用名称和版本
 * - 创建托盘图标
 * - 设置 macOS Dock 图标
 */
export const BeforeQuitAppBootstrapHook: LifecycleHook = {
  name: 'before-quit-app-bootstrap',
  phase: LifecyclePhase.BEFORE_QUIT,
  priority: 5,
  critical: false,

  async execute(_context: LifecycleContext): Promise<void> {
    try {
      const { ThreadWaker } = await import('@main/ai/threads/ThreadWaker');
      ThreadWaker.getInstance().stop();
      log.info('[BeforeQuitAppBootstrapHook] ThreadWaker 已停止');
    } catch (error) {
      log.error('[BeforeQuitAppBootstrapHook] ThreadWaker 停止失败:', error);
    }

    try {
      const { trayManager } = await import('@main/common/tray');
      trayManager.destroy();
      log.info('[BeforeQuitAppBootstrapHook] 托盘已销毁');
    } catch (error) {
      log.error('[BeforeQuitAppBootstrapHook] 托盘销毁失败:', error);
    }
  }
};

export const ReadyAppBootstrapHook: LifecycleHook = {
  name: 'ready-app-bootstrap',
  phase: LifecyclePhase.READY,
  priority: 90, // 优先级高于 WindowBootstrapHook (100)
  critical: false,

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[ReadyAppBootstrapHook] 初始化应用基础设置...');

    try {
      // 1. 设置应用名称
      app.setName('Coobee AI');
      log.info(`[ReadyAppBootstrapHook] 应用名称: ${app.getName()}`);

      // 2. 设置应用版本（从 package.json 读取）
      log.info(`[ReadyAppBootstrapHook] 应用版本: ${app.getVersion()}`);

      // 3. 初始化系统托盘
      const { trayManager } = await import('@main/common/tray');
      trayManager.createTray();

      // 4. 设置 macOS Dock 图标
      if (process.platform === 'darwin' && app.dock) {
        try {
          const { IconManager } = await import('@main/common/icons');
          const iconPath = IconManager.getAppIcon();
          const icon = nativeImage.createFromPath(iconPath);

          if (!icon.isEmpty()) {
            app.dock.setIcon(icon);
            log.info('[ReadyAppBootstrapHook] macOS Dock 图标已设置:', iconPath);
          } else {
            log.warn('[ReadyAppBootstrapHook] Dock 图标为空:', iconPath);
          }
        } catch (error) {
          log.error('[ReadyAppBootstrapHook] 设置 Dock 图标失败:', error);
        }
      }

      // 5. 启动 ThreadWaker（事件驱动唤醒系统）
      try {
        const { ThreadWaker } = await import('@main/ai/threads/ThreadWaker');
        ThreadWaker.getInstance().start();
        log.info('[ReadyAppBootstrapHook] ThreadWaker 已启动');
      } catch (error) {
        log.error('[ReadyAppBootstrapHook] ThreadWaker 启动失败:', error);
      }

      log.info('[ReadyAppBootstrapHook] 应用基础设置初始化完成');
    } catch (error) {
      log.error('[ReadyAppBootstrapHook] 应用基础设置初始化失败:', error);
    }
  }
};

/**
 * Thread 恢复 Hook
 *
 * 在 READY 阶段最后执行（低优先级），扫描未完成的 Thread 并尝试恢复。
 */
export const ReadyThreadRecoveryHook: LifecycleHook = {
  name: 'ready-thread-recovery',
  phase: LifecyclePhase.READY,
  priority: 200,
  critical: false,

  async execute(_context: LifecycleContext): Promise<void> {
    try {
      const { ThreadWaker } = await import('@main/ai/threads/ThreadWaker');
      await ThreadWaker.getInstance().recoverOnStartup();
    } catch (error) {
      log.error('[ReadyThreadRecoveryHook] Thread 恢复扫描失败:', error);
    }
  }
};
