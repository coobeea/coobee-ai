# 经验库索引

> 问题总数：1  
> 方案总数：4  
> 最后更新：2026-03-07

## 快速检索

### 按 Skill 分类

- [extension-creator](#extension-creator)（1个问题，4个方案）

### 按关键词

- [#jiti](#jiti)（1个）
- [#动态导入](#动态导入)（1个）
- [#Extension](#Extension)（1个）
- [#logger](#logger)（1个）
- [#app-undefined](#app-undefined)（1个）

---

## Extension Creator

### P001: Extension 方法中动态导入导致 app.getAppPath() undefined 错误

- **类别**：模块加载 / jiti 上下文
- **难度**：中等
- **方案数**：4个
- **标签**：#jiti #Extension #logger #动态导入 #app-undefined
- **路径**：[problems/P001-Extension动态导入失败/](./P001-Extension动态导入失败/)
- **历史出现**：4次（b73eb08, b7cb697, 8df5db9, 3f20449）

**核心问题**：Extension 方法（如 ChannelPlugin.handleMessage）中使用 `await import()` 导入的模块，如果该模块顶层调用了 `createLogger()`，会触发嵌套 jiti 上下文中 `app` 对象为 `undefined` 的错误。

**推荐方案**：

- ✅ S001: 静态导入（适用于简单类）
- ✅ S002: 依赖注入（适用于复杂对象）
- ✅ S003: 路径缓存（适用于只需路径）
- ⚠️ S004: EventBus 回调（适用于事件驱动场景）
