/**
 * 处理状态存储
 */
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)

export default pinia

// 导出所有 Stores
export { usePreferenceStore, usePreferenceValue } from './preference'
export { useLoadingStore } from './loading'
export { useWindowStore } from './window'
export { useLogStore } from './log'
export { useChatStore } from './chat'
export { useAgentsStore } from './agents'
export { useWorkerStore } from './worker'
