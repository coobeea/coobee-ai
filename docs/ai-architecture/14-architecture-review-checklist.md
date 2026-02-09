# AI 模块架构评审 Checklist

本文档提供完整的架构评审检查项，用于代码审查、模块设计评审和架构质量保证。

---

## 模块级别检查项

### 1. 职责单一性

- [ ] 模块职责明确且唯一
- [ ] 没有承担多个不相关的职责
- [ ] 模块名称能准确反映其职责
- [ ] 模块大小适中（文件数 < 20，代码行数 < 2000）

**评分标准**：

- ✅ 优秀：职责清晰，边界明确
- ⚠️ 需改进：职责略宽泛，但可接受
- ❌ 不合格：职责混乱，需要拆分

---

### 2. 依赖关系清晰

- [ ] 依赖方向符合分层架构（向下依赖）
- [ ] 无循环依赖
- [ ] 依赖数量合理（< 10 个模块）
- [ ] 使用接口解耦核心依赖
- [ ] 外部依赖版本固定

**检查方法**：

```bash
# 检查循环依赖
npx madge --circular src/main/ai

# 可视化依赖关系
npx madge --image deps.png src/main/ai
```

---

### 3. 接口定义完整

- [ ] 所有公共接口有清晰的类型定义
- [ ] 接口有 JSDoc 注释
- [ ] 接口有使用示例
- [ ] 参数验证完整
- [ ] 返回值类型明确

**示例**：

````typescript
/**
 * 创建 Agent 实例
 *
 * @param options - 创建选项
 * @returns Agent 实例
 * @throws {ConfigError} 当配置不存在时
 *
 * @example
 * ```typescript
 * const agent = await factory.createAgent({ sessionId: 'xxx' })
 * ```
 */
async createAgent(options: CreateAgentOptions): Promise<Agent>
````

---

### 4. 类型安全

- [ ] 无 `any` 类型（必要时使用 `unknown` + 类型守卫）
- [ ] 无 `@ts-ignore` 或 `@ts-expect-error`（有充分理由除外）
- [ ] 类型定义一致（无冗余或冲突）
- [ ] 泛型使用合理
- [ ] 类型检查 100% 通过

**检查方法**：

```bash
pnpm typecheck
```

---

### 5. 错误处理

- [ ] 所有 async 函数有 try-catch
- [ ] 使用自定义错误类（继承自 `AIError`）
- [ ] 错误信息包含上下文
- [ ] 错误日志结构化
- [ ] 关键操作有错误恢复机制

**反例**：

```typescript
// ❌ 静默失败
try {
  await operation()
} catch (error) {
  return null
}
```

**正例**：

```typescript
// ✅ 显式错误处理
try {
  await operation()
} catch (error) {
  console.error('[Module] Operation failed:', { context, error })
  throw new ModuleError('Operation failed', { originalError: error })
}
```

---

### 6. 资源清理

- [ ] 所有资源管理类有 `initialize()` 和 `cleanup()`
- [ ] 定时器在 `cleanup()` 中清理
- [ ] WebSocket/HTTP 连接正确关闭
- [ ] 文件句柄正确释放
- [ ] 缓存有过期和淘汰机制

**检查清单**：

```typescript
class ResourceManager {
  // ✅ 必需
  async initialize(): Promise<void>
  async cleanup(): Promise<void>

  // ✅ 推荐
  private initialized: boolean
  private checkInitialized(): void
}
```

---

### 7. 测试覆盖

- [ ] 核心模块测试覆盖率 > 80%
- [ ] 关键路径有集成测试
- [ ] 边界条件有测试
- [ ] 错误场景有测试
- [ ] 异步操作有测试

**检查方法**：

```bash
pnpm test --coverage
```

---

### 8. 文档完整

- [ ] 模块有 README 或在主文档中有章节
- [ ] 公共接口有 JSDoc
- [ ] 有使用示例
- [ ] 架构图准确反映代码
- [ ] 变更记录在 CHANGELOG

---

## 代码级别检查项

### 1. 类型定义一致

- [ ] 同一概念使用统一字段名
- [ ] 无冗余字段（如 `workerId` vs `assignedWorker`）
- [ ] 枚举值命名一致
- [ ] 接口命名规范（`I` 前缀或描述性后缀）

