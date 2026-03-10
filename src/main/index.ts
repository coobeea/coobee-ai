import { app } from 'electron';
import { getAppManager } from './common/app';

/**
 * 捕获未处理的异常
 * 记录错误后尝试优雅退出，而非立即终止
 */
process.on('uncaughtException', (error: Error) => {
  console.error('未捕获的异常:', error);
  // 尝试优雅退出（触发 BEFORE_QUIT 生命周期清理），超时后强制退出
  try {
    app.quit();
  } catch {
    // quit 失败则直接退出
  }
  setTimeout(() => process.exit(1), 5000).unref();
});

/**
 * 捕获未处理的 Promise 拒绝
 */
process.on('unhandledRejection', (reason: unknown) => {
  console.error('未处理的 Promise 拒绝:', reason);
});

/**
 * 处理进程信号（Ctrl+C, kill 等）
 * 确保应用能够正常清理资源后退出
 */
process.on('SIGINT', () => {
  console.log('\n[Main] 收到 SIGINT 信号 (Ctrl+C)，开始正常退出流程...');
  app.quit();
});

process.on('SIGTERM', () => {
  console.log('\n[Main] 收到 SIGTERM 信号，开始正常退出流程...');
  app.quit();
});

/**
 * 应用主入口
 * 使用 AppManager 来管理应用的完整生命周期
 */
async function main(): Promise<void> {
  try {
    // 获取 AppManager 单例实例
    const appManager = getAppManager();

    // 初始化应用
    await appManager.initialize();
  } catch (error) {
    console.error('应用启动失败:', error);
    process.exit(1);
  }
}

// 启动应用
main();
