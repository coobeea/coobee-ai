# 图标命名规范

## 📋 统一命名规则

所有图标文件统一使用 `logo` 前缀，托盘图标使用 `tray-logo` 前缀。

## 🎨 图标文件清单

### 源文件（Source）

| 文件                      | 用途             | 分辨率         |
| ------------------------- | ---------------- | -------------- |
| `resources/logo.svg`      | 应用主图标源文件 | 矢量 (512x512) |
| `resources/tray-logo.svg` | 托盘图标源文件   | 矢量 (22x22)   |

### 生成的图标文件

#### Resources 目录（运行时使用）

| 文件                         | 用途            | 平台    | 分辨率   |
| ---------------------------- | --------------- | ------- | -------- |
| `resources/logo.png`         | 应用图标        | 所有    | 256x256  |
| `resources/logo.ico`         | 应用图标        | Windows | 多分辨率 |
| `resources/tray-logo.png`    | 托盘图标        | macOS   | 22x22    |
| `resources/tray-logo@2x.png` | 托盘图标 Retina | macOS   | 44x44    |

#### Build 目录（打包使用）

| 文件              | 用途     | 平台    | 说明                  |
| ----------------- | -------- | ------- | --------------------- |
| `build/icon.png`  | 应用图标 | 所有    | electron-builder 默认 |
| `build/icon.ico`  | 应用图标 | Windows | electron-builder 默认 |
| `build/icon.icns` | 应用图标 | macOS   | electron-builder 默认 |

## 🔧 生成图标

运行以下命令生成所有图标：

```bash
pnpm generate:icons
```

这会自动：

1. 从 `logo.svg` 生成 `logo.png` 和 `logo.ico`
2. 从 `tray-logo.svg` 生成 `tray-logo.png` 和 `tray-logo@2x.png`
3. 复制到 `build/` 目录并重命名为 `icon.*`（electron-builder 要求）

## 📂 目录结构

```
coobee-ai/
├── resources/              # 运行时图标
│   ├── logo.svg           # 应用图标源文件 ✏️
│   ├── logo.png           # 应用图标 (256x256) 🤖 自动生成
│   ├── logo.ico           # Windows 应用图标 🤖 自动生成
│   ├── tray-logo.svg      # 托盘图标源文件 ✏️
│   ├── tray-logo.png      # 托盘图标 (22x22) 🤖 自动生成
│   └── tray-logo@2x.png   # 托盘图标 Retina (44x44) 🤖 自动生成
└── build/                  # 打包图标
    ├── icon.png           # electron-builder 用 🤖 自动生成
    ├── icon.ico           # electron-builder 用 🤖 自动生成
    └── icon.icns          # electron-builder 用 🤖 自动生成
```

## 🎯 代码中的使用

### IconManager 配置

```typescript
// src/main/common/icons.ts

static getAppIcon(): string {
  const iconPath = path.join(
    this.basePath,
    process.platform === 'win32' ? 'logo.ico' : 'logo.png'
  )
  return iconPath
}

static getTrayIcon(): Electron.NativeImage {
  if (process.platform === 'darwin') {
    const templatePath = path.join(this.basePath, 'tray-logo.png')
    const retinaPath = path.join(this.basePath, 'tray-logo@2x.png')
    // ...
  }
  // ...
}
```

## 📝 命名规范总结

| 图标类型     | 命名规则          | 示例                                |
| ------------ | ----------------- | ----------------------------------- |
| **应用图标** | `logo.{ext}`      | `logo.png`, `logo.ico`, `logo.svg`  |
| **托盘图标** | `tray-logo.{ext}` | `tray-logo.png`, `tray-logo@2x.png` |
| **打包图标** | `icon.{ext}`      | `icon.png`, `icon.ico`, `icon.icns` |

## ⚠️ 注意事项

1. **源文件手动维护**：
   - `logo.svg` - 应用主图标设计
   - `tray-logo.svg` - 托盘图标设计（单色黑白）

2. **生成文件自动生成**：
   - 不要手动编辑 `logo.png`, `logo.ico`, `tray-logo*.png`
   - 修改源 SVG 后运行 `pnpm generate:icons`

3. **Build 目录特殊性**：
   - electron-builder 要求使用 `icon.*` 命名
   - 脚本会自动从 `logo.*` 复制并重命名

4. **Git 版本控制**：
   - ✅ 提交源文件：`*.svg`
   - ❌ 不提交生成文件：`logo.png`, `logo.ico`, `tray-logo*.png`
   - ✅ 提交 build 目录：`build/icon.*`（打包需要）

## 🔄 更新图标流程

1. 修改 `resources/logo.svg` 或 `resources/tray-logo.svg`
2. 运行 `pnpm generate:icons`
3. 检查生成的图标文件
4. 重启应用查看效果
5. 提交源 SVG 文件到 Git

## 🚀 快速参考

```bash
# 生成所有图标
pnpm generate:icons

# 查看生成的文件
ls -lh resources/logo.* resources/tray-logo.* build/icon.*

# 清理生成的文件（重新生成前）
rm -f resources/logo.png resources/logo.ico resources/tray-logo*.png

# 重启应用查看效果
pnpm dev
```
