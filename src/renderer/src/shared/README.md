# Shared 共享模块

**Shared** 目录存放跨窗口共享的代码，包括组件、状态、工具函数和类型定义。

## 📂 目录结构

```
src/renderer/src/shared/
├── components/          # 共享组件
│   ├── Button.vue
│   ├── Input.vue
│   └── Modal.vue
├── stores/              # Pinia 状态管理
│   └── app.ts
├── utils/               # 工具函数
│   ├── date.ts
│   ├── format.ts
│   └── storage.ts
└── types/               # 共享类型
    ├── common.ts
    └── api.ts
```

## 🎯 使用场景

### 1. 共享组件

适用于多个窗口都需要使用的通用组件：

```vue
<!-- shared/components/Button.vue -->
<script setup lang="ts">
defineProps<{
  type?: 'primary' | 'secondary' | 'danger'
  size?: 'small' | 'medium' | 'large'
}>()
</script>

<template>
  <button :class="buttonClass">
    <slot />
  </button>
</template>
```

在窗口中使用：

```vue
<script setup lang="ts">
import Button from '@/shared/components/Button.vue'
</script>

<template>
  <Button type="primary">点击</Button>
</template>
```

### 2. 共享状态（Pinia Store）

适用于需要跨窗口共享的全局状态：

```typescript
// shared/stores/app.ts
import { defineStore } from 'pinia'

export const useAppStore = defineStore('app', () => {
  const theme = ref('auto')

  function setTheme(newTheme: string) {
    theme.value = newTheme
  }

  return { theme, setTheme }
})
```

在窗口中使用：

```vue
<script setup lang="ts">
import { useAppStore } from '@/shared/stores/app'

const appStore = useAppStore()
</script>
```

### 3. 工具函数

适用于通用的业务逻辑和数据处理：

```typescript
// shared/utils/date.ts
export function formatDate(date: Date): string {
  return date.toLocaleDateString('zh-CN')
}

export function isToday(date: Date): boolean {
  const today = new Date()
  return date.toDateString() === today.toDateString()
}
```

在窗口中使用：

```typescript
import { formatDate, isToday } from '@/shared/utils/date'

const formattedDate = formatDate(new Date())
```

### 4. 共享类型

适用于多个窗口都需要的类型定义：

```typescript
// shared/types/common.ts
export interface User {
  id: string
  name: string
  email: string
}

export type Theme = 'light' | 'dark' | 'auto'

export interface AppConfig {
  theme: Theme
  language: string
}
```

在窗口中使用：

```typescript
import type { User, Theme } from '@/shared/types/common'

const currentUser: User = {
  id: '1',
  name: 'Alice',
  email: 'alice@example.com'
}
```

## 🔧 开发规范

### 组件规范

- **命名**：使用 PascalCase
- **Props**：使用 TypeScript 定义类型
- **Emits**：使用 TypeScript 定义事件
- **样式**：使用 Tailwind CSS

### Store 规范

- **命名**：使用 `use[Name]Store` 格式
- **模式**：使用 Setup Store 模式（推荐）
- **状态**：使用 `ref` 和 `reactive`
- **方法**：返回 actions

### 工具函数规范

- **命名**：使用 camelCase
- **类型**：提供完整的类型注解
- **纯函数**：避免副作用
- **文档**：添加 JSDoc 注释

### 类型规范

- **命名**：接口用 PascalCase，类型别名同样
- **导出**：使用 `export interface` 或 `export type`
- **组织**：按功能模块分文件

## ⚠️ 注意事项

1. **避免过度共享**：只共享真正需要跨窗口使用的代码
2. **保持独立性**：不要引入窗口特定的依赖
3. **类型安全**：所有导出都应有明确的类型
4. **文档完善**：复杂逻辑添加清晰的注释