**检查示例**：

```typescript
// ❌ 不一致
interface SubTask {
  objective: string // 与 name 重复
  name: string
  workerId?: string // 与 assignedWorker 重复
  assignedWorker?: string
}

// ✅ 一致
interface SubTask {
  name: string
  assignedWorker: string
}
```

---

### 2. 无 any 或 unknown 滥用

- [ ] 无不必要的 `any`
- [ ] `unknown` 配合类型守卫使用
- [ ] 泛型参数有约束
- [ ] 类型断言有充分理由

**检查方法**：

```bash
# 搜索 any 使用
rg ":\s*any" src/main/ai

# 搜索类型断言
rg "as\s+(any|unknown)" src/main/ai
```

---

### 3. 无 TODO 遗留

- [ ] 代码中无 `// TODO` 注释
- [ ] 或所有 TODO 有对应 Issue
- [ ] TODO 有明确的负责人和期限

**检查方法**：

```bash
rg "TODO" src/main/ai
```

---

### 4. 无循环依赖

- [ ] 模块之间无循环引用
- [ ] 文件之间无循环引用
- [ ] 使用接口或依赖注入打破循环

**检查方法**：

```bash
npx madge --circular src/main/ai
```

---

### 5. 无资源泄漏

- [ ] 定时器都被清理
- [ ] 事件监听器都被移除
- [ ] 文件句柄都被关闭
- [ ] 缓存有大小限制
- [ ] 内存使用可控

**检查点**：

```typescript
// ✅ 定时器清理
class Timer {
  private intervalId: NodeJS.Timeout | null = null

  start() {
    this.intervalId = setInterval(...)
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }
}

// ✅ 事件监听清理
class EventListener {
  private handler = (event) => { }

  initialize() {
    eventBus.on('event', this.handler)
  }

  cleanup() {
    eventBus.off('event', this.handler)
  }
}
```

---

## 功能完整性检查

### 1. 核心功能可用

- [ ] P0 问题全部修复
- [ ] 关键路径可正常执行
- [ ] 无遗留的空实现

### 2. 边界条件处理

- [ ] 空输入处理
- [ ] 超大输入处理
- [ ] 并发场景处理
- [ ] 错误场景恢复

### 3. 性能要求

- [ ] 响应时间 < 3秒（API 调用）
- [ ] 吞吐量 > 100 req/s（关键接口）
- [ ] 内存使用 < 500MB（单进程）
- [ ] 数据库查询 < 100ms

---

## 架构质量检查

### 1. 分层清晰

```
Runtime Layer (运行时层)
    ↓
Core Layer (核心层)
    ↓
Infrastructure Layer (基础设施层)
```

- [ ] 依赖方向单向
- [ ] 每层职责明确
- [ ] 层间通过接口通信

### 2. 模块内聚

- [ ] 相关功能在同一模块
- [ ] 模块边界清晰
- [ ] 模块大小适中

### 3. 耦合度低

- [ ] 模块间依赖少
- [ ] 通过接口解耦
- [ ] 无硬编码依赖

---

## 代码质量检查

### 1. 命名规范

- [ ] 类名：PascalCase
- [ ] 函数名：camelCase
- [ ] 常量：UPPER_SNAKE_CASE
- [ ] 类型：PascalCase + 描述性后缀
- [ ] 文件名：与主要导出一致

### 2. 代码风格

- [ ] ESLint 0 错误
- [ ] Prettier 格式化通过
- [ ] 无 console.log（使用结构化日志）
- [ ] 注释清晰准确

**检查方法**：

```bash
pnpm lint
pnpm format:check
```

### 3. 复杂度控制

- [ ] 函数长度 < 50 行
- [ ] 圈复杂度 < 10
- [ ] 嵌套层级 < 4
- [ ] 参数个数 < 5

---

## 安全性检查

### 1. 输入验证

- [ ] 所有外部输入都验证
- [ ] 类型检查
- [ ] 范围检查
- [ ] 格式验证

### 2. SQL 注入防护

- [ ] 使用参数化查询
- [ ] 无字符串拼接 SQL
- [ ] ORM 使用规范

### 3. 敏感信息保护

- [ ] API Key 不记录日志
- [ ] 密码不明文存储
- [ ] Token 不暴露在错误信息中

