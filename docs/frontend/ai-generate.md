# AI 生成组件和指令使用指南

本文档介绍如何使用 coobee-ai 提供的 AI 生成能力。

## 概述

coobee-ai 提供两种方式来为 UI 添加 AI 生成能力：

1. **AIGenerate 无渲染组件** - 通过 slot 提供完全自定义的 UI
2. **v-ai-generate 指令** - 让任何元素一键添加 AI 生成功能

两者都基于统一的 Agent 架构（`quick-chat`），支持轻量模式，不会创建持久化工作空间。

---

## 方式一：AIGenerate 无渲染组件

### 基本用法

```vue
<script setup lang="ts">
import { ref } from 'vue';
import AIGenerate from '@/components/common/AIGenerate.vue';

const taskContent = ref('');
const generatedTasks = ref([]);

const handleSuccess = (result: any) => {
  generatedTasks.value = result;
  console.log('生成的任务:', result);
};

const handleError = (error: string) => {
  console.error('生成失败:', error);
};
</script>

<template>
  <AIGenerate
    v-slot="{ isGenerating, trigger, error }"
    agent="task-analyzer"
    :prompt="taskContent"
    :auto-parse-json="true"
    @success="handleSuccess"
    @error="handleError">
    <!-- 完全自定义 UI -->
    <button
      :disabled="isGenerating"
      :class="{ 'opacity-50': isGenerating }"
      class="px-4 py-2 bg-blue-500 text-white rounded"
      @click="trigger">
      {{ isGenerating ? 'AI 生成中...' : 'AI 生成任务' }}
    </button>

    <!-- 显示错误信息 -->
    <p v-if="error" class="mt-2 text-red-500">{{ error }}</p>
  </AIGenerate>
</template>
```

### Props

| 属性            | 类型                                                     | 必填 | 默认值  | 说明                           |
| --------------- | -------------------------------------------------------- | ---- | ------- | ------------------------------ |
| `agent`         | `string`                                                 | 是   | -       | Agent ID，如 `'task-analyzer'` |
| `prompt`        | `string \| (context?: any) => string \| Promise<string>` | 是   | -       | 提示词或提示词构建函数         |
| `autoParseJson` | `boolean`                                                | 否   | `false` | 是否自动解析 JSON 结果         |
| `disabled`      | `boolean`                                                | 否   | `false` | 是否禁用                       |
| `cancelToken`   | `{ cancelled: boolean }`                                 | 否   | -       | 外部取消令牌                   |

### Slot Props

| 属性                 | 类型                                                            | 说明           |
| -------------------- | --------------------------------------------------------------- | -------------- |
| `isGenerating`       | `boolean`                                                       | 是否正在生成   |
| `result`             | `any`                                                           | 生成结果       |
| `error`              | `string \| null`                                                | 错误信息       |
| `accumulatedContent` | `string`                                                        | 累积的文本内容 |
| `generateStatus`     | `'idle' \| 'generating' \| 'success' \| 'error' \| 'cancelled'` | 生成状态       |
| `trigger`            | `(context?: any) => Promise<void>`                              | 触发生成的方法 |
| `cancel`             | `() => void`                                                    | 取消生成的方法 |
| `reset`              | `() => void`                                                    | 重置状态的方法 |

### Events

| 事件       | 参数                  | 说明                       |
| ---------- | --------------------- | -------------------------- |
| `start`    | -                     | 生成开始                   |
| `success`  | `result: any`         | 生成成功                   |
| `error`    | `error: string`       | 生成失败                   |
| `cancel`   | -                     | 生成取消                   |
| `complete` | -                     | 生成完成（无论成功或失败） |
| `output`   | `accumulated: string` | 输出内容更新               |

### 高级用法

#### 1. 动态提示词

```vue
<script setup lang="ts">
import { ref } from 'vue';

const editor = ref<any>(null);

const buildPrompt = (context?: any) => {
  // 动态获取编辑器内容
  return editor.value?.getText() || '';
};
</script>

<template>
  <AIGenerate v-slot="{ trigger, isGenerating }" agent="task-analyzer" :prompt="buildPrompt" @success="handleSuccess">
    <button @click="trigger">分析编辑器内容</button>
  </AIGenerate>
</template>
```

#### 2. 异步提示词

