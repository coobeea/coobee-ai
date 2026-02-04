# Coobee AI - 依赖库清单

本文档整理了 Joythink-AI 和 CataxBot 两个项目中的核心依赖库，用于 Coobee AI 项目参考。

## 📦 核心依赖分类

### 1. AI & Agent 框架

#### AI SDK
- **@anthropic-ai/sdk** `^0.53.0` - Anthropic Claude AI SDK
- **@google/genai** `^1.34.0` - Google Gemini AI SDK
- **@openai/agents** `^0.4.4` - OpenAI Agents 框架
- **openai** `^6.14.0` / `^6.17.0` - OpenAI 官方 SDK
- **ollama** `^0.5.16` / `^0.5.18` - 本地大模型运行框架
- **@aws-sdk/client-bedrock** `^3.958.0` - AWS Bedrock SDK
- **@aws-sdk/client-bedrock-runtime** `^3.958.0` - AWS Bedrock Runtime

#### Agent 协议
- **@agentclientprotocol/sdk** `^0.13.1` / `^0.5.1` - Agent Client Protocol
- **@modelcontextprotocol/sdk** `^1.17.1` / `^1.25.1` - Model Context Protocol
- **@mariozechner/pi-agent-core** `^0.49.3` - Pi Agent 核心库
- **@mariozechner/pi-ai** `^0.49.3` - Pi AI 库
- **@mariozechner/pi-coding-agent** `^0.49.3` - Pi Coding Agent

#### AI 工具集成
- **@e2b/code-interpreter** `^1.5.1` - E2B 代码解释器
- **together-ai** `^0.16.0` - Together AI SDK

---

### 2. 数据库

- **@libsql/client** `^0.15.15` - LibSQL 客户端
- **better-sqlite3** `^12.5.0` - SQLite3 数据库（Joythink-AI）
- **better-sqlite3-multiple-ciphers** `12.4.1` - 支持加密的 SQLite3（CataxBot）
- **@duckdb/node-api** `1.3.2-alpha.25` - DuckDB Node.js API

---

### 3. 编辑器组件

#### Rich Text Editor (Tiptap)
- **@tiptap/core** - Tiptap 核心库
- **@tiptap/vue-3** - Vue 3 集成
- **@tiptap/starter-kit** - 起始工具包
- **@tiptap/extension-code-block** - 代码块扩展
- **@tiptap/extension-hard-break** - 硬换行扩展
- **@tiptap/extension-history** - 历史记录
- **@tiptap/extension-image** - 图片支持
- **@tiptap/extension-mention** - @提及功能
- **@tiptap/extension-placeholder** - 占位符
- **@tiptap/extension-table** - 表格支持
- **@tiptap/extension-task-item** - 任务项
- **@tiptap/extension-task-list** - 任务列表
- **@tiptap/suggestion** - 建议功能

#### 代码编辑器
- **monaco-editor** `^0.54.0` / `^0.52.2` - VS Code 编辑器核心
- **vite-plugin-monaco-editor-esm** `^2.0.2` - Monaco Editor Vite 插件
- **stream-monaco** `^0.0.15` - Monaco 流式支持
- **codemirror** `^6.65.7` - CodeMirror 编辑器
- **@codemirror/lang-markdown** `^6.4.0` - Markdown 语言支持
- **@codemirror/theme-one-dark** `^6.1.3` - One Dark 主题

---

### 4. 文档解析与处理

#### PDF 处理
- **pdfjs-dist** `^5.4.149` - PDF.js 分发版（Joythink-AI）
- **pdf-parse-new** `^1.4.1` - PDF 解析库（CataxBot）

#### Office 文档
- **mammoth** `^1.11.0` - Word 文档转换
- **node-xlsx** `^0.24.0` - Excel 处理（Joythink-AI）
- **xlsx** `0.20.3` - SheetJS Excel 处理（CataxBot）
- **papaparse** `^5.5.3` - CSV 解析

