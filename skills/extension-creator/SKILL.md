---
name: extension-creator
description: 指导 Agent 创建新的 Extension 扩展。当用户要求创建扩展、注册新工具、添加生命周期钩子、或需要动态增强系统能力时使用。
---

# Extension Creator

## 什么是 Extension

Extension 是动态可插拔的功能模块，可以在运行时加载和卸载。
Extension 可以注册以下能力：

| 能力                    | 说明                                      |
| ----------------------- | ----------------------------------------- |
| `registerTool`          | 注册新工具，LLM 可通过 function call 调用 |
| `on(hookName)`          | 注册 Agent 生命周期钩子                   |
| `registerGatewayMethod` | 注册 Gateway RPC 方法                     |
| 声明 `skills`           | 贡献 Skill 目录                           |

## 何时创建 Extension

- 用户要求注册新的 function calling 工具
- 需要在 Agent 生命周期特定阶段执行自定义逻辑
- 需要向 Gateway 暴露新的 RPC 方法
- 需要同时贡献工具和 Skill 的组合功能包

## Extension vs Skill

| 维度     | Skill                  | Extension            |
| -------- | ---------------------- | -------------------- |
| 本质     | 自然语言操作手册       | 代码模块             |
| 格式     | Markdown (SKILL.md)    | TypeScript + JSON    |
| 注册     | 无需注册，文件发现即可 | 需要 register() 注册 |
| 能力     | 指导 Agent 行动        | 注册工具、钩子、方法 |
| 适用场景 | 操作流程、知识文档     | 系统能力扩展         |

**原则**：能用 Skill 解决的用 Skill，需要注册系统能力（工具、钩子）时用 Extension。

## 创建步骤

### 1. 确定存放位置

| 场景                   | 路径                               |
| ---------------------- | ---------------------------------- |
| 仅当前会话（热加载）   | `{workspace}/extensions/{ext-id}/` |
| 所有会话可用（用户级） | `{userExtensionsDir}/{ext-id}/`    |

优先使用工作空间级。工作空间目录下的 Extension 会被自动热加载。

### 2. 创建 extension.json

这是 Extension 的清单文件，必须包含 `id`、`name`、`version`：

```json
{
  "id": "my-extension",
  "name": "My Extension",
  "version": "1.0.0",
  "description": "这个扩展做什么",
  "skills": "skills"
}
```

字段说明：

| 字段          | 必须 | 说明                               |
| ------------- | ---- | ---------------------------------- |
| `id`          | 是   | 唯一标识，建议 kebab-case          |
| `name`        | 是   | 显示名称                           |
| `version`     | 是   | 语义化版本号                       |
| `description` | 否   | 描述                               |
| `skills`      | 否   | Skill 目录路径（相对于扩展根目录） |

### 3. 创建 index.ts（代码入口）

```typescript
import type { ExtensionApi } from '@main/common/extension';

export default {
  id: 'my-extension',
  name: 'My Extension',
  register(api: ExtensionApi) {
    // 在这里注册能力
  }
};
```

`register` 函数接收一个 `ExtensionApi` 对象，支持以下方法：

#### registerTool — 注册工具

```typescript
api.registerTool({
  name: 'my_tool',
  description: '工具描述',
  category: 'extension',
  parameters: {
    type: 'object',
    properties: {
      input: { type: 'string', description: '输入参数' }
    },
    required: ['input']
  },
  execute: async (params) => {
    return `处理结果: ${params.input}`;
  }
});
```

#### on — 注册生命周期钩子

可用的 Hook：

| Hook 名称             | 模式      | 说明                    |
| --------------------- | --------- | ----------------------- |
| `before_agent_start`  | modifying | 注入上下文 / 替换提示词 |
| `agent_end`           | void      | Agent 执行完成          |
| `before_tool_call`    | modifying | 修改参数 / 阻止调用     |
| `after_tool_call`     | void      | 工具执行后              |
| `tool_result_persist` | modifying | 修改持久化结果          |
| `message_received`    | void      | 收到用户消息            |
| `session_start`       | void      | 会话开始                |
| `session_end`         | void      | 会话结束                |

**modifying 钩子**可以返回修改数据：

```typescript
api.on('before_agent_start', async (event) => {
  return {
    prependContext: '额外上下文信息...'
  };
});

api.on(
  'before_tool_call',
  async (event) => {
    if (event.toolName === 'dangerous_tool') {
      return { block: true, blockReason: '该工具当前被禁用' };
    }
    return { params: { ...event.params, extra: 'value' } };
  },
  { priority: 10 }
);
```

**void 钩子**用于观察/记录：

```typescript
api.on('agent_end', async (event) => {
  console.log(`Agent 完成: ${event.success}, 耗时: ${event.durationMs}ms`);
});
```

#### registerGatewayMethod — 注册 RPC 方法

```typescript
api.registerGatewayMethod('myext.status', async (params) => {
  return { status: 'running', uptime: process.uptime() };
});
```

注意：方法名必须包含 `.`（命名空间），不能使用 `system.` 前缀（保留给系统）。

### 4. 贡献 Skill（可选）

在 `extension.json` 中声明 `"skills": "skills"`，然后创建对应目录：

```
my-extension/
├── extension.json
├── index.ts
└── skills/
    ├── skill-a/SKILL.md
    └── skill-b/SKILL.md
```

### 5. 纯 Skill 扩展

如果只需要贡献 Skill 而不需要代码，可以省略 `index.ts`：

```
my-skill-pack/
├── extension.json    # 声明 skills 字段即可
└── skills/
    └── my-skill/SKILL.md
```

## 完整示例

创建一个翻译扩展，包含工具和 Skill：

### extension.json

```json
{
  "id": "translate-helper",
  "name": "Translation Helper",
  "version": "1.0.0",
  "description": "提供翻译工具和翻译流程指导",
  "skills": "skills"
}
```

### index.ts

```typescript
import type { ExtensionApi } from '@main/common/extension';

export default {
  id: 'translate-helper',
  name: 'Translation Helper',
  register(api: ExtensionApi) {
    api.registerTool({
      name: 'translate_text',
      description: '将文本翻译为目标语言',
      category: 'extension',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要翻译的文本' },
          targetLang: { type: 'string', description: '目标语言（如 en, zh, ja）' }
        },
        required: ['text', 'targetLang']
      },
      execute: async (params) => {
        // 实际翻译逻辑
        return `[翻译结果] ${params.text} → ${params.targetLang}`;
      }
    });

    api.on('after_tool_call', async (event) => {
      api.logger.info(`工具 ${event.toolName} 执行完成，耗时 ${event.durationMs}ms`);
    });
  }
};
```

### skills/translate-guide/SKILL.md

```markdown
---
name: Translation Guide
description: 翻译项目的工作流程指导。当需要翻译文档或代码注释时使用。
---

# 翻译指南

## 操作步骤

1. 使用 translate_text 工具进行翻译
2. 检查翻译结果的准确性
3. 保持专业术语一致
```

## 验证

Extension 创建后：

1. 确认 `extension.json` 格式正确
2. 如果有 `index.ts`，确认导出了 `id`、`name`、`register` 函数
3. 如果声明了 `skills`，确认目录存在且包含 `SKILL.md`
4. 在工作空间级创建的 Extension 会被自动热加载（`fs.watch`），等待加载确认
5. 告知用户 Extension 已创建、加载状态、注册了哪些能力

## 安全注意事项

- Extension 中的 `execute` 函数在主进程中运行，要注意安全
- 避免在 Extension 中读写敏感文件
- 工具名称不能与内置工具冲突
- Gateway 方法不能使用 `system.` 前缀
