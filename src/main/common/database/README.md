# 数据库模块

## 概述

本项目提供两个数据库服务，各有特色：

- **SQLiteService**：基于 `better-sqlite3-multiple-ciphers`，适用于 OLTP（事务处理）
- **DuckDBService**：基于 `@duckdb/node-api`，适用于 OLAP（分析处理）

## SQLiteService（单例模式）

### 架构设计

```
SQLiteService (单例)
    ↓
SQLiteConnection
    ↓
better-sqlite3
```

### 特性

- ✅ **单例模式**：全应用共享一个实例
- ✅ **统一初始化**：`InitDatabaseHook` 在应用启动时创建所有数据库服务
- ✅ **统一清理**：`BeforeQuitDatabaseHook` 在应用退出前关闭所有连接
- ✅ **懒加载**：首次查询时才创建数据库连接
- ✅ **WAL 模式**：自动启用，提高并发性能
- ✅ **加密支持**：支持多种加密算法

### 使用方式

```typescript
import { SQLiteService } from '@main/common/database'

// 获取单例实例（无需手动初始化）
const sqlite = SQLiteService.getInstance()

// 查询
const users = await sqlite.query('SELECT * FROM users WHERE age > ?', [18])

// 插入
await sqlite.insert('INSERT INTO users (id, name) VALUES (?, ?)', [sqlite.generateId(), 'John'])

// 更新
await sqlite.update('UPDATE users SET name = ? WHERE id = ?', ['Jane', '123'])

// 删除
await sqlite.delete('DELETE FROM users WHERE id = ?', ['123'])

// 事务
await sqlite.transaction(async (tx) => {
  await tx.insert('INSERT INTO users VALUES (?, ?)', [id, 'John'])
  await tx.insert('INSERT INTO logs VALUES (?, ?)', [logId, 'Created user'])
})
```

### API 参考

**查询方法：**

- `query<T>(sql, params)` - 查询多条
- `queryOne<T>(sql, params)` - 查询单条

**执行方法：**

- `execute(sql, params)` - 执行 SQL
- `insert(sql, params)` - 插入
- `update(sql, params)` - 更新
- `delete(sql, params)` - 删除

**事务方法：**

- `transaction(callback)` - 执行事务

**工具方法：**

- `generateId()` - 生成 Snowflake ID

**单例管理：**

- `initialize(dataPath)` - 初始化单例实例（仅在 InitSQLiteHook 中调用）
- `getInstance()` - 获取单例实例（在应用任何地方调用，无需参数）
- `destroyInstance()` - 销毁单例实例（仅在 BeforeQuitSQLiteHook 中调用）

## DuckDBService

### 特性

- ✅ **OLAP 优化**：列式存储，擅长聚合查询
- ✅ **高性能**：C++ 实现，查询速度快
- ✅ **Parquet/CSV**：原生支持文件导入导出
- ✅ **SQL 标准**：完整的 SQL 支持

### 使用方式

```typescript
import { DuckDBService } from '@main/common/database'

// 获取已初始化的单例实例（无需传参）
const duckdb = DuckDBService.getInstance()

// 日志分析
const stats = await duckdb.query(`
  SELECT 
    date_trunc('hour', timestamp) as hour,
    level,
    COUNT(*) as count
  FROM app_logs
  WHERE timestamp >= NOW() - INTERVAL '24 hours'
  GROUP BY hour, level
`)

// 导出为 Parquet
await duckdb.writeParquet('SELECT * FROM logs', '/path/to/logs.parquet')

// 关闭连接
duckdb.close()
```

### API 参考

**查询方法：**

- `query<T>(sql)` - 查询多条
- `queryOne<T>(sql)` - 查询单条

**执行方法：**

- `execute(sql)` - 执行 SQL

**文件操作：**

- `readParquet(filePath)` - 读取 Parquet
- `writeParquet(sql, outputPath)` - 导出 Parquet
- `readCSV(filePath, options?)` - 读取 CSV
- `writeCSV(sql, outputPath)` - 导出 CSV

**表管理：**

- `showTables()` - 获取所有表
- `describeTable(tableName)` - 查看表结构

**工具方法：**

- `generateId()` - 生成 Snowflake ID
- `close()` - 关闭连接

**单例管理：**

- `initialize(dataPath)` - 初始化单例实例（仅在 InitDatabaseHook 中调用）
- `getInstance()` - 获取单例实例（在应用任何地方调用，无需参数）
- `destroyInstance()` - 销毁单例实例（仅在 BeforeQuitDatabaseHook 中调用）

## 最佳实践

### 1. 选择合适的数据库

```typescript
// ✅ SQLite: 用户配置、应用设置、实时 CRUD
const sqlite = SQLiteService.getInstance()
await sqlite.insert('INSERT INTO user_settings ...')

// ✅ DuckDB: 日志分析、数据统计、复杂查询
const duckdb = DuckDBService.getInstance()
const stats = await duckdb.query('SELECT ... GROUP BY ...')
```

### 2. 参数化查询（防止 SQL 注入）

```typescript
// ✅ 好的
await sqlite.query('SELECT * FROM users WHERE id = ?', [userId])

// ❌ 不好的
await sqlite.query(`SELECT * FROM users WHERE id = '${userId}'`)
```

### 3. 使用事务

```typescript
await sqlite.transaction(async (tx) => {
  await tx.insert('INSERT INTO users ...')
  await tx.insert('INSERT INTO logs ...')
})
```

### 4. 资源管理

```typescript
// SQLite: 无需手动管理，自动清理
const sqlite = SQLiteService.getInstance()

// DuckDB: 需要手动关闭
const duckdb = new DuckDBService(dataPath)
// ... 使用完毕后
duckdb.close()
```

## 生命周期 Hooks

### InitSQLiteHook (INIT 阶段)

- **优先级**: 100
- **关键性**: critical
- **功能**: 创建 SQLiteService 单例实例
- **位置**: `src/main/lifecycle/InitSQLiteHook.ts`

### BeforeQuitSQLiteHook (BEFORE_QUIT 阶段)

- **优先级**: 100
- **关键性**: 非关键
- **功能**: 销毁 SQLiteService 单例，关闭连接
- **位置**: `src/main/lifecycle/BeforeQuitSQLiteHook.ts`

## 文件结构

```
src/main/common/database/
├── SQLiteService.ts       # SQLite 服务（单例）
├── DuckDBService.ts       # DuckDB 服务
└── index.ts              # 统一导出

src/main/lifecycle/
├── InitSQLiteHook.ts           # SQLite 初始化 Hook
└── BeforeQuitSQLiteHook.ts     # SQLite 清理 Hook
```

## 更多信息

- **DuckDB 详细文档**: `DUCKDB_README.md`
- **使用示例**: `USAGE_EXAMPLE.md`