```vue
<script setup lang="ts">
const buildPromptAsync = async () => {
  const data = await fetchSomeData();
  return `分析以下数据：${JSON.stringify(data)}`;
};
</script>

<template>
  <AIGenerate v-slot="{ trigger }" agent="task-analyzer" :prompt="buildPromptAsync" @success="handleSuccess">
    <button @click="trigger">异步分析</button>
  </AIGenerate>
</template>
```

#### 3. 传递上下文

```vue
<template>
  <AIGenerate
    v-slot="{ trigger }"
    agent="task-analyzer"
    :prompt="(context) => `分析任务：${context.taskName}`"
    @success="handleSuccess">
    <!-- trigger 可以传入上下文 -->
    <button @click="trigger({ taskName: '实现登录功能' })">分析任务</button>
  </AIGenerate>
</template>
```

---

## 方式二：v-ai-generate 指令

### 基本用法

```vue
<script setup lang="ts">
import { ref } from 'vue';

const taskContent = ref('实现用户登录功能');
const result = ref(null);

const handleSuccess = (data: any) => {
  result.value = data;
  console.log('生成结果:', data);
};

const handleError = (error: Error) => {
  console.error('生成失败:', error);
};
</script>

<template>
  <!-- 1. 完整配置对象 -->
  <button
    v-ai-generate="{
      agent: 'task-analyzer',
      prompt: taskContent,
      autoParseJson: true,
      onSuccess: handleSuccess,
      onError: handleError
    }">
    AI 生成任务
  </button>
</template>
```

### 简化用法

#### 1. 字符串模式（使用默认 agent）

```vue
<template>
  <!-- 默认使用 task-analyzer -->
  <button v-ai-generate="'根据以下内容生成任务列表'"> AI 生成任务 </button>
</template>
```

#### 2. 数组模式（快速指定 agent）

```vue
<template>
  <button v-ai-generate="['title-generator', '为这段文字生成标题']"> 生成标题 </button>
</template>
```

#### 3. 修饰符模式（通过修饰符指定 agent）

```vue
<template>
  <button v-ai-generate.title-generator="'为这段文字生成标题'"> 生成标题 </button>

  <button v-ai-generate.task-analyzer="'分析这个项目需求'"> 分析任务 </button>
</template>
```

#### 4. 函数提示词（动态获取内容）

```vue
<script setup lang="ts">
import { ref } from 'vue';

const editor = ref<any>(null);

const getEditorContent = () => {
  return editor.value?.getText() || '';
};
</script>

<template>
  <button
    v-ai-generate="{
      agent: 'task-analyzer',
      prompt: getEditorContent,
      onSuccess: handleResult
    }">
    分析编辑器内容
  </button>
</template>
```

### 配置选项

```typescript
interface AIDirectiveConfig {
  agent?: string; // Agent ID，默认 'task-analyzer'
  prompt: string | (() => string | Promise<string>); // 提示词
  autoParseJson?: boolean; // 是否自动解析 JSON，默认 false
  onProgress?: (output: string) => void; // 进度回调
  onSuccess?: (result: any) => void; // 成功回调
  onError?: (error: Error) => void; // 错误回调
  onCancel?: () => void; // 取消回调
}
```

---

## 可用的 Agent

| Agent ID          | 说明         | 输出格式 |
| ----------------- | ------------ | -------- |
| `task-analyzer`   | 任务分析助手 | Markdown |
| `title-generator` | 标题生成器   | 纯文本   |

更多 Agent 请参考 `agents/` 目录。

---

## 最佳实践

### 1. 何时使用 AIGenerate 组件？

- 需要完全自定义 UI（如复杂的表单、卡片）
- 需要显示生成过程（如进度条、实时预览）
- 需要精细控制状态（如禁用、取消、重置）

### 2. 何时使用 v-ai-generate 指令？

- 快速为按钮添加 AI 生成功能
- 简单场景，不需要复杂的 UI 交互
- 代码更简洁，减少模板代码

### 3. JSON 解析

如果 Agent 返回的是 JSON 格式（如 `task-analyzer`），设置 `autoParseJson: true`：

```vue
<AIGenerate agent="task-analyzer" :prompt="content" :auto-parse-json="true" @success="handleSuccess">
  <!-- ... -->
</AIGenerate>
```

解析器会自动提取 markdown 代码块中的 JSON。

