# 工具配置 (Tools)

## 命令超时 `tools.exec.timeout`

`exec` 工具的超时时间（毫秒），默认 `30000` (30秒)。

### 修改示例

```typescript
config_patch({
  patch: '{"tools": {"exec": {"timeout": 60000}}}',
  description: '将命令超时延长到 60 秒'
});
```

---

## 命令黑名单 `tools.exec.blacklist`

禁止执行的命令列表。

### 示例配置

```json5
{
  tools: {
    exec: {
      blacklist: ['rm -rf /', 'dd if=/dev/zero', 'fork bomb']
    }
  }
}
```

### 修改示例

```typescript
config_patch({
  patch: '{"tools": {"exec": {"blacklist": ["rm -rf /", "mkfs"]}}}',
  description: '添加命令黑名单'
});
```

---

## 配置建议

1. **超时设置** - 长时间运行的脚本需要延长超时
2. **黑名单** - 添加危险命令到黑名单
3. **审批配合** - 结合 `security.approvals.exec` 使用
