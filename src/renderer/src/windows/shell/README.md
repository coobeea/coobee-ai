# Shell 窗口

**Shell 窗口** 是 Coobee AI 的主要 AI 对话窗口，负责与用户进行智能对话交互。

## 📂 目录结构

```
src/renderer/src/windows/shell/
├── main.ts              # Shell 窗口入口
├── ShellApp.vue         # Shell 根组件
├── types.ts             # Shell 类型定义
├── components/          # Shell 专用组件（待添加）
│   ├── ChatInput.vue
│   ├── MessageList.vue
│   ├── MessageItem.vue
│   └── Sidebar.vue
└── composables/         # Shell 专用逻辑（待添加）
    ├── useChat.ts
    ├── useConversation.ts
    └── useMessageStream.ts
```

## 🎯 功能特性

### 已实现

- ✅ 基础聊天界面
- ✅ 消息发送和显示
- ✅ 响应式布局
- ✅ 美观的 UI 设计

### 待实现

- [ ] 侧边栏（对话历史）
- [ ] AI 对话集成
- [ ] 消息流式输出
- [ ] Markdown 渲染
- [ ] 代码高亮
- [ ] 文件上传
- [ ] 图片预览
- [ ] 语音输入

## 🔌 使用方式

### 在主进程中创建窗口

```typescript
import { windowManager } from '@main/common/window'

// 创建 Shell 窗口
const shellWindow = windowManager.createWindow({
  type: 'agent',
  url: '/shell.html' // 加载 shell.html
})
```

### 组件开发

```vue
<!-- components/ChatInput.vue -->
<script setup lang="ts">
import type { Message } from '../types'

defineProps<{
  modelValue: string
}>()

defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'send', content: string): void
}>()
</script>

<template>
  <div class="chat-input">
    <!-- 输入框内容 -->
  </div>
</template>
```

### Composable 开发

```typescript
// composables/useChat.ts
import { ref } from 'vue'
import type { Message, Conversation } from '../types'

export function useChat() {
  const messages = ref<Message[]>([])
  const currentConversation = ref<Conversation | null>(null)

  function sendMessage(content: string) {
    // 发送消息逻辑
  }

  function loadConversation(id: string) {
    // 加载对话逻辑
  }

  return {
    messages,
    currentConversation,
    sendMessage,
    loadConversation
  }
}
```

## 🎨 设计规范

- **布局**：Header + Content + Footer 三段式
- **颜色**：遵循 Tailwind 调色板
- **字体**：系统默认字体栈
- **图标**：使用 `unplugin-icons`

## 📦 依赖

### 核心依赖

- `vue` - Vue 3 框架
- `pinia` - 状态管理

### 共享依赖

- `@shared/stores` - 跨窗口共享状态
- `@shared/utils` - 工具函数
- `@shared/types` - 共享类型

## 🔧 开发建议

1. **保持单一职责**：每个组件只做一件事
2. **类型优先**：定义清晰的 TypeScript 类型
3. **逻辑复用**：将复杂逻辑抽取到 composables
4. **性能优化**：使用 `v-memo`、`computed` 缓存计算结果
