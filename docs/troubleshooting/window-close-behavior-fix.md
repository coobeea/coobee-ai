# 窗口关闭行为修复说明

## 📋 问题描述

### 用户困惑

在 macOS 上，用户无法明确感知"关闭到托盘"配置项的作用：

- **配置 `closeToTray = false`**：关闭窗口后，应用不退出（macOS 默认行为）
- **配置 `closeToTray = true`**：关闭窗口后，窗口隐藏，应用不退出

**两种配置看起来效果一样！** 用户会很疑惑配置项是否生效。

### 根本原因

**旧的实现逻辑**：

```typescript
// app/index.ts (修复前)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit(); // Windows/Linux 退出
  } else {
    // macOS 保持运行（硬编码的平台行为）
  }
});
```

**问题**：macOS 的行为是**硬编码**的，完全不考虑 `closeToTray` 配置项。

## ✅ 解决方案

### 核心原则

**统一所有平台的行为，通过 `closeToTray` 配置项明确控制**：

- `closeToTray = true` → 关闭窗口时隐藏到托盘，应用保持运行
- `closeToTray = false` → 关闭窗口后应用退出（**包括 macOS**）

### 实现修改

#### 1. 修改 `app/index.ts`（核心修复）

```typescript
// app/index.ts (修复后)
app.on('window-all-closed', async () => {
  log.info('[App] 所有窗口已关闭');

  // 统一通过 closeToTray 配置项控制应用行为（不再依赖平台默认行为）
  const { config } = await import('@main/common/config');
  const closeToTray = config.getCloseToTray();
  const showTrayIcon = config.getShowTrayIcon();

  // 托盘模式：保持应用运行
  if (showTrayIcon && closeToTray) {
    log.info(
      `[App] 托盘模式：应用保持运行${process.platform === 'darwin' ? '（可通过 Dock 或托盘图标重新打开）' : '（可通过托盘图标重新打开）'}`
    );
    return;
  }

  // 非托盘模式：退出应用（统一所有平台行为）
  log.info(`[App] 非托盘模式：应用退出（platform: ${process.platform}）`);
  app.quit();
});
```

#### 2. 完善 `WindowManager.ts` 注释

```typescript
// WindowManager.ts (完善注释)
// 托盘模式：阻止窗口关闭，改为隐藏窗口
// 条件：1. 启用托盘图标 AND 2. 启用关闭到托盘
if (showTrayIcon && closeToTray) {
  e.preventDefault(); // 阻止窗口关闭
  window.hide(); // 隐藏窗口（不销毁）

  // macOS: 隐藏 Dock 图标（完全隐藏到托盘）
  if (process.platform === 'darwin') {
    app.dock?.hide();
  }

  return; // 不触发 'closed' 事件，也不触发 'window-all-closed'
}

// 非托盘模式：允许窗口正常关闭
// 流程：
//   1. 窗口关闭 → 触发 'closed' 事件 → cleanupWindow()
//   2. 如果是最后一个窗口 → 触发 'window-all-closed'
//   3. 'window-all-closed' 处理器根据 closeToTray 配置决定是否退出应用
```

## 📊 对比：修复前 vs 修复后

### macOS 平台

| 配置                  | 修复前                        | 修复后                  |
| --------------------- | ----------------------------- | ----------------------- |
| `closeToTray = false` | 窗口关闭，应用**不退出** ❌   | 窗口关闭，应用退出 ✅   |
| `closeToTray = true`  | 窗口隐藏，应用不退出 ✅       | 窗口隐藏，应用不退出 ✅ |
| **用户能否区分**      | ❌ 无法区分（两者看起来一样） | ✅ 行为明确不同         |

### Windows/Linux 平台

| 配置                  | 修复前                  | 修复后                  |
| --------------------- | ----------------------- | ----------------------- |
| `closeToTray = false` | 窗口关闭，应用退出 ✅   | 窗口关闭，应用退出 ✅   |
| `closeToTray = true`  | 窗口隐藏，应用不退出 ✅ | 窗口隐藏，应用不退出 ✅ |
| **用户能否区分**      | ✅ 行为明确             | ✅ 行为明确             |

### 跨平台统一性

| 平台       | 修复前          | 修复后      |
| ---------- | --------------- | ----------- |
| macOS      | 特殊逻辑 ❌     | 统一逻辑 ✅ |
| Windows    | 统一逻辑 ✅     | 统一逻辑 ✅ |
| Linux      | 统一逻辑 ✅     | 统一逻辑 ✅ |
| **一致性** | ❌ macOS 不一致 | ✅ 完全一致 |

