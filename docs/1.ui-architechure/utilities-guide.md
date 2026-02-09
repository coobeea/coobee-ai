# 工具库使用指南

## 📦 已安装的工具库（24个）

---

## 🌐 网络请求

### axios `^1.13.4`

强大的 HTTP 客户端库

```typescript
import axios from 'axios'

// 基础用法
const response = await axios.get('https://api.example.com/data')

// 配置实例
const api = axios.create({
  baseURL: 'https://api.example.com',
  timeout: 5000,
  headers: { Authorization: 'Bearer token' }
})

// 拦截器
api.interceptors.request.use((config) => {
  console.log('请求发送:', config.url)
  return config
})

api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    console.error('请求失败:', error)
    return Promise.reject(error)
  }
)
```

---

## 🔧 工具函数

### lodash `^4.17.23`

JavaScript 工具函数库

```typescript
import _ from 'lodash'

// 数组操作
_.chunk([1, 2, 3, 4, 5], 2) // [[1, 2], [3, 4], [5]]
_.uniq([1, 2, 1, 3, 2]) // [1, 2, 3]

// 对象操作
_.pick({ a: 1, b: 2, c: 3 }, ['a', 'c']) // { a: 1, c: 3 }
_.omit({ a: 1, b: 2, c: 3 }, ['b']) // { a: 1, c: 3 }

// 防抖和节流
const debouncedFn = _.debounce(() => {
  console.log('执行')
}, 300)

const throttledFn = _.throttle(() => {
  console.log('执行')
}, 1000)

// 深克隆
const cloned = _.cloneDeep(originalObject)
```

### dayjs `^1.11.19`

轻量级日期处理库（Moment.js 的现代替代品）

```typescript
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

// 格式化
dayjs().format('YYYY-MM-DD HH:mm:ss') // "2026-02-04 12:30:45"

// 相对时间
dayjs().fromNow() // "几秒前"
dayjs().add(7, 'day').fromNow() // "7天后"

// 日期操作
dayjs().add(1, 'month') // 加一个月
dayjs().subtract(1, 'year') // 减一年
dayjs().startOf('month') // 月初
dayjs().endOf('month') // 月末

// 比较
dayjs('2026-01-01').isBefore(dayjs()) // true
dayjs('2026-12-31').isAfter(dayjs()) // true
```

---

## 🆔 ID 生成

### nanoid `^5.1.6`

生成唯一的字符串 ID

```typescript
import { nanoid } from 'nanoid'

// 默认 21 字符
const id = nanoid() // "V1StGXR8_Z5jdHi6B-myT"

// 自定义长度
const shortId = nanoid(10) // "IRFa-VaY2b"

// 自定义字母表
import { customAlphabet } from 'nanoid'
const nanoid10 = customAlphabet('0123456789', 10)
const numericId = nanoid10() // "4968329012"
```

---

## 📝 文本处理

### diff `^8.0.3`

文本差异对比

```typescript
import * as Diff from 'diff'

const oldText = 'Hello World'
const newText = 'Hello JavaScript'

// 字符差异
const charDiff = Diff.diffChars(oldText, newText)

// 单词差异
const wordDiff = Diff.diffWords(oldText, newText)

// 行差异
const lineDiff = Diff.diffLines(oldCode, newCode)

// 渲染差异
charDiff.forEach((part) => {
  if (part.added) console.log('+', part.value)
  else if (part.removed) console.log('-', part.value)
  else console.log(' ', part.value)
})
```

### gray-matter `^4.0.3`

解析 Front Matter（Markdown 文件头部元数据）

```typescript
import matter from 'gray-matter'

const markdown = `---
title: 我的文章
author: 张三
date: 2026-02-04
tags:
  - JavaScript
  - Vue
---

# 文章内容

这是正文...
`

const { data, content } = matter(markdown)

console.log(data.title) // "我的文章"
console.log(data.author) // "张三"
console.log(content) // "# 文章内容\n\n这是正文..."
```

### jsonrepair `^3.13.2`

修复损坏的 JSON

