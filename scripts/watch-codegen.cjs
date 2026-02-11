const chokidar = require('chokidar')
const path = require('path')
const generateAll = require('./generate-codegen.cjs')

const apiDirToWatch = path.join(__dirname, '../src/main/api')

console.log(`[Watcher] 监听 API 文件变化: ${apiDirToWatch}...`)

let regenerateTimer = null
function debounceRegenerate() {
  if (regenerateTimer) {
    clearTimeout(regenerateTimer)
  }

  regenerateTimer = setTimeout(async () => {
    console.log('[Watcher] 检测到文件变化，触发重新生成...\n')
    try {
      await generateAll({ parallel: true, stopOnError: false })
      console.log('[Watcher] ✅ 自动重新生成完成\n')
    } catch (error) {
      console.error('[Watcher] ❌ 自动重新生成失败:', error.message, '\n')
    }
  }, 300)
}

const watcher = chokidar
  .watch(apiDirToWatch, { ignoreInitial: true })
  .on('all', (event, changedPath) => {
    console.log(`[Watcher] 检测到变化: ${path.relative(apiDirToWatch, changedPath)}`)
    debounceRegenerate()
  })

const gracefulExit = () => {
  console.log('\n[Watcher] 停止监听...')
  watcher.close().then(() => {
    console.log('[Watcher] 监听已停止')
    process.exit(0)
  })
}

process.on('SIGINT', gracefulExit)
process.on('SIGTERM', gracefulExit)
process.on('exit', () => {
  console.log('[Watcher] 进程退出')
})
