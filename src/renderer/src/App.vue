<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useWindowStore } from '@/stores/window'
// 方式 1：手动导入图标（推荐用于常用图标）
import IconMdiPalette from '~icons/mdi/palette'
import IconMdiHome from '~icons/mdi/home'
import IconMdiAccount from '~icons/mdi/account'
import IconMdiHeart from '~icons/mdi/heart'
import IconMdiCog from '~icons/mdi/cog'
import IconMdiStar from '~icons/mdi/star'
import IconMdiRocket from '~icons/mdi/rocket'
import IconMdiLightningBolt from '~icons/mdi/lightning-bolt'
import IconMdiCheckCircle from '~icons/mdi/check-circle'
import IconMdiInformation from '~icons/mdi/information'
import IconMdiBookOpenVariant from '~icons/mdi/book-open-variant'
import IconSvgSpinners3DotsFade from '~icons/svg-spinners/3-dots-fade'
import IconSvgSpinnersBarsRotateFade from '~icons/svg-spinners/bars-rotate-fade'
import IconSvgSpinnersRingResize from '~icons/svg-spinners/ring-resize'
import IconSvgSpinnersPulse from '~icons/svg-spinners/pulse'
import IconMdiWindowMaximize from '~icons/mdi/window-maximize'

import Versions from './components/Versions.vue'
import LogViewer from './components/LogViewer.vue'

// 使用 Window Store
const windowStore = useWindowStore()

// 计算窗口信息（用于模板）
const windowInfo = computed(() => {
  if (!windowStore.isReady) return null

  return {
    info: windowStore.windowInfo,
    windowId: windowStore.windowId,
    currentTabId: windowStore.currentTabId
  }
})

onMounted(async () => {
  // 初始化窗口信息
  await windowStore.refreshWindowInfo()
})
</script>

