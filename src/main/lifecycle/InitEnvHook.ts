/**
 * Environment Hook
 *
 * 在应用初始化阶段打印环境信息
 * 用于调试和了解当前运行环境
 */

import { LifecyclePhase, LifecycleContext, LifecycleHook } from '@main/common/types'
import { log } from '@main/common/logger'
import { Env } from '@main/common/env'

/**
 * 环境信息 Hook
 *
 * 命名规范：导出变量名必须以 'Hook' 结尾以便自动扫描
 */
export const InitEnvHook: LifecycleHook = {
  name: 'init-env-info',
  phase: LifecyclePhase.INIT,
  priority: 10, // 优先级较高，尽早执行
  critical: false, // 非关键 Hook，失败不中断启动

  async execute(_context: LifecycleContext): Promise<void> {
    log.info('[InitEnvHook] 打印环境信息...')
    log.info('================================================================================')
    log.info('                          应用环境信息')
    log.info('================================================================================')

    // 运行环境
    log.info('')
    log.info('【运行环境】')
    log.info(`  开发模式:     ${Env.isDev ? '是' : '否'}`)
    log.info(`  生产模式:     ${Env.isProd ? '是' : '否'}`)
    log.info(`  测试模式:     ${Env.isTest ? '是' : '否'}`)
    log.info(`  已打包:       ${Env.isPackaged ? '是' : '否'}`)

    // 平台信息
    log.info('')
    log.info('【平台信息】')
    log.info(`  操作系统:     ${process.platform}`)
    log.info(`  系统架构:     ${process.arch}`)
    log.info(`  Windows:      ${Env.isWindows ? '是' : '否'}`)
    log.info(`  macOS:        ${Env.isMac ? '是' : '否'}`)
    log.info(`  Linux:        ${Env.isLinux ? '是' : '否'}`)

    // 应用信息
    log.info('')
    log.info('【应用信息】')
    log.info(`  应用名称:     ${Env.app.name}`)
    log.info(`  应用版本:     ${Env.app.version}`)
    log.info(`  系统语言:     ${Env.app.locale}`)

    // 路径信息
    log.info('')
    log.info('【路径信息】')
    log.info(`  应用根目录:   ${Env.paths.root}`)
    log.info(`  用户主目录:   ${Env.paths.home}`)
    log.info(`  用户数据目录: ${Env.paths.userData}`)
    log.info(`  工作区目录:   ${Env.paths.workspace}`)
    log.info(`  日志目录:     ${Env.paths.logPath}`)
    log.info(`  安装目录:     ${Env.paths.installDir}`)

    // 运行时目录
    try {
      const appRuntimeDir = Env.getAppRuntimeDir()
      const platformRuntimeDir = Env.getPlatformRuntimeDir()
      const workspaceRuntimeDir = await Env.getWorkspaceRuntimeDir()

      log.info('')
      log.info('【运行时目录】')
      log.info(`  应用运行时:   ${appRuntimeDir}`)
      log.info(`  平台运行时:   ${platformRuntimeDir}`)
      log.info(`  工作区运行时: ${workspaceRuntimeDir}`)
    } catch (error) {
      log.warn('[EnvHook] 获取运行时目录失败:', error)
    }

    // 环境变量（仅开发模式显示）
    if (Env.isDev) {
      log.info('')
      log.info('【主进程环境变量】')
      log.info(`  Bundle ID:        ${Env.main.bundleId || '未设置'}`)
      log.info(`  日志级别:         ${Env.main.logLevel || '默认'}`)
      log.info(`  日志最大大小:     ${Env.main.logMaxSize || '默认'}`)
      log.info(`  调试模式:         ${Env.main.debug || '未启用'}`)
      log.info(`  自动打开DevTools: ${Env.main.openDevTools || '未启用'}`)
      log.info(`  启用HTTP服务器:   ${Env.main.enableHttpServer || '未启用'}`)
      log.info(`  HTTP端口:         ${Env.main.httpPort || '未设置'}`)
    }

    // Node.js 版本信息
    log.info('')
    log.info('【运行时版本】')
    log.info(`  Node.js:      ${process.versions.node}`)
    log.info(`  Electron:     ${process.versions.electron}`)
    log.info(`  Chrome:       ${process.versions.chrome}`)
    log.info(`  V8:           ${process.versions.v8}`)

    log.info('')
    log.info('================================================================================')
    log.info('[EnvHook] 环境信息打印完成')
  }
}
