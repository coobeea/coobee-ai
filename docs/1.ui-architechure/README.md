# 架构文档导航

## ⭐ 主文档（唯一需要阅读的完整指导）

### [multi-tab-architecture.md](./multi-tab-architecture.md)

**Electron 多窗口多 Tab 完整架构指导**

这是 **coobee-ai 项目的唯一完整架构文档**，包含从原理到实施的所有内容：

✅ **完整架构原理**（单主进程 + 多窗口 + 多 Tab）  
✅ **WindowManager 设计**（窗口管理）  
✅ **TabManager 设计**（Tab 管理）⭐ 核心  
✅ **WebContentsView 详解**（独立渲染进程）  
✅ **实施路线图**（7-11 天）  
✅ **代码模板**（可直接使用）  
✅ **IPC 通信设计**  
✅ **渲染进程集成**

**阅读时间**：30-40 分钟  
**实施时间**：7-11 天

---

## 📋 辅助文档

### [implementation-checklist.md](./implementation-checklist.md)

**详细实施清单**

提供分步骤的详细任务清单和代码模板，用于实际开发时参考。

**用途**：开发过程中的任务清单和代码参考

---

### [multi-window-architecture.md](./multi-window-architecture.md)

**历史参考文档**

> ⚠️ **该文档内容已整合到主文档** - 保留仅供参考，无需单独阅读

---

## 🚀 快速开始

### 第一步：阅读主文档

```bash
open docs/architecture/multi-tab-architecture.md
```

理解完整的架构设计，包括 WindowManager 和 TabManager 的设计原理。

### 第二步：参考实施清单

```bash
open docs/architecture/implementation-checklist.md
```

查看详细的任务清单和代码模板，制定实施计划。

### 第三步：开始实施

按照主文档中的实施路线图，分阶段完成：

1. **阶段 1**：WindowManager (1-2天)
2. **阶段 2**：TabManager (2-3天)
3. **阶段 3**：IPC 通信 (1天)
4. **阶段 4**：Shell 窗口 (1-2天)
5. **阶段 5**：测试优化 (2-3天)

---

## 📊 架构概览

```
┌────────────────────────────────┐
│    应用层 (AppManager)          │
│    • 单实例锁定                 │
│    • 生命周期管理               │
│    • 事件总线                   │
└──────────┬─────────────────────┘
           │
    ┌──────┴──────┐
    │             │
┌───▼──────┐  ┌──▼──────┐
│Window    │  │  Tab     │ ⭐
│Manager   │  │  Manager │
│          │  │          │
│多个窗口  │  │每窗口多Tab│
└──────────┘  └──────────┘
```

**核心亮点**：

- ✅ 每个 Tab 是独立渲染进程（WebContentsView）
- ✅ Tab 崩溃不影响其他 Tab
- ✅ 类似 Chrome 的多 Tab 体验

---

## 🎯 为什么选择这个架构？

### 与其他方案对比

| 方案                   | 进程隔离 | 崩溃影响 | 内存隔离 | 复杂度            |
| ---------------------- | -------- | -------- | -------- | ----------------- |
| **Vue Router Tab**     | ❌       | 全部崩溃 | ❌       | 低                |
| **iframe**             | 部分     | 页面影响 | 部分     | 中                |
| **WebContentsView** ⭐ | ✅       | 单个崩溃 | ✅       | 高                |
| **多 BrowserWindow**   | ✅       | 单个崩溃 | ✅       | 高（无法 Tab 化） |

**结论**：WebContentsView 提供了最佳的用户体验和稳定性。

---

## 📞 需要帮助？

- 阅读主文档时有疑问 → 查看文档中的"核心技术"章节
- 实施过程中遇到问题 → 参考 implementation-checklist.md 中的代码模板
- 需要了解 catax-bot 的实现 → 查看 /Users/lifeng/git/git_taxai/catax-bot/ 源码

---

## 📝 文档维护

**主文档**：`multi-tab-architecture.md`  
**最后更新**：2026-02-04  
**版本**：v1.0
