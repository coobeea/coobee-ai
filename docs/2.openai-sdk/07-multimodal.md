# 07 - 多模态

> 来源：`examples/basic/local-image.ts`, `basic/remote-image.ts`, `basic/local-file.ts`, `basic/remote-pdf.ts`, `basic/file-tool-output.ts`, `basic/image-tool-output.ts`

## 概述

Agent 可以处理图片和文件等非文本内容。SDK 支持多种方式传入多模态数据：直接作为用户输入、通过工具返回。

## 发送图片给 Agent

### 本地图片（Base64）

```typescript
import { Agent, run } from '@openai/agents';
import fs from 'fs';

function imageToBase64(filePath: string): string {
  return fs.readFileSync(filePath).toString('base64');
}

const agent = new Agent({
  name: 'Vision Agent',
  instructions: 'You describe images in detail.'
});

const b64Image = imageToBase64('./photo.jpg');

const result = await run(agent, [
  {
    role: 'user',
    content: [
      {
        type: 'input_image',
        image: `data:image/jpeg;base64,${b64Image}`,
        providerData: {
          detail: 'auto' // 'auto' | 'low' | 'high'
        }
      }
    ]
  },
  {
    role: 'user',
    content: 'What do you see in this image?'
  }
]);

console.log(result.finalOutput);
```

### 远程图片（URL）

```typescript
const url = 'https://images.unsplash.com/photo-1505761671935-60b3a7427bad';

const result = await run(agent, [
  {
    role: 'user',
    content: [
      {
        type: 'input_image',
        image: url,
        providerData: {
          detail: 'auto'
        }
      }
    ]
  },
  {
    role: 'user',
    content: 'What do you see in this image?'
  }
]);
```

### detail 参数

| 值       | 说明         | Token 消耗 |
| -------- | ------------ | ---------- |
| `'auto'` | 模型自动选择 | 中等       |
| `'low'`  | 低分辨率分析 | 最少       |
| `'high'` | 高分辨率分析 | 最多       |

## 发送文件给 Agent

### 本地文件（Base64）

```typescript
function fileToBase64(filePath: string): string {
  return fs.readFileSync(filePath).toString('base64');
}

const b64File = fileToBase64('./document.pdf');

const result = await run(agent, [
  {
    role: 'user',
    content: [
      {
        type: 'input_file',
        file: `data:application/pdf;base64,${b64File}`,
        providerData: {
          filename: 'document.pdf'
        }
      }
    ]
  },
  {
    role: 'user',
    content: 'What is the first sentence of the introduction?'
  }
]);
```

### 远程文件（URL）

```typescript
const url = 'https://www.example.com/report.pdf';

const result = await run(agent, [
  {
    role: 'user',
    content: [
      {
        type: 'input_file',
        file: url
      }
    ]
  },
  {
    role: 'user',
    content: 'Can you summarize this document?'
  }
]);
```

## 工具返回图片

工具可以返回图片，Agent 会理解并描述图片：

```typescript
import { Agent, run, tool, ToolOutputImage } from '@openai/agents';
import { z } from 'zod';

const fetchRandomImage = tool({
  name: 'fetch_random_image',
  description: 'Return a sample image for the model to describe.',
  parameters: z.object({}),
  execute: async (): Promise<ToolOutputImage> => {
    return {
      type: 'image',
      image: 'https://images.unsplash.com/photo-1505761671935-60b3a7427bad',
      detail: 'auto'
    };
  }
});

const agent = new Agent({
  name: 'Image Agent',
  instructions: 'Call the tool and describe the image.',
  tools: [fetchRandomImage]
});
```

## 工具返回文件

工具可以返回二进制文件，如 PDF：

```typescript
import { Agent, run, tool, ToolOutputFileContent } from '@openai/agents';
import { z } from 'zod';

const fetchDocument = tool({
  name: 'fetch_document',
  description: 'Fetch a PDF document.',
  parameters: z.object({ topic: z.string() }),
  execute: async ({ topic }): Promise<ToolOutputFileContent> => {
    const pdfPath = path.join(__dirname, 'documents', `${topic}.pdf`);
    return {
      type: 'file',
      file: {
        data: fs.readFileSync(pdfPath),
        mediaType: 'application/pdf',
        filename: `${topic}.pdf`
      }
    };
  }
});
```

### ToolOutputFileContent 结构

```typescript
interface ToolOutputFileContent {
  type: 'file';
  file: {
    data: Buffer; // 文件二进制数据
    mediaType: string; // MIME 类型
    filename: string; // 文件名
  };
}
```

### ToolOutputImage 结构

```typescript
interface ToolOutputImage {
  type: 'image';
  image: string; // URL 或 base64 数据 URI
  detail?: 'auto' | 'low' | 'high';
}
```

## 工具返回多模态内容

工具也可以返回混合内容（文本 + 图片）：

```typescript
const fetchImageData = tool({
  name: 'fetch_image_data',
  description: 'Fetch image with metadata.',
  parameters: z.object({ label: z.string() }),
  execute: async ({ label }) => {
    return [
      { type: 'text', text: `Fetched the sample image for "${label}".` },
      {
        type: 'image',
        image: imageDataUrl,
        providerData: { filename: 'sample.jpg' }
      }
    ];
  }
});
```

## 输入格式总结

| 数据类型 | 输入方式 | type 字段     | 数据格式                          |
| -------- | -------- | ------------- | --------------------------------- |
| 本地图片 | 用户输入 | `input_image` | `data:image/jpeg;base64,...`      |
| 远程图片 | 用户输入 | `input_image` | HTTP URL                          |
| 本地文件 | 用户输入 | `input_file`  | `data:application/pdf;base64,...` |
| 远程文件 | 用户输入 | `input_file`  | HTTP URL                          |
| 图片     | 工具返回 | `image`       | URL 或 data URI                   |
| 文件     | 工具返回 | `file`        | Buffer + mediaType                |

## 最佳实践

1. **大文件用 URL** — 避免 base64 编码增加体积
2. **图片设置合适的 detail** — `low` 节省 token，`high` 提高精度
3. **文件设置正确的 mediaType** — 帮助模型理解文件类型
4. **结合工具使用** — 工具动态获取文件比预加载更灵活

## 下一步

- 生命周期钩子 → [08-lifecycle-hooks.md](./08-lifecycle-hooks.md)
- 工具系统详解 → [03-tools.md](./03-tools.md)
