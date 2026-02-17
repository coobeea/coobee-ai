# 24 - 主进程构建性能分析

> 日期：2026-02-17
> 状态：待处理

## 现象

`pnpm dev` 启动时，主进程（main process）构建耗时约 **5.4 秒**；代码热更新时即使仅变更几个文件，重建也需要 **5.5 秒**，体验较差。

| 场景         | 转换模块数 | 输出大小  | 耗时   |
| ------------ | ---------- | --------- | ------ |
| 冷启动构建   | 2676       | 12,161 KB | 5381ms |
| 热更新重建   | 27         | 12,159 KB | 5587ms |
| Preload 构建 | 4          | 1.56 KB   | 115ms  |

**关键发现**：热更新仅转换 27 个模块，但总耗时与冷启动 2676 个模块几乎相同。说明**瓶颈不在模块转换阶段，而在最终打包输出阶段**。

## 根因分析

### 1. pi-SDK 强制内联打包（主因）

```typescript
// electron.vite.config.ts
build: {
  externalizeDeps: {
    exclude: ['@mariozechner/pi-coding-agent', '@mariozechner/pi-ai', 'ws']
  }
}
```

`@mariozechner/pi-coding-agent` 和 `@mariozechner/pi-ai` 是 ESM-only 包，无法被 electron-vite 自动外部化（Electron 主进程默认运行 CJS），因此被强制打包进 bundle。这两个 SDK 及其依赖链非常庞大，是 2676 模块和 12MB 输出的主要来源。

### 2. 禁用代码分割 — 每次必须重写 12MB

```typescript
rollupOptions: {
  output: {
    inlineDynamicImports: true,    // 所有动态 import() 内联
    manualChunks: undefined         // 禁用自动代码分割
  }
}
```

所有代码被压入单个 `out/main/index.js`（12MB）。即使只改 1 个文件，Rollup 也需要：

- 重新 tree-shake 全部 2676 个模块的依赖关系
- 重新 scope hoisting 优化
- 重新写入整个 12MB 文件

这就是热更新和冷启动一样慢的直接原因。

### 3. WASM 文件每次构建都复制

`copyWasmAssetsPlugin` 的 `writeBundle` 钩子在每次构建（包括热更新）都会执行 `fs.copyFileSync`，虽然单次开销不大，但属于不必要的重复操作。

### 4. 影响链路

```
代码改动
  → Vite 检测到变化
  → 只转换了 27 个变更模块（< 100ms）
  → Rollup 需要重新打包整个 12MB 文件（~5 秒）  ← 瓶颈
     ├── tree-shaking 2676 个模块的依赖关系
     ├── scope hoisting 优化
     ├── 写入 12MB 的 index.js
     └── 复制 WASM 文件
  → Electron 进程重启
```

## 优化方案（待评估）

### 方案 A：开发模式启用代码分割（推荐优先尝试）

去掉 `inlineDynamicImports: true`，让 Rollup 按 chunk 分割输出：

```typescript
// 仅在 production 时内联
output: {
  inlineDynamicImports: process.env.NODE_ENV === 'production'
}
```

**预期效果**：热更新只需重写变更的 chunk（几十 KB），而不是整个 12MB。
**风险**：Electron 主进程加载多个 chunk 文件时需确保路径解析正确。

### 方案 B：pi-SDK 预编译为 CJS

将 `@mariozechner/pi-coding-agent` 预编译为 CJS 格式的单文件，放入 `libs/` 目录，然后通过 `external` 外部化：

```typescript
external: [
  'better-sqlite3-multiple-ciphers',
  'fs-ext',
  'electron',
  '@mariozechner/pi-coding-agent', // 外部化
  '@mariozechner/pi-ai' // 外部化
]
```

**预期效果**：bundle 大幅缩小（可能从 12MB 降到 2-3MB），构建时间降至 1-2 秒。
**风险**：需要维护预编译脚本，SDK 更新时需重新编译。

### 方案 C：WASM 复制优化

在 `writeBundle` 中增加文件比对，仅在文件变更时复制：

```typescript
writeBundle() {
  for (const { src, dest } of wasmFiles) {
    if (fs.existsSync(dest) && fs.statSync(src).mtimeMs <= fs.statSync(dest).mtimeMs) {
      continue // 跳过未变更的文件
    }
    fs.copyFileSync(src, dest)
  }
}
```

**预期效果**：热更新时减少不必要的 I/O。

### 方案 D：esbuild 替代 Rollup（仅开发模式）

electron-vite 底层使用 Rollup 打包主进程。考虑在开发模式下使用 esbuild（速度快 10-100 倍），生产模式仍用 Rollup。

**预期效果**：构建时间从 5 秒降至 500ms 以内。
**风险**：需要自定义构建流程，esbuild 对某些 Rollup 特性支持不完整。

## 优先级建议

| 方案          | 难度 | 收益 | 建议     |
| ------------- | ---- | ---- | -------- |
| A. 代码分割   | 低   | 中   | 先试     |
| B. SDK 预编译 | 中   | 高   | 效果最好 |
| C. WASM 优化  | 低   | 低   | 顺手改   |
| D. esbuild    | 高   | 极高 | 长期方案 |