### 4. 错误处理

始终提供错误回调：

```vue
<script setup lang="ts">
const handleError = (error: string) => {
  // 显示友好的错误提示
  ElMessage.error(`生成失败: ${error}`);
};
</script>

<template>
  <AIGenerate agent="task-analyzer" :prompt="content" @error="handleError">
    <!-- ... -->
  </AIGenerate>
</template>
```

### 5. 禁用状态

根据业务逻辑动态禁用：

```vue
<script setup lang="ts">
import { computed } from 'vue';

const taskContent = ref('');
const isDisabled = computed(() => !taskContent.value.trim());
</script>

<template>
  <AIGenerate agent="task-analyzer" :prompt="taskContent" :disabled="isDisabled">
    <!-- ... -->
  </AIGenerate>
</template>
```

---

## 示例场景

### 场景 1：任务分析按钮

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage } from 'element-plus';

const taskDescription = ref('');
const analyzedTasks = ref<any[]>([]);

const handleSuccess = (result: any) => {
  analyzedTasks.value = result;
  ElMessage.success('任务分析完成！');
};
</script>

<template>
  <div class="space-y-4">
    <textarea v-model="taskDescription" placeholder="输入任务描述" class="w-full p-3 border rounded" />

    <button
      v-ai-generate="{
        agent: 'task-analyzer',
        prompt: taskDescription,
        autoParseJson: true,
        onSuccess: handleSuccess
      }"
      class="px-4 py-2 bg-blue-500 text-white rounded">
      AI 分析任务
    </button>

    <div v-if="analyzedTasks.length" class="mt-4">
      <h3>分析结果：</h3>
      <ul>
        <li v-for="(task, index) in analyzedTasks" :key="index">
          {{ task.title }}
        </li>
      </ul>
    </div>
  </div>
</template>
```

### 场景 2：标题生成

```vue
<script setup lang="ts">
import { ref } from 'vue';

const content = ref('');
const title = ref('');
</script>

<template>
  <div>
    <textarea v-model="content" placeholder="输入内容" class="w-full p-3 border rounded" />

    <button
      v-ai-generate.title-generator="{
        prompt: `请为以下内容生成标题：\n\n${content}`,
        onSuccess: (result) => {
          title = result;
        }
      }"
      class="mt-2 px-4 py-2 bg-green-500 text-white rounded">
      生成标题
    </button>

    <h2 v-if="title" class="mt-4">{{ title }}</h2>
  </div>
</template>
```

---

## TypeScript 类型

```typescript
// 组件 Props
import type { AIGenerateProps } from '@/components/common/AIGenerate.vue';

// 指令配置
import type { AIDirectiveConfig, AIDirectiveValue } from '@/directives/aiGenerate';
```

---

## 注意事项

1. **Agent ID**：确保传入的 `agent` ID 存在于 `agents/` 目录
2. **提示词**：提示词不能为空，否则会触发错误
3. **JSON 解析**：仅在 Agent 返回 JSON 格式时启用 `autoParseJson`
4. **轻量模式**：所有 AI 生成调用都基于 `quick-chat`，不会创建持久化工作空间
5. **并发限制**：避免同时触发多个 AI 生成任务，可能会影响性能

---

## 常见问题

**Q: 如何取消正在进行的生成？**

A: 使用 AIGenerate 组件的 `cancel` 方法：

```vue
<AIGenerate v-slot="{ trigger, cancel, isGenerating }" ...>
  <button @click="trigger">生成</button>
  <button v-if="isGenerating" @click="cancel">取消</button>
</AIGenerate>
```

**Q: 如何监听生成进度？**

A: 使用 `@output` 事件：

```vue
<AIGenerate @output="(text) => console.log('当前输出:', text)" ...>
  <!-- ... -->
</AIGenerate>
```

**Q: 指令模式下如何监听进度？**

A: 使用 `onProgress` 回调：

```vue
<button
  v-ai-generate="{
    agent: 'task-analyzer',
    prompt: content,
    onProgress: (output) => console.log(output)
  }">
  生成
</button>
```

---

## 相关文档

- [Agent 架构说明](../5.common-architecture/agent-architecture.md)
- [Quick Chat 接口](../api/quick-chat.md)
- [创建自定义 Agent](../agent/create-custom-agent.md)
