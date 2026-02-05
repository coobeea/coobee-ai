# 类型定义目录

此目录存放渲染进程相关的类型定义文件。

## 📁 文件说明

### `components.d.ts`

- **自动生成**：由 `unplugin-vue-components` 插件自动生成
- **作用**：为自动导入的 Vue 组件提供 TypeScript 类型声明
- **不要手动编辑**：此文件会在开发时自动更新

**包含的组件类型**：

- Vue 组件（自动扫描 `src/components/` 目录）
- 图标组件（通过 `unplugin-icons` 自动导入）
- Vue Router 组件（`RouterLink`、`RouterView`）

## ⚙️ 配置

在 `electron.vite.config.ts` 中配置：

```typescript
Components({
  dts: resolve('src/renderer/src/types/components.d.ts'),
  resolvers: [
    IconsResolver({
      prefix: 'icon'
    })
  ]
})
```

## 📝 添加自定义类型

如果需要添加自定义的渲染进程类型，可以在此目录创建新的 `.d.ts` 文件：

```typescript
// types/custom.d.ts
declare module '*.svg' {
  const content: string
  export default content
}

// 全局类型定义
declare global {
  interface Window {
    customApi: {
      // ...
    }
  }
}
```

## 🔍 使用

类型文件会被 TypeScript 自动识别，无需手动导入：

```vue
<template>
  <!-- 自动识别组件类型 -->
  <icon-mdi-home />
  <Versions />
</template>

<script setup lang="ts">
// 无需导入，TypeScript 自动识别类型
</script>
```
