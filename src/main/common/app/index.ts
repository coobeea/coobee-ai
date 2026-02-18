import { app, BrowserWindow, ipcMain } from 'electron';
import { electronApp } from '@electron-toolkit/utils';
import { optimizer } from '@electron-toolkit/utils';
import { log } from '../logger';
import { LifecycleManager } from '../lifecycle';
import { LifecyclePhase } from '../types';
import type { IAppManager } from './types';
import { ElectronAppEvents } from './types';
import { eventBus } from '../eventbus';
import { EventTypes } from '@shared/ipc/events';
import { AppChannels } from '@shared/ipc/channels';

/**
 * 预加载核心模块（确保尽早初始化）
 * ============================================
 *
 * 这些模块包含单例实例，需要在应用启动时立即初始化：
 *
 * 1. logger  - 日志系统（最优先，其他模块依赖它）
 * 2. env     - 环境配置（路径、平台信息等）
 * 3. eventbus - 事件总线（内部事件通信）
 * 4. config  - 应用配置（用户设置等）
 *
 * 注意：
 * - 这些导入是副作用导入（side-effect imports）
 * - 即使下面有具名导入，也需要保留这些预加载
 * - 加载顺序很重要：logger -> env -> eventbus -> config
 */
import '../logger'; // 1. 日志系统（最高优先级）
import '../env'; // 2. 环境配置
import '../eventbus'; // 3. 事件总线
import '../config'; // 4. 应用配置
import { stateManager } from '../state'; // 5. 状态管理（退出标志等）

/**
 * 应用管理器
 * 管理整个应用的生命周期和核心功能
 */
export class AppManager implements IAppManager {
  private lifecycleManager: LifecycleManager;

  constructor() {
    this.lifecycleManager = new LifecycleManager();
    this.setupAppEventHandlers();
    this.setupDevelopmentFeatures();
  }

  /**
   * 设置应用级别的事件处理器
   */
  private setupAppEventHandlers(): void {
    // 所有窗口关闭
    app.on(ElectronAppEvents.WINDOW_ALL_CLOSED, () => {
      log.info('[App] 所有窗口已关闭');

      // 注意：托盘模式下，窗口只是隐藏（不会触发此事件）
      // 所以能到这里，说明窗口是真的被关闭和销毁了

      // 在非 macOS 平台上，所有窗口关闭后退出应用
      if (process.platform !== 'darwin') {
        log.info('[App] Windows/Linux 应用退出');
        app.quit();
      } else {
        // macOS: 保持应用运行（标准行为）
        log.info('[App] macOS 应用保持运行，可通过 Dock 图标重新打开窗口');
      }
    });

    // macOS 激活应用
    app.on(ElectronAppEvents.ACTIVATE, async () => {
      log.info('[App] 应用被激活');
      const hasWindows = BrowserWindow.getAllWindows().length > 0;

      // 发送 app:activated 事件
      eventBus.emit(EventTypes.APP_ACTIVATED, {
        hasWindows
      });

      // macOS 标准行为：点击 Dock 图标时，如果没有窗口，则创建新窗口
      if (!hasWindows) {
        log.info('[App] 没有窗口，创建主窗口');
        try {
          const { windowManager } = await import('@main/common/window');
          windowManager.createWindow({ type: 'agent' });
        } catch (error) {
          log.error('[App] 创建主窗口失败:', error);
        }
      }
    });

    // 应用获得焦点
    app.on(ElectronAppEvents.BROWSER_WINDOW_FOCUS, () => {
      log.debug('[App] 应用窗口获得焦点');

      // 发送 app:focus 事件
      eventBus.emit(EventTypes.APP_FOCUS, {
        timestamp: Date.now()
      });
    });

    // 应用退出前清理
    // Electron before-quit 不会等待 async handler，必须用 preventDefault 阻止退出
    let quitting = false;
    app.on(ElectronAppEvents.BEFORE_QUIT, (event) => {
      if (quitting) return; // 清理完成后的二次退出，放行
      event.preventDefault();
      quitting = true;

      log.info('[App] 应用准备退出，开始清理资源...');

      // 同步设置退出状态（必须在 cleanup 之前完成，窗口 close 处理器依赖此标志）
      stateManager.setIsQuitting(true);

      // 发送 app:before-quit 事件
      eventBus.emit(EventTypes.APP_BEFORE_QUIT, {
        timestamp: Date.now()
      });

      this.cleanup().finally(() => {
        app.quit(); // 清理完成，真正退出
      });
    });

    // 第二个实例启动时的处理
    app.on(ElectronAppEvents.SECOND_INSTANCE, () => {
      log.info('[App] 检测到第二个实例启动');
      const hasWindows = BrowserWindow.getAllWindows().length > 0;

      // 发送 app:second-instance 事件
      eventBus.emit(EventTypes.APP_SECOND_INSTANCE, {
        hasWindows
      });
    });

    // 处理子进程崩溃
    app.on(ElectronAppEvents.CHILD_PROCESS_GONE, (_event, details) => {
      log.error('[App] 子进程崩溃:', details);

      // 发送 app:child-process-gone 事件
      eventBus.emit(EventTypes.APP_CHILD_PROCESS_GONE, {
        type: details.type,
        reason: details.reason,
        exitCode: details.exitCode
      });
    });
  }

