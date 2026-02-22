<script setup lang="ts">
/**
 * BasicSettings - 基本配置组件
 */
</script>

<template>
  <div class="h-full overflow-y-auto p-6 lg:p-10">
    <div class="mx-auto max-w-3xl">
      <h2 class="text-xl font-bold mb-6">基本配置</h2>

      <section>
        <h3 class="text-sm font-semibold mb-4">常规设置</h3>
        <div class="rounded-lg border border-border bg-card p-6">
          <div class="flex flex-col divide-y divide-border text-sm">
            <!-- 开机启动 -->
            <div class="flex items-center justify-between py-4">
              <div>
                <p class="font-medium text-foreground">开机自启动</p>
                <p class="text-xs text-muted-foreground mt-1">登录系统时自动启动应用服务</p>
              </div>
              <div class="h-5 w-9 rounded-full bg-muted cursor-pointer flex items-center p-0.5 border border-border">
                <div class="h-4 w-4 rounded-full bg-background shadow-sm"></div>
              </div>
            </div>

            <!-- 语言 -->
            <div class="flex items-center justify-between py-4">
              <div>
                <p class="font-medium text-foreground">语言</p>
                <p class="text-xs text-muted-foreground mt-1">选择应用程序的界面显示语言</p>
              </div>
              <select
                class="rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring">
                <option>简体中文</option>
                <option>English</option>
              </select>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