#### Markdown & HTML
- **markdown-it** `^14.1.0` - Markdown 解析器
- **marked** `^16.4.0` - Markdown 解析器（另一个选择）
- **turndown** `^7.2.1` / `^7.2.2` - HTML 转 Markdown
- **cheerio** `^1.1.2` - 服务端 jQuery（HTML 解析）
- **@xmldom/xmldom** `^0.8.11` - XML DOM 解析
- **xml2js** `^0.6.2` - XML 转 JS 对象

#### OCR
- **@alicloud/docmind-api20220711** `^1.4.11` - 阿里云文档智能识别

---

### 5. 前端框架 & UI

#### Vue 生态
- **vue** `^3.5.17` / `^3.5.25` / `^3.5.26` - Vue 3 核心
- **vue-router** `^4.5.1` / `4` - 路由管理
- **pinia** `^3.0.2` / `^3.0.4` - 状态管理
- **pinia-plugin-persistedstate** `^4.3.0` - Pinia 持久化插件
- **@pinia/colada** `^0.20.0` - Pinia 数据获取库
- **vue-i18n** `^11.1.1` / `^11.2.7` - 国际化
- **@vueuse/core** `^12.8.2` - Vue 组合式工具集

#### UI 组件库
- **radix-vue** `^1.9.17` - Radix UI Vue 版本（Joythink-AI）
- **reka-ui** `^2.7.0` - Reka UI（CataxBot）
- **lucide-vue-next** `^0.544.0` - Lucide 图标库
- **@iconify/vue** `^5.0.0` - Iconify 图标

#### 拖拽 & 虚拟滚动
- **vue-draggable-plus** `^0.6.0` - 拖拽功能（Joythink-AI）
- **vuedraggable** `^4.1.0` - 拖拽功能（CataxBot）
- **vue-virtual-scroller** `^2.0.0-beta.8` - 虚拟滚动

#### Toast & 通知
- **vue-sonner** `^2.0.9` - Toast 通知组件

---

### 6. 样式 & 主题

- **tailwindcss** `^3.4.17` / `^4.1.18` - Tailwind CSS
- **@tailwindcss/typography** - Tailwind 排版插件
- **@tailwindcss/vite** `^4.1.18` - Tailwind Vite 插件
- **tailwindcss-animate** `^1.0.7` - Tailwind 动画
- **tw-animate-css** `^1.4.0` - Animate.css 集成
- **tailwind-merge** `^3.4.0` - 合并 Tailwind 类名
- **tailwind-scrollbar-hide** `^4.0.0` - 隐藏滚动条
- **class-variance-authority** `^0.7.1` - CVA 类名变体
- **clsx** `^2.1.1` - 条件类名工具
- **autoprefixer** - CSS 自动前缀
- **sass** `^1.87.0` - Sass 预处理器

---

### 7. 图表 & 可视化

- **echarts** `^6.0.0` - Apache ECharts 图表库
- **@antv/infographic** `^0.2.7` - AntV 信息图
- **mermaid** `^11.10.1` / `^11.12.2` - Mermaid 流程图

---

### 8. Electron 相关

#### 核心库
- **electron** `^37.10.3` / `^39.2.6` - Electron 主框架
- **electron-builder** - Electron 打包工具
- **electron-vite** `^4.0.0` / `^5.0.0` - Electron Vite 构建工具
- **@electron-toolkit/preload** `^3.0.2` - Preload 工具
- **@electron-toolkit/utils** `^4.0.0` - Electron 工具集

#### Electron 插件
- **electron-updater** `^6.3.9` / `^6.6.2` - 自动更新
- **electron-log** `^5.4.0` / `^5.4.3` - 日志系统
- **electron-store** `^8.2.0` - 持久化存储
- **electron-window-state** `^5.0.3` - 窗口状态管理
- **electron-devtools-installer** `^4.0.0` - DevTools 安装器
- **@electron/notarize** `^3.1.1` - macOS 公证

---

### 9. 终端 & Shell

- **node-pty** `^1.1.0` - 伪终端（PTY）
- **@xterm/xterm** `^5.5.0` - xterm.js 终端模拟器
- **@xterm/addon-fit** `^0.10.0` - xterm 适配插件
- **cross-spawn** `^7.0.6` - 跨平台进程创建