  /**
   * 设置开发环境特性
   */
  private setupDevelopmentFeatures(): void {
    // 开发环境下启用F12开发者工具，生产环境忽略Ctrl+R刷新
    app.on(ElectronAppEvents.BROWSER_WINDOW_CREATED, (_, window) => {
      optimizer.watchWindowShortcuts(window);
    });

    // 注册全局快捷键（开发模式下）
    if (process.env.NODE_ENV === 'development') {
      log.info('[AppManager] 开发模式已启用');
    }
  }

  /**
   * 初始化应用
   */
  async initialize(): Promise<void> {
    try {
      // 确保应用单例运行
      if (!app.requestSingleInstanceLock()) {
        log.info('[AppManager] 应用已在运行，退出当前实例');
        app.quit();
        process.exit(0);
      }

      log.info('[App] 开始初始化应用...');

      // 注册 IPC handler（渲染端可能在 READY 阶段完成前就加载，需要先注册）
      let backendReady = false;
      ipcMain.handle(AppChannels.IS_BACKEND_READY, () => backendReady);

      // 1. 应用基础配置
      electronApp.setAppUserModelId('com.coobee');

      // 允许 AudioContext 在无用户手势时自动播放（语音识别需要）
      app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

      log.info('[App] 应用基础配置完成');

      // 2. 触发 INIT 阶段生命周期（供其他模块使用）
      await this.lifecycleManager.executePhase(LifecyclePhase.INIT);

      // 等待应用准备就绪
      await app.whenReady();

      // 3. 触发 READY 阶段生命周期（IPC 注册、窗口创建等由 Hook 处理）
      await this.lifecycleManager.executePhase(LifecyclePhase.READY);

      // 4. 所有 Hook 完成 → 标记后端就绪并通知前端
      backendReady = true;
      eventBus.emit(EventTypes.BACKEND_READY, { timestamp: Date.now() });
      log.info('[App] 应用初始化完成，后端就绪信号已发送');
    } catch (error) {
      log.error('[App] 应用初始化失败:', error);
      throw error;
    }
  }

  /**
   * 清理资源
   */
  private async cleanup(): Promise<void> {
    try {
      // 触发 BEFORE_QUIT 阶段生命周期（供其他模块清理资源）
      await this.lifecycleManager.executePhase(LifecyclePhase.BEFORE_QUIT);

      log.info('[App] 资源清理完成');
    } catch (error) {
      log.error('[App] 资源清理失败:', error);
    }
  }

  /**
   * 获取生命周期管理器
   */
  getLifecycleManager(): LifecycleManager {
    return this.lifecycleManager;
  }
}

/**
 * AppManager 单例实例
 *
 * 注意：这里导出实例是为了在其他模块（如 WindowManager）中访问应用状态
 * 但实际的初始化（appManager.initialize()）仍然在 src/main/index.ts 的 main() 中调用
 */
let appManagerInstance: AppManager | null = null;

export function getAppManager(): AppManager {
  if (!appManagerInstance) {
    appManagerInstance = new AppManager();
  }
  return appManagerInstance;
}

export default AppManager;