---

## 性能检查

### 1. 查询优化

- [ ] 无 N+1 查询
- [ ] 使用批量操作
- [ ] 适当的索引
- [ ] 分页查询

### 2. 缓存策略

- [ ] 频繁访问数据已缓存
- [ ] 缓存有过期机制
- [ ] 缓存有大小限制
- [ ] 缓存键设计合理

### 3. 异步处理

- [ ] I/O 操作异步
- [ ] 长时间操作后台执行
- [ ] 使用流式处理大数据
- [ ] 合理的并发控制

---

## 可维护性检查

### 1. 代码可读性

- [ ] 变量名有意义
- [ ] 函数职责单一
- [ ] 逻辑清晰简洁
- [ ] 注释恰当

### 2. 可扩展性

- [ ] 使用接口和抽象
- [ ] 遵循开闭原则
- [ ] 配置化而非硬编码
- [ ] 插件化设计

### 3. 可测试性

- [ ] 依赖可注入
- [ ] 副作用可控
- [ ] 状态可重置
- [ ] 隔离性好

---

## 评审流程

### 阶段 1：自我检查

开发者完成代码后，使用本 Checklist 进行自我检查。

### 阶段 2：自动化检查

运行自动化脚本：

```bash
# 完整检查
pnpm run review

# 或分步检查
pnpm typecheck
pnpm lint
pnpm test --coverage
pnpm lint:architecture  # 如果已实现
```

### 阶段 3：人工评审

至少一名其他开发者进行代码审查，重点关注：

- 架构设计合理性
- 业务逻辑正确性
- 潜在风险识别
- 改进建议

### 阶段 4：验收测试

- 功能测试
- 性能测试
- 集成测试
- 用户验收

---

## 评审结果记录

### 评审表单

**模块名称**：`_____________`  
**评审人员**：`_____________`  
**评审日期**：`_____________`

| 类别       | 检查项       | 状态            | 备注 |
| ---------- | ------------ | --------------- | ---- |
| 模块级别   | 职责单一性   | ☐ 通过 ☐ 不通过 |      |
| 模块级别   | 依赖关系清晰 | ☐ 通过 ☐ 不通过 |      |
| 模块级别   | 接口定义完整 | ☐ 通过 ☐ 不通过 |      |
| 代码级别   | 类型安全     | ☐ 通过 ☐ 不通过 |      |
| 代码级别   | 错误处理     | ☐ 通过 ☐ 不通过 |      |
| 代码级别   | 资源清理     | ☐ 通过 ☐ 不通过 |      |
| 功能完整性 | 核心功能可用 | ☐ 通过 ☐ 不通过 |      |
| 架构质量   | 分层清晰     | ☐ 通过 ☐ 不通过 |      |
| 代码质量   | ESLint通过   | ☐ 通过 ☐ 不通过 |      |
| 测试覆盖   | 覆盖率 > 80% | ☐ 通过 ☐ 不通过 |      |
| 文档       | 文档完整     | ☐ 通过 ☐ 不通过 |      |

**总体评价**：☐ 通过 ☐ 需改进 ☐ 不合格

**改进建议**：

```
1.
2.
3.
```

**下一步行动**：

```
- [ ] 修复问题 A
- [ ] 优化性能 B
- [ ] 补充文档 C
```

---

## 快速参考

### 必须通过的检查（阻塞性）

| 检查项              | 命令                               |
| ------------------- | ---------------------------------- |
| TypeScript 类型检查 | `pnpm typecheck`                   |
| ESLint 检查         | `pnpm lint`                        |
| 单元测试            | `pnpm test`                        |
| 无循环依赖          | `npx madge --circular src/main/ai` |

### 推荐通过的检查

| 检查项     | 标准    |
| ---------- | ------- |
| 测试覆盖率 | > 80%   |
| 函数长度   | < 50 行 |
| 圈复杂度   | < 10    |
| 模块依赖数 | < 10    |

---

## 版本历史

| 版本  | 日期       | 变更内容 |
| ----- | ---------- | -------- |
| 1.0.0 | 2026-02-05 | 初始版本 |

---

## 相关文档

- [架构规范](./13-architecture-standards.md)
- [代码风格指南](../README.md)
- [测试指南](../../test/README.md)