<template>
  <div class="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
    <div class="mx-auto max-w-4xl">
      <!-- Window Info Bar -->
      <div v-if="windowInfo" class="mb-4 rounded-lg bg-white p-4 shadow">
        <div class="flex items-center gap-3 text-sm">
          <IconMdiWindowMaximize class="text-indigo-600" />
          <span class="font-semibold text-gray-700">窗口信息:</span>
          <span class="text-gray-600">Window ID: {{ windowInfo.windowId }}</span>
          <span class="text-gray-400">|</span>
          <span class="text-gray-600">
            当前 Tab ID:
            <span class="font-semibold text-indigo-600">{{ windowInfo.currentTabId }}</span>
          </span>
        </div>
        <div class="flex items-center gap-3 text-sm">
          <span class="text-gray-600">窗口类型: {{ windowInfo.info?.windowType }}</span>
          <span class="text-gray-600">Tab 列表: {{ windowInfo.info?.tabs.length }}</span>
          <span class="text-gray-600">当前激活的 Tab ID: {{ windowInfo.info?.currentTabId }}</span>
          <span class="text-gray-600">调用者的 Tab ID: {{ windowInfo.info?.callerTabId }}</span>
        </div>
      </div>

      <!-- Header Section -->
      <div class="mb-8 text-center">
        <div class="mb-4 flex justify-center">
          <img alt="logo" class="h-24 w-24 animate-pulse" src="./assets/electron.svg" />
        </div>
        <h1 class="mb-2 text-4xl font-bold text-gray-800">
          Powered by <span class="text-blue-600">electron-vite</span>
        </h1>
        <p class="text-lg text-gray-600">
          Build an Electron app with
          <span class="font-semibold text-green-600">Vue</span>
          and
          <span class="font-semibold text-blue-600">TypeScript</span>
        </p>
      </div>

      <!-- Icon Test Section -->
      <div class="mb-8 rounded-lg bg-white p-6 shadow-lg">
        <h2 class="mb-4 flex items-center gap-2 text-2xl font-bold text-gray-800">
          <IconMdiPalette class="text-purple-600" />
          图标库测试 (unplugin-icons)
        </h2>

        <!-- MDI Icons -->
        <div class="mb-6">
          <h3 class="mb-3 text-lg font-semibold text-gray-700">Material Design Icons (MDI)</h3>
          <div class="flex flex-wrap gap-4">
            <div class="flex flex-col items-center gap-1">
              <IconMdiHome class="text-4xl text-blue-600" />
              <span class="text-xs text-gray-600">home</span>
            </div>
            <div class="flex flex-col items-center gap-1">
              <IconMdiAccount class="text-4xl text-green-600" />
              <span class="text-xs text-gray-600">account</span>
            </div>
            <div class="flex flex-col items-center gap-1">
              <IconMdiHeart class="text-4xl text-red-600" />
              <span class="text-xs text-gray-600">heart</span>
            </div>
            <div class="flex flex-col items-center gap-1">
              <IconMdiCog class="text-4xl text-gray-600" />
              <span class="text-xs text-gray-600">cog</span>
            </div>
            <div class="flex flex-col items-center gap-1">
              <IconMdiStar class="text-4xl text-yellow-600" />
              <span class="text-xs text-gray-600">star</span>
            </div>
          </div>
        </div>

        <!-- Spinner Icons -->
        <div>
          <h3 class="mb-3 text-lg font-semibold text-gray-700">SVG Spinners (动画图标)</h3>
          <div class="flex flex-wrap gap-4">
            <div class="flex flex-col items-center gap-1">
              <IconSvgSpinners3DotsFade class="text-4xl text-blue-600" />
              <span class="text-xs text-gray-600">dots-fade</span>
            </div>
            <div class="flex flex-col items-center gap-1">
              <IconSvgSpinnersBarsRotateFade class="text-4xl text-purple-600" />
              <span class="text-xs text-gray-600">bars-rotate</span>
            </div>
            <div class="flex flex-col items-center gap-1">
              <IconSvgSpinnersRingResize class="text-4xl text-green-600" />
              <span class="text-xs text-gray-600">ring-resize</span>
            </div>
            <div class="flex flex-col items-center gap-1">
              <IconSvgSpinnersPulse class="text-4xl text-red-600" />
              <span class="text-xs text-gray-600">pulse</span>
            </div>
          </div>
        </div>

        <!-- 自动导入测试 -->
        <div class="mt-6">
          <h3 class="mb-3 text-lg font-semibold text-gray-700">
            方式 2：自动导入组件（无需手动 import）
          </h3>
          <div class="flex flex-wrap gap-4">
            <div class="flex flex-col items-center gap-1">
              <icon-mdi-fire class="text-4xl text-red-600" />
              <span class="text-xs text-gray-600">fire (auto)</span>
            </div>
            <div class="flex flex-col items-center gap-1">
              <icon-mdi-weather-sunny class="text-4xl text-yellow-600" />
              <span class="text-xs text-gray-600">sunny (auto)</span>
            </div>
            <div class="flex flex-col items-center gap-1">
              <icon-mdi-thumb-up class="text-4xl text-blue-600" />
              <span class="text-xs text-gray-600">thumb-up (auto)</span>
            </div>
          </div>
        </div>

        <!-- Tailwind CSS 方式 -->
        <div class="mt-6 border-t pt-6">
          <h3 class="mb-3 text-lg font-semibold text-gray-700">
            方式 3：Tailwind CSS 类（@egoist/tailwindcss-icons）
          </h3>

          <!-- 动态选择器 -->
          <div class="mb-4">
            <p class="mb-2 text-sm text-gray-600">
              CSS 类方式（最灵活，支持动态拼接，格式：i-{图标集}-{图标名}）
            </p>
            <div class="flex flex-wrap gap-4">
              <div class="flex flex-col items-center gap-1">
                <span class="i-mdi-home text-4xl text-blue-600"></span>
                <span class="text-xs text-gray-600">home</span>
              </div>
              <div class="flex flex-col items-center gap-1">
                <span class="i-mdi-heart text-4xl text-red-600"></span>
                <span class="text-xs text-gray-600">heart</span>
              </div>
              <div class="flex flex-col items-center gap-1">
                <span class="i-carbon-settings text-4xl text-gray-600"></span>
                <span class="text-xs text-gray-600">settings</span>
              </div>
              <div class="flex flex-col items-center gap-1">
                <span class="i-heroicons-star-solid text-4xl text-yellow-600"></span>
                <span class="text-xs text-gray-600">star</span>
              </div>
              <div class="flex flex-col items-center gap-1">
                <span class="i-mdi-fire text-4xl text-orange-600"></span>
                <span class="text-xs text-gray-600">fire</span>
              </div>
              <div class="flex flex-col items-center gap-1">
                <span class="i-mdi-weather-cloudy text-4xl text-gray-500"></span>
                <span class="text-xs text-gray-600">cloudy</span>
              </div>
              <div class="flex flex-col items-center gap-1">
                <span class="i-carbon-cloud text-4xl text-blue-400"></span>
                <span class="text-xs text-gray-600">cloud</span>
              </div>
              <div class="flex flex-col items-center gap-1">
                <span class="i-svg-spinners-pulse text-4xl text-green-600"></span>
                <span class="text-xs text-gray-600">pulse</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Tailwind CSS Test Section -->
      <div class="mb-8 rounded-lg bg-white p-6 shadow-lg">
        <h2 class="mb-4 text-2xl font-bold text-gray-800">Tailwind CSS 样式测试</h2>

        <!-- Buttons -->
        <div class="mb-4 flex flex-wrap gap-3">
          <button
            class="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white transition hover:bg-blue-700 active:scale-95"
          >
            Primary Button
          </button>
          <button
            class="rounded-lg bg-green-600 px-4 py-2 font-semibold text-white transition hover:bg-green-700 active:scale-95"
          >
            Success Button
          </button>
          <button
            class="rounded-lg border-2 border-gray-300 px-4 py-2 font-semibold text-gray-700 transition hover:border-gray-400 hover:bg-gray-50 active:scale-95"
          >
            Outline Button
          </button>
        </div>

        <!-- Alert Box -->
        <div class="mb-4 rounded-lg border-l-4 border-blue-500 bg-blue-50 p-4">
          <div class="flex items-center gap-2">
            <IconMdiInformation class="text-2xl text-blue-600" />
            <p class="text-blue-800">
              <strong>提示：</strong>按 <code class="rounded bg-blue-200 px-2 py-1">F12</code>
              打开开发者工具
            </p>
          </div>
        </div>

        <!-- Grid Layout -->
        <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div class="rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 p-4 text-white">
            <IconMdiRocket class="mb-2 text-3xl" />
            <h3 class="font-bold">快速开发</h3>
            <p class="text-sm">使用 Vite 和 HMR</p>
          </div>
          <div class="rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 p-4 text-white">
            <IconMdiLightningBolt class="mb-2 text-3xl" />
            <h3 class="font-bold">高性能</h3>
            <p class="text-sm">优化的打包配置</p>
          </div>
          <div class="rounded-lg bg-gradient-to-r from-green-500 to-teal-500 p-4 text-white">
            <IconMdiCheckCircle class="mb-2 text-3xl" />
            <h3 class="font-bold">类型安全</h3>
            <p class="text-sm">TypeScript 支持</p>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="mb-8 flex flex-wrap justify-center gap-4">
        <a
          href="https://electron-vite.org/"
          target="_blank"
          rel="noreferrer"
          class="flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 font-semibold text-white transition hover:bg-indigo-700"
        >
          <IconMdiBookOpenVariant class="text-xl" />
          查看文档
        </a>
      </div>

      <!-- Versions Component -->
      <div class="rounded-lg bg-white p-6 shadow-lg">
        <Versions />
      </div>
    </div>

    <!-- 日志查看器 -->
    <LogViewer />
  </div>
</template>