```typescript
import { jsonrepair } from 'jsonrepair'

// 修复缺少引号
const fixed1 = jsonrepair('{name: "John"}') // '{"name":"John"}'

// 修复尾随逗号
const fixed2 = jsonrepair('{"a":1,}') // '{"a":1}'

// 修复单引号
const fixed3 = jsonrepair("{'a':1}") // '{"a":1}'

// 解析修复后的 JSON
const obj = JSON.parse(jsonrepair(brokenJson))
```

---

## ✅ Schema 验证

### zod `^4.3.6`

TypeScript 优先的 Schema 验证库

```typescript
import { z } from 'zod'

// 定义 Schema
const UserSchema = z.object({
  id: z.string(),
  name: z.string().min(2).max(50),
  email: z.string().email(),
  age: z.number().min(18).max(120),
  role: z.enum(['admin', 'user']),
  tags: z.array(z.string()).optional()
})

// 推断类型
type User = z.infer<typeof UserSchema>

// 验证数据
try {
  const user = UserSchema.parse({
    id: '123',
    name: '张三',
    email: 'zhang@example.com',
    age: 25,
    role: 'user'
  })
  console.log('验证成功:', user)
} catch (error) {
  console.error('验证失败:', error.errors)
}

// 安全解析（不抛出异常）
const result = UserSchema.safeParse(data)
if (result.success) {
  console.log('数据:', result.data)
} else {
  console.error('错误:', result.error)
}
```

---

## 🔢 Token 计数

### tokenx `^1.3.0`

计算文本的 Token 数量（用于 AI API）

```typescript
import { encode, decode, countTokens } from 'tokenx'

const text = 'Hello, how are you?'

// 编码
const tokens = encode(text)
console.log(tokens) // [15496, 11, 703, 527, 499, 30]

// 解码
const decoded = decode(tokens)
console.log(decoded) // "Hello, how are you?"

// 计算 Token 数量
const count = countTokens(text)
console.log(count) // 6
```

---

## 📂 文件系统

### fs-ext `^2.1.1`

文件系统扩展（原生模块）

```typescript
import fs from 'fs-ext'

// 文件锁
const fd = fs.openSync('file.txt', 'r+')
fs.flockSync(fd, 'ex') // 排他锁
// ... 执行操作
fs.flockSync(fd, 'un') // 解锁
fs.closeSync(fd)

// Seek 操作
fs.seekSync(fd, 0, 'SEEK_SET') // 移动到文件开头
```

### mkdirp `^3.0.1`

递归创建目录

```typescript
import { mkdirp } from 'mkdirp'

// 创建多级目录
await mkdirp('path/to/nested/directory')

// 同步方式
mkdirp.sync('path/to/another/directory')
```

### glob `^13.0.1`

文件匹配模式

```typescript
import { glob } from 'glob'

// 查找所有 TypeScript 文件
const files = await glob('src/**/*.ts')
console.log(files)
// ['src/main.ts', 'src/utils/helper.ts', ...]

// 排除某些目录
const files2 = await glob('src/**/*.ts', {
  ignore: ['**/node_modules/**', '**/dist/**']
})

// 同步方式
import { globSync } from 'glob'
const files3 = globSync('**/*.vue')
```

### minimatch `^10.1.2`

最小文件匹配库

```typescript
import { minimatch } from 'minimatch'

// 检查文件是否匹配模式
minimatch('foo.js', '*.js') // true
minimatch('foo.ts', '*.js') // false
minimatch('src/utils/a.ts', '**/*.ts') // true

// 过滤文件列表
const files = ['a.js', 'b.ts', 'c.vue']
const jsFiles = files.filter((f) => minimatch(f, '*.js'))
```

### chokidar `^5.0.0`

文件监听库

```typescript
import chokidar from 'chokidar'

// 监听文件变化
const watcher = chokidar.watch('src/**/*.ts', {
  ignored: /(^|[\/\\])\../, // 忽略点文件
  persistent: true
})

watcher
  .on('add', (path) => console.log(`文件添加: ${path}`))
  .on('change', (path) => console.log(`文件修改: ${path}`))
  .on('unlink', (path) => console.log(`文件删除: ${path}`))
  .on('error', (error) => console.error(`监听错误: ${error}`))

// 停止监听
watcher.close()
```

