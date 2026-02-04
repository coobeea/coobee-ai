# Electron Vite 配置指南

## 📋 配置概览

本文档说明 `electron.vite.config.ts` 中的关键配置及其作用。

---

## 🎯 主要改进点

### 1. **Main 进程配置**

```typescript
main: {
  plugins: [
    externalizeDepsPlugin({
      exclude: [] // 排除不需要外部化的依赖
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

**关键点：**
- ✅ **externalizeDepsPlugin**: 自动外部化 node_modules 依赖，减小打包体积
- ✅ **alias**: 路径别名，使用 `@` 和 `@shared` 简化导入
- ✅ **external**: 将原生模块标记为外部依赖（SQLite, fs-ext）
- ✅ **inlineDynamicImports**: 内联动态导入，避免运行时加载问题

---

### 2. **Preload 进程配置**

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

**关键点：**
- ✅ **externalizeDepsPlugin**: 外部化依赖
- ✅ **@shared 别名**: 共享代码的别名

---

### 3. **Renderer 进程配置**

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

**关键点：**
- ✅ **optimizeDeps**: 预优化大型依赖，提升开发启动速度
- ✅ **多个别名**: `@`, `@renderer`, `@shared` 方便导入
- ✅ **vue esm-bundler**: 使用 ESM 版本的 Vue
- ✅ **server.host**: 设置为 `0.0.0.0` 防止网络问题
- ✅ **Monaco Editor**: 完整配置语言支持和输出路径
- ✅ **isCustomElement**: 自定义元素识别
- ✅ **worker.format**: Web Worker 使用 ES 模块格式
- ✅ **cssCodeSplit**: 禁用 CSS 代码分割，保持样式顺序

---

## 📁 推荐的项目结构

根据配置，推荐创建以下目录结构：

```
src/
├── main/                  # 主进程代码
│   ├── index.ts
│   └── ...
├── preload/               # Preload 脚本
│   ├── index.ts
│   └── ...
├── renderer/              # 渲染进程代码
│   ├── index.html
│   └── src/
│       ├── main.ts
│       ├── App.vue
│       └── ...
└── shared/                # 共享代码（主进程和渲染进程都可用）
    ├── types.ts
    ├── constants.ts
    └── ...
```

---

## 🔧 使用别名导入

### Main 进程

```typescript
// src/main/index.ts
import { someUtil } from '@/utils/helper'        // @ = src/main/
import { SharedType } from '@shared/types'       // @shared = src/shared
```

### Renderer 进程

```typescript
// src/renderer/src/App.vue
import { MyComponent } from '@/components/MyComponent.vue'  // @ = src/renderer/src
import { SharedConst } from '@shared/constants'             // @shared = src/shared
```

### TypeScript 配置

需要在 `tsconfig.json` 中同步配置路径别名：

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/main/*"],
      "@renderer/*": ["./src/renderer/src/*"],
      "@shared/*": ["./src/shared/*"]
    }
  }
}
```

---

## 🎨 Monaco Editor 配置说明

```typescript
monacoEditorPlugin({
  languageWorkers: [
    'editorWorkerService',  // 核心服务
    'typescript',           // TypeScript 支持
    'javascript',           // JavaScript 支持
    'css',                  // CSS 支持
    'html',                 // HTML 支持
    'json'                  // JSON 支持
  ],
  customDistPath(_root, buildOutDir, _base) {
    return path.resolve(buildOutDir, 'monacoeditorwork')
  }
})
```

**说明：**
- `languageWorkers`: 指定需要的语言支持
- `customDistPath`: 自定义 Worker 文件输出路径

---

## 🚀 性能优化配置

### 1. 依赖预优化

```typescript
optimizeDeps: {
  include: [
    'monaco-editor',  // 大型编辑器库
    'axios',          // 网络请求库
    'dayjs',          // 日期库
    'lodash'          // 工具库
  ]
}
```

