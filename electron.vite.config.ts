import { resolve } from 'path';
import { defineConfig } from 'electron-vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import monacoEditorPlugin from 'vite-plugin-monaco-editor-esm';
import path from 'node:path';
import Icons from 'unplugin-icons/vite';
import IconsResolver from 'unplugin-icons/resolver';
import Components from 'unplugin-vue-components/vite';
import fs from 'fs';
import type { Plugin } from 'vite';
import dotenv from 'dotenv';

// 手动加载 .env 文件到 process.env
dotenv.config({ quiet: true });

// 复制 WASM 等静态资源到构建输出目录
function copyWasmAssetsPlugin(): Plugin {
  return {
    name: 'copy-wasm-assets',
    writeBundle() {
      const outDir = path.resolve(__dirname, 'out/main');
      const wasmFiles = [
        // @silvia-odwyer/photon-node（pi-coding-agent 的图片处理依赖）
        {
          src: path.resolve(__dirname, 'node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm'),
          dest: path.resolve(outDir, 'photon_rs_bg.wasm')
        }
      ];

      for (const { src, dest } of wasmFiles) {
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
          console.log(`[copy-wasm] Copied ${path.basename(src)} to output directory`);
        } else {
          console.warn(`[copy-wasm] WASM file not found: ${src}`);
        }
      }
    }
  };
}

// 复制 libs 目录下所有模块的插件
function copyLibsPlugin(): Plugin {
  return {
    name: 'copy-libs',
    writeBundle() {
      const sourceDir = path.resolve(__dirname, 'libs');
      const targetDir = path.resolve(__dirname, 'out/main/libs');

      // 确保源目录存在
      if (!fs.existsSync(sourceDir)) {
        console.warn('[copy-libs] Source libs directory does not exist, skipping...');
        return;
      }

      // 确保目标目录存在
      fs.mkdirSync(targetDir, { recursive: true });

      // 复制整个 libs 目录
      fs.cpSync(sourceDir, targetDir, { recursive: true });

      // 列出复制的模块
      const modules = fs.readdirSync(sourceDir).filter((item) => {
        return fs.statSync(path.join(sourceDir, item)).isDirectory();
      });

      console.log(`[copy-libs] Copied ${modules.length} modules from libs/ to output directory:`);
      modules.forEach((module) => console.log(`  - ${module}`));
    }
  };
}

export default defineConfig({
  main: {
    plugins: [copyLibsPlugin(), copyWasmAssetsPlugin()],
    resolve: {
      alias: {
        '@': resolve('src/main/'),
        '@main': resolve('src/main/'),
        '@shared': resolve('src/shared')
      }
    },
    define: {
      // 传递所有以 VITE_ 开头的环境变量
      ...Object.keys(process.env).reduce(
        (acc, key) => {
          if (key.startsWith('VITE_')) {
            acc[`process.env.${key}`] = JSON.stringify(process.env[key]);
          }
          return acc;
        },
        {} as Record<string, string>
      )
    },
    build: {
      // ESM-only 的包从自动外部化中排除，强制打包进 bundle
      externalizeDeps: {
        exclude: ['@mariozechner/pi-coding-agent', '@mariozechner/pi-ai', 'ws']
      },
      rollupOptions: {
        // 原生模块标记为外部依赖
        external: ['better-sqlite3-multiple-ciphers', 'fs-ext', 'electron', 'bufferutil', 'utf-8-validate'],
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
        '@types': resolve('src/renderer/types'),
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
          return path.resolve(buildOutDir, 'monacoeditorwork');
        }
      }),
      // 自动导入 Vue 组件
      Components({
        // 指定 components.d.ts 文件的生成位置
        dts: resolve('src/renderer/src/types/components.d.ts'),
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
});