---

## 🗜️ 压缩/解压

### fflate `^0.8.2`

快速压缩库

```typescript
import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'fflate'

// 压缩字符串
const text = 'Hello, World! '.repeat(100)
const compressed = gzipSync(strToU8(text))
console.log(`原始: ${text.length} bytes`)
console.log(`压缩: ${compressed.length} bytes`)

// 解压
const decompressed = strFromU8(gunzipSync(compressed))
console.log(decompressed === text) // true

// Zip 文件
import { zipSync, unzipSync } from 'fflate'

const zipped = zipSync({
  'file1.txt': strToU8('Content 1'),
  'file2.txt': strToU8('Content 2')
})

const unzipped = unzipSync(zipped)
```

---

## ⏱️ 定时任务

### node-cron `^4.2.1`

Cron 定时任务

```typescript
import cron from 'node-cron'

// 每分钟执行
cron.schedule('* * * * *', () => {
  console.log('每分钟执行一次')
})

// 每天凌晨 2 点执行
cron.schedule('0 2 * * *', () => {
  console.log('每天凌晨 2 点执行')
})

// 每周一上午 9 点
cron.schedule('0 9 * * 1', () => {
  console.log('每周一上午 9 点执行')
})

// 可控制的任务
const task = cron.schedule(
  '*/10 * * * * *',
  () => {
    console.log('每 10 秒执行')
  },
  {
    scheduled: false
  }
)

task.start() // 开始
task.stop() // 停止
task.destroy() // 销毁
```

**Cron 表达式格式:**

```
* * * * * *
┬ ┬ ┬ ┬ ┬ ┬
│ │ │ │ │ │
│ │ │ │ │ └─ 星期几 (0-7, 0 和 7 都表示周日)
│ │ │ │ └─── 月份 (1-12)
│ │ │ └───── 日期 (1-31)
│ │ └─────── 小时 (0-23)
│ └───────── 分钟 (0-59)
└─────────── 秒 (0-59, 可选)
```

---

## 📡 事件 & 通信

### events `^3.3.0`

Node.js 事件模块

```typescript
import { EventEmitter } from 'events'

class MyEmitter extends EventEmitter {}

const emitter = new MyEmitter()

// 监听事件
emitter.on('event', (data) => {
  console.log('事件触发:', data)
})

// 一次性监听
emitter.once('onceEvent', () => {
  console.log('只执行一次')
})

// 触发事件
emitter.emit('event', { message: 'Hello' })
emitter.emit('onceEvent')

// 移除监听
const handler = () => console.log('处理')
emitter.on('test', handler)
emitter.off('test', handler)
```

### mitt `^3.0.1`

轻量级事件发射器（200 bytes）

```typescript
import mitt from 'mitt'

type Events = {
  'user:login': { userId: string }
  'user:logout': void
  'message:new': { text: string }
}

const emitter = mitt<Events>()

// 监听
emitter.on('user:login', ({ userId }) => {
  console.log('用户登录:', userId)
})

// 触发
emitter.emit('user:login', { userId: '123' })

// 监听所有事件
emitter.on('*', (type, data) => {
  console.log('事件:', type, data)
})

// 移除监听
const handler = () => {}
emitter.on('user:logout', handler)
emitter.off('user:logout', handler)

// 清除所有监听
emitter.all.clear()
```

---

## 🚀 进程管理

### cross-spawn `^7.0.6`

跨平台进程创建

```typescript
import spawn from 'cross-spawn'

// 执行命令
const child = spawn('npm', ['install'], {
  stdio: 'inherit'
})

child.on('close', (code) => {
  console.log(`进程退出，代码: ${code}`)
})

// 捕获输出
const result = spawn('git', ['status'], {
  encoding: 'utf8'
})

let output = ''
result.stdout.on('data', (data) => {
  output += data
})

result.on('close', () => {
  console.log('输出:', output)
})
```

---

## 🌐 后端服务 (Koa)

### Koa 框架 `^3.1.1`

