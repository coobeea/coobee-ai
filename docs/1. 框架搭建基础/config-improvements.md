# Electron Vite 配置改进总结

## 📋 改进概览

基于 CataxBot 项目的最佳实践，对 Coobee AI 的 Electron Vite 配置进行了全面优化。

---

## ✅ 主要改进

### 1. **Main 进程配置优化**

#### 添加的配置

```typescript
main: {
  plugins: [
    externalizeDepsPlugin({
      exclude: []
    })
  ],
  resolve: {
    alias: {
      '@': resolve('src/main/'),
      '@shared': resolve('src/shared')
    }
  },
  build: {
    rollupOptions: {
      external: ['better-sqlite3-multiple-ciphers', 'fs-ext'],
      output: {
        inlineDynamicImports: true,
        manualChunks: undefined
      }
    }
  }
}
```

#### 改进点

- ✅ **自动外部化依赖**: 减小打包体积
- ✅ **路径别名**: `@` 和 `@shared` 简化导入
- ✅ **原生模块处理**: SQLite 和 fs-ext 作为外部依赖
- ✅ **优化动态导入**: 内联处理避免运行时问题

---

### 2. **Preload 进程配置优化**

#### 添加的配置

```typescript
preload: {
  plugins: [externalizeDepsPlugin()],
  resolve: {
    alias: {
      '@shared': resolve('src/shared')
    }
  }
}
```

#### 改进点

- ✅ **外部化依赖**: 优化打包
- ✅ **共享代码别名**: 访问共享类型和常量

---

### 3. **Renderer 进程配置优化**

#### 添加的配置

```typescript
renderer: {
  optimizeDeps: {
    include: [
      'monaco-editor',
      'axios',
      'dayjs',
      'lodash'
    ]
  },
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared'),
      vue: 'vue/dist/vue.esm-bundler.js'
    }
  },
  server: {
    host: '0.0.0.0'
  },
  plugins: [
    tailwindcss(),
    monacoEditorPlugin({
      languageWorkers: ['editorWorkerService', 'typescript', 'javascript', 'css', 'html', 'json'],
      customDistPath(_root, buildOutDir, _base) {
        return path.resolve(buildOutDir, 'monacoeditorwork')
      }
    }),
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag.startsWith('custom-')
        }
      }
    })
  ],
  worker: {
    format: 'es'
  },
  build: {
    minify: 'esbuild',
    cssCodeSplit: false
  }
}
```

#### 改进点

- ✅ **依赖预优化**: 提升开发启动速度
- ✅ **多路径别名**: 灵活的导入方式
- ✅ **Vue ESM 版本**: 更好的 Tree-shaking
- ✅ **网络配置**: 防止代理干扰
- ✅ **Monaco 完整配置**: 多语言支持
- ✅ **自定义元素**: Vue 编译器配置
- ✅ **Web Worker**: ES 模块支持
- ✅ **CSS 优化**: 保持样式顺序

---

## 📁 新增文件和目录

### 1. 共享代码目录

```
src/shared/
├── types.ts         # 共享类型定义
└── constants.ts     # 共享常量
```

#### types.ts

- User 类型
- AppSettings 类型
- WindowBounds 类型
- LogLevel 类型

#### constants.ts

- 应用基本信息
- 窗口默认值
- 主题常量
- IPC 通道名称

### 2. 配置文件

```
docs/
├── vite-config-guide.md       # Vite 配置详细指南
└── config-improvements.md     # 本文档
```

---

## 🔧 TypeScript 配置更新

### tsconfig.web.json

```json
{
  "include": [
    "src/shared/**/*" // ✅ 新增
  ],
  "compilerOptions": {
    "paths": {
      "@/*": ["src/renderer/src/*"], // ✅ 新增
      "@renderer/*": ["src/renderer/src/*"],
      "@shared/*": ["src/shared/*"] // ✅ 新增
    }
  }
}
```

### tsconfig.node.json

