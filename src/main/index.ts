import appManager from './common/app'

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