---

### 10. 网络请求

- **axios** `^1.9.0` / `^1.13.2` - HTTP 客户端
- **undici** `^7.16.0` - 高性能 HTTP 客户端
- **https-proxy-agent** `^7.0.6` - HTTPS 代理支持

---

### 11. 文本处理 & 工具

#### 分词 & Token
- **nodejieba** `^3.5.2` - 中文分词
- **tokenx** `^1.2.1` / `^0.4.1` - Token 计数

#### 数据处理
- **lodash** `^4.17.21` - 工具函数库
- **dayjs** `^1.11.13` / `^1.11.19` - 日期处理
- **diff** `^8.0.2` / `^8.0.3` - 文本差异对比
- **zod** `^3.25.67` / `^4.3.6` - Schema 验证
- **@sinclair/typebox** `^0.34.48` - TypeBox 类型系统
- **nanoid** `^5.1.6` - ID 生成器
- **gray-matter** `^4.0.3` - Front matter 解析
- **jsonrepair** `^3.13.1` - JSON 修复

#### 字符编码
- **iconv-lite** `^0.7.0` - 字符编码转换

#### 正则 & 验证
- **safe-regex2** `^5.0.0` - 安全正则表达式

---

### 12. 文件系统 & 压缩

- **fs-ext** `^2.1.1` - 文件系统扩展
- **mkdirp** `^3.0.1` - 递归创建目录
- **glob** `^13.0.0` - 文件匹配
- **minimatch** `^10.1.1` - 最小匹配
- **fflate** `^0.8.2` - 压缩/解压
- **chokidar** `^4.0.3` / `^5.0.0` - 文件监听

---

### 13. Git 相关

- **isomorphic-git** `^1.34.0` - 纯 JS Git 实现

---

### 14. 后端服务 (Koa)

- **koa** `^3.0.3` / `^3.1.1` - Koa 框架
- **@koa/router** `^13.1.0` / `^15.3.0` - Koa 路由
- **@koa/cors** `^5.0.0` - CORS 中间件
- **koa-bodyparser** `^4.4.1` - Body 解析器
- **koa-static** `^5.0.0` - 静态文件服务

---

### 15. 定时任务 & 并发控制

- **node-cron** `^4.2.1` - 定时任务
- **p-limit** `^7.1.1` - 并发限制
- **p-queue** `^8.1.0` - 队列管理
- **tinypool** `^1.1.1` - 轻量级线程池
- **rxjs** `^7.8.2` - 响应式编程

---

### 16. 事件 & 通信

- **events** `^3.3.0` - 事件模块
- **mitt** `^3.0.1` - 事件发射器

---

### 17. 其他工具

#### 表单验证
- **vee-validate** `^4.15.1` - Vue 表单验证
- **@vee-validate/zod** `^4.15.1` - Zod 集成

#### 日志
- **consola** `^3.4.2` - 优雅的控制台日志

#### DOM 处理
- **domino-ext** `^2.1.4` - DOM 实现
- **selection-hook** `^1.0.6` - 选择钩子

#### 缓存
- **lru-cache** `^11.1.0` - LRU 缓存

#### JWT
- **jsonwebtoken** `^9.0.2` - JWT 处理

#### Math 渲染
- **katex** `^0.16.27` - LaTeX 数学公式渲染

#### Markdown 渲染
- **markstream-vue** `0.0.5-beta.4` - 流式 Markdown 渲染

#### AppleScript (macOS)
- **@jxa/run** `^1.4.0` - 运行 JXA 脚本
- **run-applescript** `^7.1.0` - 运行 AppleScript

#### 其他
- **tippy.js** `^6.3.7` - Tooltip 库
- **qs** `^6.14.0` - 查询字符串解析
- **compare-versions** `^6.1.1` - 版本比较
- **font-list** `^2.0.1` - 字体列表
- **es-mime-types** `^0.1.4` - MIME 类型
- **yaml** `^2.8.2` - YAML 解析

---

### 18. 开发工具

