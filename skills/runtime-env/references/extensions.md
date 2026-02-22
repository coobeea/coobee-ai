# Extension 系统

## 概述

Extension 是动态可插拔的功能模块，可以注册工具（Tool）、生命周期钩子（Hook）、Gateway 方法、Channel、HTTP 路由和后台服务，还可以贡献 Skill。

---

## Extension 来源（按优先级）

| 优先级    | 来源  | 路径                      | 说明             |
| --------- | ----- | ------------------------- | ---------------- |
| 1（最低） | 内置  | `builtinExtensionsDir`    | 随系统分发，只读 |
| 2         | 用户  | `userExtensionsDir`       | 用户安装/编写    |
| 3（最高） | Agent | `{workspace}/extensions/` | 你自己创建的     |

**同 ID 高优先级覆盖低优先级。** 工作空间级 Extension 会被 `fs.watch` 热加载。

---

## Extension 能力

| 能力                    | 说明                               |
| ----------------------- | ---------------------------------- |
| `registerTool`          | 注册新工具，可被 LLM function call |
| `registerChannel`       | 注册 Channel（对接外部系统）       |
| `registerHttpRoute`     | 注册 HTTP 路由                     |
| `registerService`       | 注册后台服务（长期运行）           |
| `registerGatewayMethod` | 注册 Gateway RPC 方法              |
| `on(hookName)`          | 注册 Agent 生命周期钩子            |
| 声明 `skills`           | 在 manifest 中声明 Skill 目录      |

---

## 创建 Extension

### 最小结构

```
{workspace}/extensions/my-ext/
├── extension.json        # 必须 — 扩展清单
└── index.ts              # 可选 — 代码入口（纯 Skill 扩展可省略）
```

### extension.json 格式

```json
{
  "id": "my-ext",
  "name": "My Extension",
  "version": "1.0.0",
  "description": "扩展描述",
  "skills": "skills"
}
```

### index.ts 代码骨架

```typescript
import type { ExtensionModule } from '@main/common/extension';

export default {
  id: 'my-ext',
  name: 'My Extension',

  register(api) {
    // 注册工具
    api.registerTool({
      name: 'my_tool',
      description: '工具描述',
      parameters: {
        /* ... */
      },
      execute: async (params) => {
        /* ... */
      }
    });

    // 注册生命周期钩子
    api.on('before_agent_start', async (event) => {
      // 在 Agent 启动前执行
    });

    // 注册 Gateway 方法
    api.registerGatewayMethod('myext.hello', async (params) => {
      return { message: 'Hello' };
    });

    // 注册 Channel
    api.registerChannel({
      id: 'my-channel',
      name: 'My Channel',
      gateway: {
        start: async (ctx) => {
          /* ... */
        },
        stop: async (ctx) => {
          /* ... */
        }
      }
    });

    // 注册后台服务
    api.registerService({
      id: 'my-service',
      start: async () => {
        /* ... */
      },
      stop: async () => {
        /* ... */
      }
    });
  }
} as ExtensionModule;
```

---

## 纯 Skill 扩展

如果只需要贡献 Skill（无代码），可以省略 `index.ts`：

```
{workspace}/extensions/my-skill-pack/
├── extension.json        # 声明 skills 字段
└── skills/
    ├── skill-a/SKILL.md
    └── skill-b/SKILL.md
```

---

## 热重载

工作空间级 Extension (`{workspace}/extensions/`) 支持热重载：

1. 创建或修改 Extension 文件
2. 系统自动检测（fs.watch）
3. 卸载旧版本（如果存在）
4. 加载新版本
5. 立即生效

---

## 使用建议

1. **明确需求** - 创建前确认确实需要新的能力
2. **复用优先** - 先检查是否有现成的 Extension
3. **模块化** - 一个 Extension 做一件事
4. **文档完整** - 注释清楚，便于维护
