/**
 * 日志存储 Store
 * 用于收集和管理应用运行时的事件日志
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogCategory = 'event' | 'ipc' | 'window' | 'tab' | 'app' | 'system' | 'user';

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  category: LogCategory;
  message: string;
  data?: unknown;
}

export const useLogStore = defineStore('log', () => {
  // 状态
  const logs = ref<LogEntry[]>([]);
  const maxLogs = ref(1000); // 最大日志数量
  const isEnabled = ref(true); // 是否启用日志收集

  // 过滤器
  const filterLevel = ref<LogLevel | 'all'>('all');
  const filterCategory = ref<LogCategory | 'all'>('all');
  const searchText = ref('');

  // 计算属性 - 过滤后的日志
  const filteredLogs = computed(() => {
    let result = logs.value;

    // 按级别过滤
    if (filterLevel.value !== 'all') {
      result = result.filter((log) => log.level === filterLevel.value);
    }

    // 按分类过滤
    if (filterCategory.value !== 'all') {
      result = result.filter((log) => log.category === filterCategory.value);
    }

    // 按搜索文本过滤
    if (searchText.value) {
      const search = searchText.value.toLowerCase();
      result = result.filter(
        (log) => log.message.toLowerCase().includes(search) || JSON.stringify(log.data).toLowerCase().includes(search)
      );
    }

    return result;
  });

  // 统计信息
  const stats = computed(() => {
    const counts = {
      total: logs.value.length,
      debug: 0,
      info: 0,
      warn: 0,
      error: 0
    };

    logs.value.forEach((log) => {
      counts[log.level]++;
    });

    return counts;
  });

  // 方法：添加日志
  function addLog(level: LogLevel, category: LogCategory, message: string, data?: unknown): void {
    if (!isEnabled.value) return;

    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      level,
      category,
      message,
      data
    };

    logs.value.unshift(entry); // 新日志添加到前面

    // 超过最大数量时移除旧日志
    if (logs.value.length > maxLogs.value) {
      logs.value = logs.value.slice(0, maxLogs.value);
    }
  }

  // 便捷方法
  function debug(category: LogCategory, message: string, data?: unknown): void {
    addLog('debug', category, message, data);
  }

  function info(category: LogCategory, message: string, data?: unknown): void {
    addLog('info', category, message, data);
  }

  function warn(category: LogCategory, message: string, data?: unknown): void {
    addLog('warn', category, message, data);
  }

  function error(category: LogCategory, message: string, data?: unknown): void {
    addLog('error', category, message, data);
  }

  // 清除日志
  function clearLogs(): void {
    logs.value = [];
  }

  // 清除指定级别的日志
  function clearByLevel(level: LogLevel): void {
    logs.value = logs.value.filter((log) => log.level !== level);
  }

  // 清除指定分类的日志
  function clearByCategory(category: LogCategory): void {
    logs.value = logs.value.filter((log) => log.category !== category);
  }

  // 导出日志为 JSON
  function exportLogs(): string {
    return JSON.stringify(logs.value, null, 2);
  }

  // 导出日志为文本
  function exportLogsAsText(): string {
    return logs.value
      .map((log) => {
        const time = new Date(log.timestamp).toLocaleString();
        const dataStr = log.data ? `\n  Data: ${JSON.stringify(log.data)}` : '';
        return `[${time}] [${log.level.toUpperCase()}] [${log.category}] ${log.message}${dataStr}`;
      })
      .join('\n\n');
  }

  // 设置过滤器
  function setLevelFilter(level: LogLevel | 'all'): void {
    filterLevel.value = level;
  }

  function setCategoryFilter(category: LogCategory | 'all'): void {
    filterCategory.value = category;
  }

  function setSearchText(text: string): void {
    searchText.value = text;
  }

  // 重置过滤器
  function resetFilters(): void {
    filterLevel.value = 'all';
    filterCategory.value = 'all';
    searchText.value = '';
  }

  return {
    // 状态
    logs,
    maxLogs,
    isEnabled,
    filterLevel,
    filterCategory,
    searchText,

    // 计算属性
    filteredLogs,
    stats,

    // 方法
    addLog,
    debug,
    info,
    warn,
    error,
    clearLogs,
    clearByLevel,
    clearByCategory,
    exportLogs,
    exportLogsAsText,
    setLevelFilter,
    setCategoryFilter,
    setSearchText,
    resetFilters
  };
});