```json
{
  "include": [
    "src/shared/**/*" // ✅ 新增
  ],
  "compilerOptions": {
    "baseUrl": ".", // ✅ 新增
    "paths": {
      "@/*": ["src/main/*"], // ✅ 新增
      "@shared/*": ["src/shared/*"] // ✅ 新增
    }
  }
}
```

---

## 💡 使用示例

### 在 Main 进程中使用

```typescript
// src/main/index.ts
import { IPC_CHANNELS } from '@shared/constants'
import type { AppSettings } from '@shared/types'
import { someUtil } from '@/utils/helper'

ipcMain.handle(IPC_CHANNELS.STORE_GET, async (_, key) => {
  // ...
})
```

### 在 Renderer 进程中使用

```typescript
// src/renderer/src/App.vue
<script setup lang="ts">
import { IPC_CHANNELS } from '@shared/constants'
import type { AppSettings } from '@shared/types'
import { MyComponent } from '@/components/MyComponent.vue'

const settings: AppSettings = {
  theme: 'dark',
  language: 'zh-CN',
  fontSize: 14
}
</script>
```

### 在 Preload 脚本中使用

```typescript
// src/preload/index.ts
import { IPC_CHANNELS } from '@shared/constants'
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  store: {
    get: (key: string) => ipcRenderer.invoke(IPC_CHANNELS.STORE_GET, key),
    set: (key: string, value: any) => ipcRenderer.invoke(IPC_CHANNELS.STORE_SET, key, value)
  }
})
```

---

## 🎯 性能优化效果

### 开发环境

1. **启动速度提升**
   - 依赖预优化：Monaco Editor, Axios, Lodash 等
   - 减少首次加载时的依赖解析时间

2. **热更新优化**
   - 外部化大型依赖
   - 更快的模块替换速度

### 生产构建

1. **打包体积优化**
   - 原生模块外部化
   - Tree-shaking 优化
   - 代码分割禁用（避免样式问题）

2. **运行时性能**
   - 内联动态导入
   - ESM 格式优化

---

## 📚 相关文档

- [Vite 配置指南](./vite-config-guide.md) - 详细的配置说明
- [Electron 插件指南](./electron-plugins-guide.md) - Electron 插件使用
- [工具库指南](./utilities-guide.md) - 工具库使用说明

---

## 🚀 下一步建议

### 1. 扩展 Shared 目录

可以添加更多共享代码：

```
src/shared/
├── types/
│   ├── index.ts
│   ├── user.ts
│   ├── settings.ts
│   └── window.ts
├── constants/
│   ├── index.ts
│   ├── app.ts
│   └── ipc.ts
├── utils/
│   ├── validators.ts
│   └── formatters.ts
└── schemas/
    └── settings.ts  # Zod schemas
```

### 2. 添加更多依赖优化

根据实际使用情况，继续添加到 `optimizeDeps.include`：

```typescript
optimizeDeps: {
  include: [
    // 已有的...

    // 可以添加的
    '@tiptap/core',
    '@tiptap/vue-3',
    '@tiptap/starter-kit',
    '@vueuse/core',
    'pinia',
    'vue-router'
  ]
}
```

### 3. 多窗口支持

如果需要多个窗口（设置、关于等），可以扩展配置：

```typescript
renderer: {
  build: {
    rollupOptions: {
      input: {
        index: resolve('src/renderer/index.html'),
        settings: resolve('src/renderer/settings/index.html'),
        about: resolve('src/renderer/about/index.html')
      }
    }
  }
}
```

---

## ✅ 检查清单

- [x] Main 进程配置优化
- [x] Preload 进程配置优化
- [x] Renderer 进程配置优化
- [x] TypeScript 路径别名配置
- [x] 创建 shared 目录
- [x] 添加共享类型和常量
- [x] 创建配置文档
- [ ] 测试开发环境
- [ ] 测试生产构建
- [ ] 验证路径别名工作正常

---

**文档生成时间**: 2026-02-04  
**状态**: ✅ 配置优化完成  
**参考项目**: CataxBot
