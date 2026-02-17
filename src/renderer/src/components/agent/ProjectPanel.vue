<script setup lang="ts">
/**
 * ProjectPanel — 项目空间（左栏）
 *
 * 用户选择本地目录作为 Agent 的上下文源。
 * Agent 可以读取目录下的文件作为工作参考。
 *
 * V1：目录选择 + 占位 UI
 * TODO：文件树加载、文件预览、搜索
 */

const projectPath = defineModel<string | null>('projectPath', { default: null });
const isCollapsed = defineModel<boolean>('collapsed', { default: false });

async function selectDirectory(): Promise<void> {
  try {
    const result = await window.electron?.ipcRenderer.invoke('shell:open-directory');
    if (result) {
      projectPath.value = result;
    }
  } catch (err) {
    console.warn('[ProjectPanel] 选择目录失败:', err);
  }
}

defineExpose({ selectDirectory });
</script>

<template>
  <aside v-show="!isCollapsed" class="flex h-full w-64 shrink-0 flex-col border-r border-gray-200/80 bg-gray-50/50">
    <!-- 面板标题 -->
    <div class="flex h-10 shrink-0 items-center justify-between border-b border-gray-200/60 px-3">
      <div class="flex items-center gap-1.5">
        <span class="i-carbon-folder-shared inline-block h-3.5 w-3.5 text-gray-500"></span>
        <span class="text-xs font-semibold text-gray-600">项目空间</span>
      </div>
      <button
        class="flex h-5 w-5 items-center justify-center rounded text-gray-400 transition hover:bg-gray-200 hover:text-gray-600"
        title="折叠"
        @click="isCollapsed = true">
        <span class="i-carbon-chevron-left inline-block h-3 w-3"></span>
      </button>
    </div>

    <!-- 内容区域 -->
    <div class="flex-1 overflow-y-auto p-3">
      <!-- 未选择目录 -->
      <div v-if="!projectPath" class="flex flex-col items-center pt-12">
        <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100">
          <span class="i-carbon-folder-add inline-block h-6 w-6 text-gray-400"></span>
        </div>
        <p class="mb-1 text-xs font-medium text-gray-500">选择项目目录</p>
        <p class="mb-4 text-center text-[11px] leading-relaxed text-gray-400">
          Agent 将以此目录下的文件<br />作为工作上下文
        </p>
        <button
          class="flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/20"
          @click="selectDirectory">
          <span class="i-carbon-folder-add inline-block h-3.5 w-3.5"></span>
          选择目录
        </button>
      </div>

      <!-- 已选择目录 -->
      <div v-else>
        <!-- 当前目录路径 -->
        <div class="mb-3 rounded-lg bg-white p-2 shadow-sm">
          <div class="mb-1 flex items-center justify-between">
            <span class="text-[10px] font-semibold tracking-wide text-gray-400">当前目录</span>
            <button class="text-[10px] text-gray-400 transition hover:text-primary" @click="selectDirectory">
              切换
            </button>
          </div>
          <p class="truncate font-mono text-[11px] text-gray-600" :title="projectPath">
            {{ projectPath }}
          </p>
        </div>

        <!-- 文件树占位 -->
        <div class="space-y-1.5">
          <div class="flex items-center gap-2 rounded px-2 py-1.5 text-[11px] text-gray-400">
            <span class="i-carbon-tree-view inline-block h-3.5 w-3.5"></span>
            <span>文件树加载中...</span>
          </div>
          <p class="px-2 text-[10px] leading-relaxed text-gray-300">
            后续版本将支持浏览文件树、预览文件内容、搜索等功能。
          </p>
        </div>
      </div>
    </div>
  </aside>
</template>