#### TypeScript
- **typescript** `^5.8.3` / `^5.9.3` - TypeScript
- **vue-tsc** `^2.2.12` / `^3.0.3` / `^3.1.6` - Vue TypeScript 编译器
- **@typescript/native-preview** `7.0.0-dev.20260115.1` - TypeScript 原生预览

#### 构建工具
- **vite** `^7.0.5` / `^7.1.11` / `^7.2.6` - Vite 构建工具
- **@vitejs/plugin-vue** - Vue Vite 插件
- **vite-svg-loader** `^5.1.0` - SVG 加载器
- **vite-plugin-vue-devtools** `^8.0.5` - Vue DevTools

#### 测试
- **vitest** - Vitest 测试框架
- **@vitest/ui** - Vitest UI
- **@vitest/coverage-v8** - 代码覆盖率
- **@vue/test-utils** - Vue 测试工具
- **jsdom** `^26.1.0` - JSDOM

#### Linting & Formatting
- **eslint** - ESLint
- **oxlint** `^1.35.0` - Oxlint（快速 Linter）
- **prettier** `^3.6.2` / `^3.7.4` - Prettier
- **eslint-plugin-vue** - Vue ESLint 插件
- **eslint-plugin-simple-import-sort** `^12.1.1` - 导入排序
- **eslint-plugin-unused-imports** `^4.1.4` - 未使用导入检查

#### Git Hooks
- **simple-git-hooks** `^2.13.1` - Git Hooks
- **lint-staged** `^16.2.7` - Lint Staged

#### 工具
- **concurrently** `^9.1.2` / `^9.2.1` - 并行运行命令
- **cross-env** `^7.0.3` / `^10.1.0` - 跨平台环境变量
- **dotenv-cli** `^8.0.0` - Dotenv CLI
- **picocolors** `^1.1.1` - 终端颜色
- **sharp** `^0.33.2` / `^0.33.5` - 图像处理

#### 国际化
- **@intlify/unplugin-vue-i18n** `^6.0.8` - Vue i18n 插件
- **@lingual/i18n-check** `0.8.12` - i18n 检查工具

#### 图标
- **@egoist/tailwindcss-icons** `^1.9.0` - Tailwind CSS 图标
- **@iconify-json/mdi** `^1.2.3` - Material Design 图标
- **@iconify-json/lucide** `^1.2.82` - Lucide 图标
- **@iconify-json/vscode-icons** `^1.2.37` - VS Code 图标
- **@iconify-json/svg-spinners** `^1.2.2` - 旋转加载图标

#### MCP UI
- **@mcp-ui/client** `^5.13.3` - MCP UI 客户端

---

## 🎯 推荐依赖选择

### AI SDK 选择
建议使用：
- `openai` - OpenAI 官方 SDK（必选）
- `@anthropic-ai/sdk` - Claude SDK（推荐）
- `@google/genai` - Gemini SDK（可选）
- `ollama` - 本地模型支持（推荐）

### 数据库选择
- **SQLite**: `better-sqlite3-multiple-ciphers`（支持加密）
- **DuckDB**: `@duckdb/node-api`（分析场景）

### 编辑器选择
- **Rich Text**: Tiptap（推荐，功能完整）
- **Code Editor**: Monaco Editor（VS Code 同款）
- **Markdown**: CodeMirror（轻量级）

### UI 框架
- **Vue 3** + **Pinia** + **Vue Router**（核心）
- **Radix Vue** 或 **Reka UI**（无样式组件库）
- **Tailwind CSS 4.x**（样式框架）

### 文档处理
- PDF: `pdf-parse-new`
- Word: `mammoth`
- Excel: `xlsx` (SheetJS)
- Markdown: `markdown-it` + `turndown`

---

## 📝 备注

1. **版本选择**: 建议使用最新稳定版本
2. **依赖冲突**: 注意 Electron、Vue、Vite 版本兼容性
3. **构建优化**: 使用 `pnpm` 作为包管理器
4. **开发工具**: 推荐使用 `electron-vite` + `vitest`

---

**生成时间**: 2026-02-04
**参考项目**: Joythink-AI, CataxBot
