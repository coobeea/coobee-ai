# Runtime 基础使用指南

> 基础版本 - 不包含 Python 环境和自动下载

---

## 📁 目录结构

```
runtime/                    # 运行时二进制目录
├── macos-arm64/           # 手动放置 macOS ARM64 二进制
├── macos-x64/             # 手动放置 macOS Intel 二进制
├── linux-x64/             # 手动放置 Linux x64 二进制
├── linux-arm64/           # 手动放置 Linux ARM64 二进制
├── win/                   # 手动放置 Windows 二进制
└── macos/                 # 开发时使用（手动复制）
```

---

## 🚀 快速开始

### 1. 放置二进制文件

将你的二进制文件手动放入对应的平台目录：

```bash
# 示例：放置一个工具
runtime/macos-arm64/my-tool
runtime/macos-x64/my-tool
runtime/linux-x64/my-tool
runtime/linux-arm64/my-tool
runtime/win/my-tool.exe
```

### 2. 本地开发准备

复制当前平台的二进制到通用目录：

```bash
# macOS（根据你的 Mac 类型选择）
cp runtime/macos-arm64/* runtime/macos/    # Apple Silicon
# 或
cp runtime/macos-x64/* runtime/macos/      # Intel

# Linux
cp runtime/linux-x64/* runtime/linux/

# Windows
copy runtime\win\* runtime\win\
```

### 3. 在代码中使用

```typescript
import { getPlatformRuntimeDir } from '@main/common'
import path from 'path'

// 获取工具路径
const toolPath = path.join(
  getPlatformRuntimeDir(),
  process.platform === 'win32' ? 'my-tool.exe' : 'my-tool'
)

console.log(toolPath)
// 开发: /path/to/coobee-ai/runtime/macos/my-tool
// 生产: /Applications/coobee-ai.app/Contents/Resources/runtime/macos/my-tool
```

---

## 📦 打包流程

### 开发模式

```bash
pnpm dev
```

- 使用 `runtime/macos/`（或 `runtime/linux/`）中的二进制
- 自动解析为项目根目录

### 打包构建

```bash
pnpm build:mac
```

**自动流程：**

1. `before-pack.js` 检测目标平台和架构
2. 复制 `runtime/macos-arm64/` → `runtime/macos/`（示例）
3. electron-builder 打包 `runtime/macos/` 到 `extraResources`
4. 最终包只包含目标平台的二进制

---

## 🔧 可用的路径函数

```typescript
import {
  getDataDir, // 用户数据目录
  getResourcesDir, // 应用资源目录
  getRuntimeDir, // 运行时根目录
  getPlatformRuntimeDir, // 当前平台运行时（最常用）
  getLogsDir // 日志目录
} from '@main/common'
```

### 路径示例

| 函数                      | 开发模式                                  | 生产模式 (macOS)                                               |
| ------------------------- | ----------------------------------------- | -------------------------------------------------------------- |
| `getDataDir()`            | `~/Library/Application Support/coobee-ai` | 同左                                                           |
| `getRuntimeDir()`         | `/path/to/coobee-ai/runtime`              | `/Applications/coobee-ai.app/Contents/Resources/runtime`       |
| `getPlatformRuntimeDir()` | `/path/to/coobee-ai/runtime/macos`        | `/Applications/coobee-ai.app/Contents/Resources/runtime/macos` |

---

## ✅ 检查清单

### 开发前

- [ ] 已将二进制文件放入 `runtime/{platform}/` 目录
- [ ] 已复制当前平台到 `runtime/macos/`（或 `runtime/linux/`）
- [ ] 二进制文件有执行权限（Unix 系统）

### 打包前

- [ ] 所有平台的二进制都已准备好
- [ ] `before-pack.js` 脚本存在
- [ ] `electron-builder.yml` 配置了 `extraResources`

### 打包后验证

```bash
# macOS 示例
ls -la dist/mac-arm64/coobee-ai.app/Contents/Resources/runtime/macos/

# 应该看到：
# - 只有当前平台的二进制
# - 没有其他平台的目录
```

---

## 🐛 常见问题

### Q: 找不到二进制文件

**开发模式：**

```bash
# 检查是否复制到通用目录
ls -la runtime/macos/
```

**生产模式：**

```bash
# 检查打包后的文件
ls -la /Applications/coobee-ai.app/Contents/Resources/runtime/macos/
```

### Q: 权限错误（macOS/Linux）

```bash
# 给予执行权限
chmod +x runtime/macos/my-tool
```

### Q: 打包体积过大

检查是否包含了多余的平台：

```bash
# 应该只有 macos/，不应该有 linux/, win/ 等
ls -la dist/mac-arm64/coobee-ai.app/Contents/Resources/runtime/
```

---

## 🎯 下一步（可选）

当需要自动化时，可以添加：

- 自动下载脚本（`download-*.mjs`）
- Python 环境支持（`start-up.ts`）
- 依赖包管理

---

**文档版本**: 1.0.0（基础版）  
**最后更新**: 2026-02-05  
**项目**: coobee-ai