```typescript
import Koa from 'koa'
import Router from '@koa/router'
import cors from '@koa/cors'
import bodyParser from 'koa-bodyparser'
import serve from 'koa-static'

const app = new Koa()
const router = new Router()

// 中间件
app.use(cors())
app.use(bodyParser())
app.use(serve('public'))

// 错误处理
app.use(async (ctx, next) => {
  try {
    await next()
  } catch (err) {
    ctx.status = err.status || 500
    ctx.body = { error: err.message }
  }
})

// 路由
router.get('/api/hello', (ctx) => {
  ctx.body = { message: 'Hello World' }
})

router.post('/api/data', (ctx) => {
  const data = ctx.request.body
  ctx.body = { success: true, data }
})

router.get('/api/users/:id', (ctx) => {
  const { id } = ctx.params
  ctx.body = { userId: id }
})

// 使用路由
app.use(router.routes())
app.use(router.allowedMethods())

// 启动服务器
const PORT = 3000
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
```

### Koa 完整示例

```typescript
import Koa from 'koa'
import Router from '@koa/router'
import cors from '@koa/cors'
import bodyParser from 'koa-bodyparser'

const app = new Koa()
const router = new Router({ prefix: '/api' })

// 全局中间件
app.use(
  cors({
    origin: '*',
    credentials: true
  })
)

app.use(bodyParser())

// 日志中间件
app.use(async (ctx, next) => {
  const start = Date.now()
  await next()
  const ms = Date.now() - start
  console.log(`${ctx.method} ${ctx.url} - ${ms}ms`)
})

// RESTful API
router
  .get('/users', async (ctx) => {
    // 查询所有用户
    ctx.body = { users: [] }
  })
  .get('/users/:id', async (ctx) => {
    // 查询单个用户
    const { id } = ctx.params
    ctx.body = { user: { id } }
  })
  .post('/users', async (ctx) => {
    // 创建用户
    const data = ctx.request.body
    ctx.status = 201
    ctx.body = { user: data }
  })
  .put('/users/:id', async (ctx) => {
    // 更新用户
    const { id } = ctx.params
    const data = ctx.request.body
    ctx.body = { user: { id, ...data } }
  })
  .delete('/users/:id', async (ctx) => {
    // 删除用户
    const { id } = ctx.params
    ctx.status = 204
  })

app.use(router.routes())
app.use(router.allowedMethods())

export default app
```

---

## 📝 使用建议

### 1. 性能优化

- ✅ 使用 `lodash` 的按需导入: `import debounce from 'lodash/debounce'`
- ✅ `dayjs` 按需加载插件
- ✅ `chokidar` 设置合理的 `ignored` 选项避免监听过多文件

### 2. 类型安全

```typescript
// 为事件定义类型
type MyEvents = {
  'user:login': { userId: string }
  'data:update': { id: number; data: any }
}

const emitter = mitt<MyEvents>()

// TypeScript 会检查类型
emitter.emit('user:login', { userId: '123' }) // ✅
emitter.emit('user:login', { id: 123 }) // ❌ 类型错误
```

### 3. 错误处理

```typescript
// Axios 错误处理
try {
  const response = await axios.get('/api/data')
} catch (error) {
  if (axios.isAxiosError(error)) {
    console.error('HTTP错误:', error.response?.status)
    console.error('消息:', error.message)
  }
}

// Zod 错误处理
const result = schema.safeParse(data)
if (!result.success) {
  result.error.errors.forEach((err) => {
    console.error(`${err.path}: ${err.message}`)
  })
}
```

---

## 📚 参考资源

- [Axios 文档](https://axios-http.com/)
- [Lodash 文档](https://lodash.com/)
- [Day.js 文档](https://day.js.org/)
- [Zod 文档](https://zod.dev/)
- [Node-cron 文档](https://github.com/node-cron/node-cron)
- [Mitt 文档](https://github.com/developit/mitt)
- [Koa 文档](https://koajs.com/)
- [Chokidar 文档](https://github.com/paulmillr/chokidar)

---

**文档生成时间**: 2026-02-04  
**状态**: ✅ 工具库配置完成