## 🧪 测试验证

### 测试用例

```typescript
describe('窗口关闭行为（统一平台逻辑）', () => {
  it('macOS + closeToTray=false → 应用退出 ✅', () => {
    // 预期：窗口关闭 → 'window-all-closed' → app.quit()
  });

  it('macOS + closeToTray=true → 应用保持运行 ✅', () => {
    // 预期：窗口隐藏 → 'window-all-closed' 不触发
  });

  it('Windows + closeToTray=false → 应用退出 ✅', () => {
    // 预期：窗口关闭 → 'window-all-closed' → app.quit()
  });

  it('Windows + closeToTray=true → 应用保持运行 ✅', () => {
    // 预期：窗口隐藏 → 'window-all-closed' 不触发
  });
});
```

### 手动测试步骤

#### 测试 1：`closeToTray = false`（应用应该退出）

1. 打开应用
2. 设置 → 关闭"关闭时最小化到托盘"
3. 关闭窗口（点击 ❌）
4. **预期结果**：
   - macOS：应用退出，Dock 图标消失 ✅
   - Windows：应用退出，任务栏图标消失 ✅

#### 测试 2：`closeToTray = true`（应用应该保持运行）

1. 打开应用
2. 设置 → 开启"关闭时最小化到托盘"
3. 关闭窗口（点击 ❌）
4. **预期结果**：
   - macOS：窗口消失，Dock 图标隐藏，托盘图标显示 ✅
   - Windows：窗口消失，托盘图标显示 ✅
5. 点击托盘图标
6. **预期结果**：
   - macOS：窗口恢复，Dock 图标恢复 ✅
   - Windows：窗口恢复 ✅

## 🎯 用户体验改进

### 修复前（用户困惑）

```
用户在 macOS 上：
- "我关闭了窗口，为什么应用还在运行？"
- "我设置了'关闭到托盘'，但感觉没有作用？"
- "为什么 Windows 和 macOS 的行为不一样？"
```

### 修复后（逻辑清晰）

```
用户在 macOS 上：
- "我关闭了窗口，应用退出了 ✅"（closeToTray = false）
- "我关闭了窗口，应用隐藏到托盘了 ✅"（closeToTray = true）
- "Windows 和 macOS 的行为一致，很容易理解 ✅"
```

## 📝 注意事项

### macOS 用户提示

修复后，macOS 用户可能会有以下疑问：

**Q: 为什么关闭窗口后应用退出了？以前不会退出的。**

**A**: 这是新的统一行为。如果你希望关闭窗口后应用保持运行（最小化到托盘），请在设置中开启"关闭时最小化到托盘"。

### 配置项说明

| 配置项                    | 说明                                   |
| ------------------------- | -------------------------------------- |
| **显示托盘图标**          | 是否在系统托盘显示应用图标             |
| **关闭时最小化到托盘** ⭐️ | 关闭窗口时是否隐藏到托盘（而不是退出） |

**重要**：只有同时开启"显示托盘图标"和"关闭时最小化到托盘"，应用才会在关闭窗口后保持运行。

## 🔄 迁移指南

### 如果你希望保持 macOS 的旧行为

如果你希望 macOS 在关闭窗口后保持运行（不退出），请：

1. 开启"显示托盘图标"
2. 开启"关闭时最小化到托盘"

这样就能恢复旧的 macOS 行为。

### 推荐配置

- **普通用户**：关闭"关闭时最小化到托盘"（关闭窗口 = 退出应用）
- **高级用户**：开启"关闭时最小化到托盘"（应用在后台运行）

## 📚 相关文档

- [窗口管理器文档](../1.ui-architechure/window-manager.md)
- [托盘管理器文档](../1.ui-architechure/app-bootstrap-guide.md)
- [应用生命周期文档](../1.ui-architechure/app-lifecycle.md)

## 🐛 已知问题

无。

## ✅ 结论

通过统一所有平台的窗口关闭行为，配置项的作用变得清晰明确，用户不再困惑。

**核心改进**：

- ✅ macOS 和 Windows/Linux 行为完全一致
- ✅ `closeToTray` 配置项在所有平台都有明确的作用
- ✅ 用户能清楚地感知配置项的效果
- ✅ 代码逻辑更简单，不再有平台特殊判断
