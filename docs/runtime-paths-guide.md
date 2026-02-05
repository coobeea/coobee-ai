# Runtime 路径管理指南

## 📋 概述

本项目使用 `runtime/` 目录存储跨平台的运行时二进制文件，通过统一的路径管理系统自动区分开发环境和生产环境。

---

## 📁 目录结构

```
coobee-ai/
├── runtime/                 # 运行时二进制（不提交到 Git）
│   ├── macos-arm64/        # macOS Apple Silicon
│   ├── macos-x64/          # macOS Intel
│   ├── linux-x64/          # Linux x64
│   ├── linux-arm64/        # Linux ARM64
│   ├── win/                # Windows x64
│   └── macos/              # 本地开发用（自动复制）
├── resources/              # 应用静态资源（正常打包）
│   └── icon.png
└── scripts/
    └── before-pack.js      # 打包前处理脚本
```

---

## 🛠️ 使用方法

### 1. 导入 Env 模块

```typescript
import { Env } from '@main/common'

// 可用的路径方法：
// - Env.paths.userData         - 用户数据目录
// - Env.getResourcePath('')    - 应用资源目录
// - Env.getAppRuntimeDir()     - 运行时根目录
// - Env.getPlatformRuntimeDir() - 当前平台的运行时目录
// - Env.paths.logPath          - 日志目录
```

### 2. 基本使用

```typescript
import { Env } from '@main/common'
import path from 'path'

// 获取当前平台的二进制文件路径
const binaryPath = path.join(
  Env.getPlatformRuntimeDir(),
  process.platform === 'win32' ? 'tool.exe' : 'tool'
)

console.log(binaryPath)
// 开发模式: /path/to/coobee-ai/runtime/macos/tool
// 生产模式: /Applications/coobee-ai.app/Contents/Resources/runtime/macos/tool
```

### 3. 实际示例

```typescript
import { Env } from '@main/common'
import { exec } from 'child_process'
import path from 'path'

// 执行运行时二进制
async function runTool() {
  const toolPath = path.join(
    Env.getPlatformRuntimeDir(),
    process.platform === 'win32' ? 'uv.exe' : 'uv'
  )

  return new Promise((resolve, reject) => {
    exec(`"${toolPath}" --version`, (error, stdout, stderr) => {
      if (error) {
        reject(error)
        return
      }
      resolve(stdout)
    })
  })
}
```

---

## 📂 路径详解

### Env.paths.userData

**用途**: 用户数据目录，存储数据库、配置文件等

**路径示例**:

- macOS: `~/Library/Application Support/coobee-ai`
- Windows: `C:\Users\<user>\AppData\Roaming\coobee-ai`
- Linux: `~/.config/coobee-ai`

### Env.getResourcePath(relativePath)

**用途**: 应用静态资源目录（icon.png 等）

**路径示例**:

- 开发模式: `/path/to/coobee-ai/resources`
- 生产模式: `/Applications/coobee-ai.app/Contents/Resources`

**使用示例**:

```typescript
Env.getResourcePath('icon.png') // 获取资源文件路径
```

### Env.getAppRuntimeDir()

**用途**: 运行时二进制根目录

**路径示例**:

- 开发模式: `/path/to/coobee-ai/runtime`
- 生产模式: `/Applications/coobee-ai.app/Contents/Resources/runtime`

**环境变量**: `APP_RUNTIME_DIR`（可覆盖）

### Env.getPlatformRuntimeDir()

**用途**: 当前平台的运行时目录（最常用）

**路径示例**:

- macOS: `<runtime>/macos`
- Windows: `<runtime>/win`
- Linux: `<runtime>/linux`

### Env.paths.logPath

**用途**: 日志目录

**路径示例**:

- macOS: `~/Library/Logs/coobee-ai`
- Windows: `C:\Users\<user>\AppData\Roaming\coobee-ai\logs`
- Linux: `~/.config/coobee-ai/logs`

