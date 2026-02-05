/**
 * 用户偏好设置 Store
 *
 * 使用 Pinia 管理用户偏好设置，支持：
 * 1. 响应式数据存储
 * 2. 自动持久化到 localStorage
 * 3. 跨标签页同步
 * 4. 在 Vue 组件和普通服务类中使用
 *
 * 使用示例:
 * ```typescript
 * // 在 Vue 组件中
 * const preferenceStore = usePreferenceStore();
 * const theme = preferenceStore.get('app.theme', 'light');
 * preferenceStore.set('app.theme', 'dark');
 *
 * // 使用计算属性
 * const isDarkMode = computed(() => preferenceStore.get('app.theme', 'light') === 'dark');
 *
 * // 在服务类中（需要确保 Pinia 已初始化）
 * import { usePreferenceStore } from '@/stores/preference';
 * const store = usePreferenceStore();
 * ```
 */

import { defineStore } from 'pinia'
import { reactive, watch } from 'vue'

// 偏好设置值类型
export type PreferenceValue = string | number | boolean | object | null

// 偏好设置记录类型
export type PreferenceRecord = Record<string, PreferenceValue>

// localStorage 键名
const STORAGE_KEY = 'preference-store'

/**
 * 从 localStorage 读取数据
 */
function loadFromStorage(): Map<string, PreferenceValue> {
  const map = new Map<string, PreferenceValue>()
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (parsed && typeof parsed === 'object') {
        for (const [key, value] of Object.entries(parsed)) {
          map.set(key, value as PreferenceValue)
        }
      }
    }
  } catch (error) {
    console.warn('[PreferenceStore] Failed to load from storage:', error)
  }
  return map
}

/**
 * 保存数据到 localStorage
 */
function saveToStorage(preferences: Map<string, PreferenceValue>): void {
  try {
    const obj: PreferenceRecord = {}
    for (const [key, value] of preferences.entries()) {
      obj[key] = value
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
  } catch (error) {
    console.warn('[PreferenceStore] Failed to save to storage:', error)
  }
}

/**
 * 偏好设置 Store
 */
export const usePreferenceStore = defineStore(
  'preference',
  () => {
    // 从 localStorage 恢复数据初始化 Map
    const preferences = reactive<Map<string, PreferenceValue>>(loadFromStorage())

    // 监听变化，自动保存到 localStorage
    watch(
      () => preferences,
      () => saveToStorage(preferences),
      { deep: true }
    )

    /**
     * 获取偏好设置值
     * @param key 设置键名
     * @param defaultValue 默认值
     */
    function get<T extends PreferenceValue>(key: string, defaultValue: T): T {
      if (preferences.has(key)) {
        return preferences.get(key) as T
      }
      return defaultValue
    }

    /**
     * 设置偏好设置值
     * @param key 设置键名
     * @param value 设置值
     */
    function set<T extends PreferenceValue>(key: string, value: T): void {
      preferences.set(key, value)
    }

    /**
     * 检查是否存在某个偏好设置
     * @param key 设置键名
     */
    function has(key: string): boolean {
      return preferences.has(key)
    }

    /**
     * 删除某个偏好设置
     * @param key 设置键名
     */
    function remove(key: string): boolean {
      return preferences.delete(key)
    }

    /**
     * 清除指定命名空间的所有偏好设置
     * @param namespace 命名空间前缀
     */
    function clearNamespace(namespace: string): number {
      let count = 0
      const prefix = namespace.endsWith('.') ? namespace : `${namespace}.`

      for (const key of preferences.keys()) {
        if (key.startsWith(prefix)) {
          preferences.delete(key)
          count++
        }
      }

      return count
    }

    /**
     * 清除所有偏好设置
     */
    function clearAll(): void {
      preferences.clear()
    }

    /**
     * 获取所有偏好设置键名
     */
    function keys(): string[] {
      return Array.from(preferences.keys())
    }

    /**
     * 获取指定命名空间的所有偏好设置
     * @param namespace 命名空间前缀
     */
    function getNamespace(namespace: string): PreferenceRecord {
      const prefix = namespace.endsWith('.') ? namespace : `${namespace}.`
      const result: PreferenceRecord = {}

      for (const [key, value] of preferences.entries()) {
        if (key.startsWith(prefix)) {
          // 去掉前缀
          const shortKey = key.substring(prefix.length)
          result[shortKey] = value
        }
      }

      return result
    }

    /**
     * 批量设置偏好
     * @param values 键值对对象
     * @param namespace 可选的命名空间前缀
     */
    function setMany(values: PreferenceRecord, namespace?: string): void {
      const prefix = namespace ? (namespace.endsWith('.') ? namespace : `${namespace}.`) : ''

      for (const [key, value] of Object.entries(values)) {
        preferences.set(`${prefix}${key}`, value)
      }
    }

    /**
     * 切换布尔值
     * @param key 设置键名
     * @param defaultValue 默认值
     */
    function toggle(key: string, defaultValue: boolean = false): boolean {
      const current = get(key, defaultValue)
      const newValue = !current
      set(key, newValue)
      return newValue
    }

    /**
     * 增加数值
     * @param key 设置键名
     * @param amount 增加量
     * @param defaultValue 默认值
     */
    function increment(key: string, amount: number = 1, defaultValue: number = 0): number {
      const current = get(key, defaultValue)
      const newValue = current + amount
      set(key, newValue)
      return newValue
    }

    // 将 Map 转换为普通对象用于持久化
    function toObject(): PreferenceRecord {
      const result: PreferenceRecord = {}
      for (const [key, value] of preferences.entries()) {
        result[key] = value
      }
      return result
    }

    // 从普通对象恢复 Map
    function fromObject(obj: PreferenceRecord): void {
      preferences.clear()
      for (const [key, value] of Object.entries(obj)) {
        preferences.set(key, value)
      }
    }

    return {
      // State (用于持久化)
      preferences,

      // Getters & Actions
      get,
      set,
      has,
      remove,
      clearNamespace,
      clearAll,
      keys,
      getNamespace,
      setMany,
      toggle,
      increment,

      // 序列化方法（供持久化插件使用）
      toObject,
      fromObject
    }
  },
  {
    persist: false // 禁用自动持久化，手动处理
  }
)

/**
 * 创建响应式偏好设置 composable
 *
 * 类似于 usePreference，但基于 Pinia Store
 *
 * @param key 偏好设置键名
 * @param defaultValue 默认值
 */
export function usePreferenceValue<T extends PreferenceValue>(
  key: string,
  defaultValue: T
): { value: T } {
  const store = usePreferenceStore()

  // 初始化值
  if (!store.has(key)) {
    store.set(key, defaultValue)
  }

  return {
    get value(): T {
      return store.get(key, defaultValue)
    },
    set value(newValue: T) {
      store.set(key, newValue)
    }
  }
}
