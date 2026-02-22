<script setup lang="ts">
/**
 * AboutView - 关于我们组件
 */
</script>

<template>
  <div class="h-full overflow-y-auto flex items-center justify-center p-10">
    <div class="rounded-2xl border border-border bg-card shadow-lg px-20 py-16 flex flex-col items-center">
      <!-- Logo 图标 -->
      <div class="relative mb-8">
        <div class="absolute inset-0 bg-primary/10 blur-2xl rounded-full"></div>
        <div
          class="relative flex h-28 w-28 items-center justify-center rounded-[2rem] bg-gradient-to-br from-primary/30 via-primary/20 to-primary/10 shadow-xl ring-1 ring-border">
          <span class="i-carbon-machine-learning-model h-14 w-14 text-primary"></span>
        </div>
      </div>

      <!-- 应用名称 -->
      <h2 class="text-3xl font-bold text-foreground mb-2 tracking-tight">Coobee AI</h2>
      <p class="text-sm text-muted-foreground mb-1">智能 Agent 工作站</p>
      <p class="text-xs text-muted-foreground font-mono bg-muted px-3 py-1 rounded-full">v1.0.0</p>

      <!-- 功能特点 -->
      <div class="mt-12 grid grid-cols-3 gap-8 w-full">
        <div class="flex flex-col items-center text-center">
          <div class="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600">
            <span class="i-carbon-chat-bot h-6 w-6"></span>
          </div>
          <p class="text-sm font-medium text-foreground">多模态交互</p>
          <p class="text-xs text-muted-foreground mt-1">语音、文字、图像</p>
        </div>

        <div class="flex flex-col items-center text-center">
          <div class="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600">
            <span class="i-carbon-network-3 h-6 w-6"></span>
          </div>
          <p class="text-sm font-medium text-foreground">可扩展架构</p>
          <p class="text-xs text-muted-foreground mt-1">Worker / Extension</p>
        </div>

        <div class="flex flex-col items-center text-center">
          <div class="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-green-500/10 text-green-600">
            <span class="i-carbon-security h-6 w-6"></span>
          </div>
          <p class="text-sm font-medium text-foreground">本地优先</p>
          <p class="text-xs text-muted-foreground mt-1">数据隐私保护</p>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="mt-12 flex gap-4">
        <button
          class="flex items-center gap-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 px-5 py-2.5 text-sm font-medium transition-colors shadow-sm">
          <span class="i-carbon-upgrade h-4 w-4"></span>
          检查更新
        </button>
        <button
          class="flex items-center gap-2 rounded-lg border border-border bg-background hover:bg-muted px-5 py-2.5 text-sm font-medium transition-colors">
          <span class="i-carbon-earth h-4 w-4"></span>
          官方网站
        </button>
      </div>

      <!-- 版权信息 -->
      <div class="mt-16 pt-8 border-t border-border w-full text-center">
        <p class="text-xs text-muted-foreground">
          &copy; {{ new Date().getFullYear() }} Coobee Team. All rights reserved.
        </p>
      </div>
    </div>
  </div>
</template>
