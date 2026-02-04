import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import monacoEditorPlugin from 'vite-plugin-monaco-editor-esm'
import path from 'node:path'
import Icons from 'unplugin-icons/vite'
import IconsResolver from 'unplugin-icons/resolver'
import Components from 'unplugin-vue-components/vite'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@': resolve('src/main/'),
        '@main': resolve('src/main/'),
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        // 将原生模块标记为外部依赖
        external: ['better-sqlite3-multiple-ciphers', 'fs-ext', 'electron'],
        output: {
          inlineDynamicImports: true,
          manualChunks: undefined // 禁用自动代码分割
        }
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@main': resolve('src/main/'),
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    optimizeDeps: {
      include: ['monaco-editor', 'axios', 'dayjs', 'lodash']
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
      host: '0.0.0.0' // 防止代理干扰，确保 Vite 和 Electron 之间通信正常
    },
    plugins: [
      tailwindcss(),
      monacoEditorPlugin({
        languageWorkers: ['editorWorkerService', 'typescript', 'css', 'html', 'json'],
        customDistPath(_root, buildOutDir) {
          return path.resolve(buildOutDir, 'monacoeditorwork')
        }
      }),
      // 自动导入 Vue 组件
      Components({
        resolvers: [
          // 自动导入图标组件
          IconsResolver({
            prefix: 'icon' // 组件前缀，如 <icon-mdi-home />
          })
        ]
      }),
      // 图标插件
      Icons({
        compiler: 'vue3',
        autoInstall: true // 自动安装需要的图标集
      }),
      vue({
        template: {
          compilerOptions: {
            // 自定义元素配置（如果需要）
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
      // 确保构建时 CSS 顺序与开发时一致
      cssCodeSplit: false,
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          shell: resolve('src/renderer/shell.html'),
          browser: resolve('src/renderer/browser.html')
        }
      }
    }
  }
})
