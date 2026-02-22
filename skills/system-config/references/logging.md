# 日志配置 (Logging)

## 日志级别 `logging.level`

控制日志输出的详细程度，默认 `info`。

| 值      | 说明                       |
| ------- | -------------------------- |
| `debug` | 最详细，包含调试信息       |
| `info`  | 标准，包含一般信息（默认） |
| `warn`  | 警告，只记录警告和错误     |
| `error` | 错误，只记录错误           |

### 修改示例

```typescript
config_patch({
  patch: '{"logging": {"level": "debug"}}',
  description: '启用调试日志'
});
```

---

## 文件输出 `logging.file`

是否将日志写入文件，默认 `true`。

### 修改示例

```typescript
config_patch({
  patch: '{"logging": {"file": false}}',
  description: '禁用日志文件输出'
});
```

---

## 使用建议

1. **调试问题** - 临时设置为 `debug` 级别
2. **性能优化** - 生产环境可设置为 `warn` 减少 I/O
3. **日志文件** - 建议保持开启，便于事后分析
4. **磁盘空间** - 注意日志文件大小，定期清理