---

## 🔧 添加新的二进制工具

### 步骤 1：下载二进制文件

手动或通过脚本下载所有平台的二进制：

```bash
# 示例：手动下载
cd runtime
mkdir -p macos-arm64 macos-x64 linux-x64 linux-arm64 win

# 下载并放置到对应目录
# macos-arm64/tool
# macos-x64/tool
# linux-x64/tool
# linux-arm64/tool
# win/tool.exe
```

### 步骤 2：本地开发复制

```bash
# macOS 开发时，复制当前平台到 macos/
cp runtime/macos-arm64/* runtime/macos/

# Linux 开发时，复制当前平台到 linux/
cp runtime/linux-x64/* runtime/linux/
```

### 步骤 3：在代码中使用

```typescript
import { Env } from '@main/common'
import path from 'path'

const toolPath = path.join(
  Env.getPlatformRuntimeDir(),
  process.platform === 'win32' ? 'tool.exe' : 'tool'
)
```

---

## 📦 打包流程

### 开发环境

```bash
pnpm dev
```

- 使用 `runtime/macos/`（或 `runtime/linux/`）
- 路径自动解析为项目根目录

### 打包流程

```bash
pnpm build:mac
```

**自动执行：**

1. `before-pack.js` 检测目标平台和架构
2. 复制 `runtime/macos-arm64/` → `runtime/macos/`
3. electron-builder 打包 `runtime/macos/` 到 `extraResources`
4. 最终包只包含目标平台的二进制

**验证打包结果：**

```bash
# 检查打包后的 runtime 目录
ls -la dist/mac-arm64/coobee-ai.app/Contents/Resources/runtime/macos/

# 应该看到对应的二进制文件
# 不应该看到其他平台的目录（如 linux/）
```

---

## 🐛 故障排查

### 问题 1：找不到二进制文件

**症状**:

```
Error: ENOENT: no such file or directory, stat '.../runtime/macos/tool'
```

**检查**:

```bash
# 开发模式
ls -la runtime/macos/

# 生产模式（打包后）
ls -la /Applications/coobee-ai.app/Contents/Resources/runtime/macos/
```

**解决**:

1. 确保 `runtime/macos-{arch}/` 目录有文件
2. 开发时确保复制到 `runtime/macos/`
3. 打包时检查 `before-pack.js` 是否执行

### 问题 2：权限错误

**症状**:

```
Error: EACCES: permission denied
```

**解决**:

```bash
# 给予执行权限
chmod +x runtime/macos/tool
```

### 问题 3：打包后体积过大

**检查**:

```bash
# 查看打包后的 runtime 目录
ls -la dist/mac-arm64/coobee-ai.app/Contents/Resources/runtime/

# 应该只有 macos/ 目录，不应该有 linux/, win/ 等
```

**解决**:

- 确认 `before-pack.js` 正确执行
- 检查 `electron-builder.yml` 配置

---

## ✅ 最佳实践

1. **不提交二进制到 Git**
   - 已在 `.gitignore` 中排除 `runtime/*/`
   - 只提交 `runtime/.gitkeep`

2. **使用路径函数**
   - 不要硬编码路径
   - 使用 `getPlatformRuntimeDir()` 等函数

3. **跨平台兼容**
   - Windows 使用 `.exe` 后缀
   - 使用 `path.join()` 而非字符串拼接
   - 执行命令时用引号包裹路径: `"${toolPath}"`

4. **测试覆盖**
   - 开发模式测试
   - 打包后测试
   - 多平台交叉验证

---

## 🔗 相关文件

- `src/main/common/paths.ts` - 路径管理模块
- `scripts/before-pack.js` - 打包前处理脚本
- `electron-builder.yml` - 打包配置
- `.gitignore` - 排除 runtime 二进制

---

**文档版本**: 1.0.0  
**最后更新**: 2026-02-04  
**项目**: coobee-ai
