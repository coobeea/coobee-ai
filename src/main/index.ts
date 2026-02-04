import appManager from './common/app'

/**
 * 捕获未处理的异常
 */
process.on('uncaughtException', (error: Error) => {
  // 忽略 EPIPE 错误（管道错误，通常发生在快速重启时）
  if ((error as NodeJS.ErrnoException).code === 'EPIPE') {
    return
  }
  console.error('未捕获的异常:', error)
})

/**
 * 捕获未处理的 Promise 拒绝
 */
process.on('unhandledRejection', (reason: unknown) => {
  console.error('未处理的 Promise 拒绝:', reason)
})

/**
 * 应用主入口
 * 使用 AppManager 来管理应用的完整生命周期
 */
async function main(): Promise<void> {
  try {
    // 初始化应用
    await appManager.initialize()
  } catch (error) {
    console.error('应用启动失败:', error)
    process.exit(1)
  }
}

// 启动应用
main()
