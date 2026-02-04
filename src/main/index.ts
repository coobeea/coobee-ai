import AppManager from './common/app'

/**
 * 捕获未处理的异常
 */
process.on('uncaughtException', (error: Error) => {
  console.error('未捕获的异常:', error)
  process.exit(1)
})

/**
 * 捕获未处理的 Promise 拒绝
 */
process.on('unhandledRejection', (reason: unknown) => {
  console.error('未处理的 Promise 拒绝:', reason)
  process.exit(1)
})

/**
 * 应用主入口
 * 使用 AppManager 来管理应用的完整生命周期
 */
async function main(): Promise<void> {
  try {
    // 在这里创建 AppManager 实例，避免在模块加载时创建
    // 这样可以确保在合适的时机初始化，避免 EPIPE 错误
    const appManager = new AppManager()

    // 初始化应用
    await appManager.initialize()
  } catch (error) {
    console.error('应用启动失败:', error)
    process.exit(1)
  }
}

// 启动应用
main()
