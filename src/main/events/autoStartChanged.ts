import { app } from 'electron';
import { log } from '@main/common/logger';

/**
 * 自动启动变更事件处理器
 * 事件名: config:autoStart:changed
 * 对应事件: EventTypes.CONFIG_AUTO_START_CHANGED
 *
 * 平台特性：
 * - macOS: 使用 agentService 类型实现后台启动
 * - Windows: 使用 --hidden 参数实现隐藏启动
 * - Linux: 不支持自动设置
 */
export default async (payload: { value: boolean }): Promise<void> => {
  log.info('[Event] 处理自动启动变更事件:', payload.value);

  const autoStart = payload.value;
  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';
  const isLinux = process.platform === 'linux';
  const appName = app.getName();

  if (isLinux) {
    log.warn('[Event] Linux 平台不支持自动设置开机启动');
    return;
  }

  // 获取 startToTray 配置
  const { config } = await import('@main/common/config');
  const startToTray = config.getStartToTray();

  // 设置开机启动配置
  app.setLoginItemSettings({
    openAtLogin: autoStart, // 是否开机启动
    type: isMac && autoStart ? 'agentService' : undefined, // macOS: 使用 agentService 实现隐藏启动
    name: `${appName}-${process.env.NODE_ENV || 'production'}`, // 动态生成应用名称
    path: process.execPath, // 启动路径
    args: isWindows && autoStart ? ['--hidden'] : [], // Windows: 添加隐藏参数
    openAsHidden: autoStart && startToTray // 配合 startToTray 配置
  });

  // 日志记录
  log.info(`[Event] 操作系统: ${process.platform}`);
  log.info(`[Event] 设置开机启动: ${autoStart}`);
  log.info(`[Event] 启动到托盘: ${startToTray}`);

  if (isMac) {
    log.info(`[Event] macOS 开机启动类型: ${autoStart ? 'agentService' : 'default'}`);
  }
  if (isWindows) {
    log.info(`[Event] Windows 开机启动参数: ${autoStart ? '--hidden' : '无'}`);
  }
};
