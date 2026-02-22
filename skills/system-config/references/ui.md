# UI 配置

## 主题 `ui.theme`

| 值      | 说明             |
| ------- | ---------------- |
| `auto`  | 跟随系统（默认） |
| `light` | 浅色主题         |
| `dark`  | 深色主题         |

### 修改示例

```typescript
config_patch({
  patch: '{"ui": {"theme": "dark"}}',
  description: '切换到深色主题'
});
```

---

## 语言 `ui.language`

界面语言设置，默认 `zh-CN`。

### 支持的语言

- `zh-CN` - 简体中文
- `en-US` - English

### 修改示例

```typescript
config_patch({
  patch: '{"ui": {"language": "en-US"}}',
  description: '切换到英文界面'
});
```

---

## 声音效果 `ui.soundEffects`

是否启用界面音效，默认 `true`。

### 修改示例

```typescript
config_patch({
  patch: '{"ui": {"soundEffects": false}}',
  description: '关闭声音效果'
});
```

---

## 消息队列 `messages.queue`

控制消息队列行为。

| 字段         | 默认值      | 说明                                       |
| ------------ | ----------- | ------------------------------------------ |
| `mode`       | `collect`   | 队列模式: followup/steer/collect/interrupt |
| `debounceMs` | `500`       | 消息防抖延迟（毫秒）                       |
| `cap`        | `20`        | 队列容量上限                               |
| `dropPolicy` | `summarize` | 溢出策略: old/new/summarize                |

### 修改示例

```typescript
config_patch({
  patch: '{"messages": {"queue": {"mode": "interrupt", "debounceMs": 1000}}}',
  description: '调整消息队列为中断模式'
});
```
