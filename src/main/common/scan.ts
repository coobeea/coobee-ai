import { log } from './logger';
import { DiscoveredModule } from './types';

/**
 * 扫描 API 文件
 */
export function scanApis(): DiscoveredModule[] {
  log.info('[Scan] 开始扫描API文件...');

  const modules = import.meta.glob('@main/api/**/*.ts', { eager: true });
  const totalFound = Object.keys(modules).length;

  log.info(`[Scan] 发现 ${totalFound} 个API文件:`);
  Object.keys(modules).forEach((path, index) => {
    log.info(`[Scan]   ${index + 1}. ${path}`);
  });

  const filteredModules = filterModules(modules);
  const filteredCount = filteredModules.length;

  log.info(`[Scan] API文件扫描完成，共 ${filteredCount} 个文件`);

  return filteredModules;
}

/**
 * 扫描生命周期 Hook 文件
 * 扫描 @main/lifecycle 目录下所有 *Hook.ts 文件
 */
export function scanLifeCycleHooks(): DiscoveredModule[] {
  log.info('[Scan] 开始扫描生命周期Hook文件...');

  const modules = import.meta.glob('@main/lifecycle/**/*Hook.ts', { eager: true });
  const totalFound = Object.keys(modules).length;

  const filteredModules = filterModules(modules, ['BaseHook']);
  const filteredCount = filteredModules.length;

  log.info(`[Scan] 生命周期Hook扫描完成: 发现 ${totalFound} 个文件，过滤后剩余 ${filteredCount} 个`);

  return filteredModules;
}

/**
 * 扫描事件处理器文件
 * 扫描 @main/events 目录下所有 *Changed.ts 文件
 *
 * 事件命名规范：
 * - 文件名以 Changed.ts 结尾（如 themeChanged.ts）
 * - 必须默认导出一个处理函数
 * - 文件名会自动转换为事件名（themeChanged → config:theme:changed）
 */
export function scanEventHandlers(): DiscoveredModule[] {
  log.info('[Scan] 开始扫描事件处理器文件...');

  const modules = import.meta.glob('@main/events/**/*Changed.ts', { eager: true });
  const totalFound = Object.keys(modules).length;

  // 过滤掉 README.md 等非事件文件
  const filteredModules = filterModules(modules, ['README']);
  const filteredCount = filteredModules.length;

  log.info(`[Scan] 事件处理器文件扫描完成: 发现 ${totalFound} 个文件，过滤后剩余 ${filteredCount} 个`);

  return filteredModules;
}

/**
 * 扫描 WebSocket Channel 文件
 * 扫描 @main/channels 目录下所有 *Channel.ts 文件
 *
 * Channel 命名规范：
 * - 文件名以 Channel.ts 结尾（如 StreamChannel.ts、WorkerChannel.ts）
 * - 必须导出一个实现 WsChannel 接口的对象
 * - prefix 字段用于消息路由（如 'stream'、'worker'）
 */
export function scanWsChannels(): DiscoveredModule[] {
  log.info('[Scan] 开始扫描 WebSocket Channel 文件...');

  const modules = import.meta.glob('@main/channels/**/*Channel.ts', { eager: true });
  const totalFound = Object.keys(modules).length;

  const filteredModules = filterModules(modules, ['BaseChannel']);
  const filteredCount = filteredModules.length;

  log.info(`[Scan] WebSocket Channel 扫描完成: 发现 ${totalFound} 个文件，过滤后剩余 ${filteredCount} 个`);

  return filteredModules;
}

/**
 * 扫描 Gateway 方法组文件
 * 扫描 @main/gateway/methods 目录下所有 *.ts 文件
 *
 * 方法组命名规范：
 * - 文件名为业务领域（如 chat.ts、stream.ts、worker.ts）
 * - 必须导出实现 MethodGroup 接口的对象
 * - namespace 字段用于方法路由（如 'chat' → 'chat.send'）
 */
export function scanGatewayMethods(): DiscoveredModule[] {
  log.info('[Scan] 开始扫描 Gateway 方法组文件...');

  const modules = import.meta.glob('@main/gateway/methods/**/*.ts', { eager: true });
  const totalFound = Object.keys(modules).length;

  const filteredModules = filterModules(modules);
  const filteredCount = filteredModules.length;

  log.info(`[Scan] Gateway 方法组扫描完成: 发现 ${totalFound} 个文件，过滤后剩余 ${filteredCount} 个`);

  return filteredModules;
}

/**
 * 扫描 Gateway 事件桥接文件
 * 扫描 @main/gateway/events 目录下所有 *.ts 文件
 *
 * 事件桥接命名规范：
 * - 文件名以 Bridge.ts 结尾（如 StreamBridge.ts）
 * - 必须导出 EventBridgeInit 类型的函数
 */
export function scanGatewayEventBridges(): DiscoveredModule[] {
  log.info('[Scan] 开始扫描 Gateway 事件桥接文件...');

  const modules = import.meta.glob('@main/gateway/events/**/*.ts', { eager: true });
  const totalFound = Object.keys(modules).length;

  // 过滤掉测试文件
  const filteredModules = filterModules(modules, ['/__tests__/', '.test.ts', '.spec.ts']);
  const filteredCount = filteredModules.length;

  log.info(`[Scan] Gateway 事件桥接扫描完成: 发现 ${totalFound} 个文件，过滤后剩余 ${filteredCount} 个`);

  return filteredModules;
}

/**
 * 扫描声明式 CronJob 文件
 * 扫描 @main/jobs 目录下所有 *Job.ts 文件
 *
 * Job 命名规范：
 * - 文件名以 Job.ts 结尾（如 HealthCheckJob.ts、DataSyncJob.ts）
 * - 必须默认导出一个继承 BaseCronJob 的类
 */
export function scanCronJobs(): DiscoveredModule[] {
  log.info('[Scan] 开始扫描声明式 CronJob 文件...');

  const modules = import.meta.glob('@main/jobs/**/*Job.ts', { eager: true });
  const totalFound = Object.keys(modules).length;

  const filteredModules = filterModules(modules, ['BaseCronJob', '__tests__', '.test.ts', '.spec.ts']);
  const filteredCount = filteredModules.length;

  log.info(`[Scan] 声明式 CronJob 扫描完成: 发现 ${totalFound} 个文件，过滤后剩余 ${filteredCount} 个`);

  return filteredModules;
}

/**
 * 通用过滤函数 - 过滤掉指定的文件
 * @param modules 扫描结果对象 (使用 eager: true 时，值直接是模块内容)
 * @param excludePatterns 要排除的文件名模式数组
 * @returns 过滤后的模块对象
 */
export function filterModules(modules: Record<string, unknown>, excludePatterns: string[] = []): DiscoveredModule[] {
  const filteredModules: DiscoveredModule[] = [];

  for (const [modulePath, moduleContent] of Object.entries(modules)) {
    // 检查是否应该排除这个文件
    const shouldExclude = excludePatterns.some((excludePattern) => modulePath.includes(excludePattern));

    if (!shouldExclude) {
      // 当使用 eager: true 时，moduleContent 直接就是模块内容，不是函数
      filteredModules.push({
        path: modulePath,
        module: moduleContent as Record<string, unknown>
      });
    }
  }

  return filteredModules;
}