**作用：** 预构建这些依赖，提升开发时的加载速度。

### 2. 外部化原生模块

```typescript
build: {
  rollupOptions: {
    external: [
      'better-sqlite3-multiple-ciphers',
      'fs-ext'
    ]
  }
}
```

**作用：** 原生模块不参与打包，直接使用预编译版本。

### 3. 禁用 CSS 代码分割

```typescript
build: {
  cssCodeSplit: false
}
```

**作用：** 确保 CSS 加载顺序与导入顺序一致，避免样式覆盖问题。

---

## 🔍 开发服务器配置

```typescript
server: {
  host: '0.0.0.0'  // 监听所有网络接口
}
```

**作用：**
- 防止某些代理或网络配置干扰
- 确保 Vite 开发服务器和 Electron 之间的通信正常
- 解决 `ws://localhost:5713` 连接失败问题

---

## 🎯 多窗口配置（可选）

如果应用有多个窗口，可以配置多个入口：

```typescript
renderer: {
  build: {
    rollupOptions: {
      input: {
        index: resolve('src/renderer/index.html'),
        settings: resolve('src/renderer/settings/index.html'),
        splash: resolve('src/renderer/splash/index.html')
      }
    }
  }
}
```

**对应的目录结构：**

```
src/renderer/
├── index.html              # 主窗口
├── settings/
│   └── index.html          # 设置窗口
└── splash/
    └── index.html          # 启动画面
```

---

## 📝 自定义元素配置

```typescript
vue({
  template: {
    compilerOptions: {
      isCustomElement: (tag) => tag.startsWith('custom-')
    }
  }
})
```

**作用：** 告诉 Vue 编译器哪些标签是自定义元素，不要当作 Vue 组件处理。

**示例：**
```html
<!-- 这些标签不会被视为 Vue 组件 -->
<custom-widget></custom-widget>
<custom-element></custom-element>
```

---

## 🔧 Web Worker 配置

```typescript
worker: {
  format: 'es'
}
```

**作用：** 使用 ES 模块格式的 Web Worker，支持现代的 `import/export` 语法。

---

## 🎨 完整的依赖优化建议

根据项目已安装的依赖，建议优化的列表：

```typescript
optimizeDeps: {
  include: [
    // 编辑器
    'monaco-editor',
    
    // 网络请求
    'axios',
    
    // 工具库
    'dayjs',
    'lodash',
    'nanoid',
    
    // Vue 生态
    'pinia',
    'vue-router',
    '@vueuse/core',
    
    // 图标
    '@iconify/vue',
    
    // UI 组件
    'vue-sonner',
    
    // Tiptap 编辑器
    '@tiptap/core',
    '@tiptap/vue-3',
    '@tiptap/starter-kit'
  ]
}
```

---

## 📚 参考资源

- [Electron Vite 官方文档](https://electron-vite.org/)
- [Vite 配置参考](https://vitejs.dev/config/)
- [Rollup 配置选项](https://rollupjs.org/configuration-options/)

---

## 🚨 常见问题

### 1. 原生模块打包失败

**问题：** `better-sqlite3-multiple-ciphers` 或 `fs-ext` 打包失败

**解决：** 在 `main.build.rollupOptions.external` 中添加这些模块

### 2. Monaco Editor 加载失败

**问题：** 编辑器无法加载或 Worker 报错

**解决：** 检查 `monacoEditorPlugin` 配置，确保 `languageWorkers` 和 `customDistPath` 正确

### 3. 样式顺序错乱

**问题：** 构建后样式覆盖顺序与开发时不一致

**解决：** 设置 `cssCodeSplit: false`

### 4. 路径别名不生效

**问题：** TypeScript 无法识别路径别名

**解决：** 同步更新 `tsconfig.json` 中的 `paths` 配置

---

**文档生成时间**: 2026-02-04  
**状态**: ✅ Electron Vite 配置已优化
