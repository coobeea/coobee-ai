# Coobee AI VS Code Extension

VS Code 扩展，用于与 Coobee AI 智能体系统集成。

## 功能特性

- 🔌 连接到 Coobee AI 服务器
- 💬 与智能体对话
- 📝 提交任务到 Tavern 调度系统
- 📊 查看系统状态

## 安装

1. 打开 VS Code
2. 进入扩展面板 (Ctrl+Shift+X)
3. 搜索 "Coobee AI"
4. 点击安装

## 配置

在 VS Code 设置中配置以下选项：

- `coobee.serverUrl`: Coobee AI 服务器地址（默认：`http://localhost:13888`）
- `coobee.apiKey`: API 密钥
- `coobee.autoConnect`: 是否自动连接（默认：`true`）

## 使用方法

### 连接服务器

1. 按 `Ctrl+Shift+P` 打开命令面板
2. 输入 "Coobee: Connect to Agent Server"
3. 等待连接成功提示

### 与智能体对话

1. 按 `Ctrl+Shift+P`
2. 输入 "Coobee: Chat with Agent"
3. 在打开的面板中输入消息

### 提交任务

1. 选中代码（可选）
2. 按 `Ctrl+Shift+P`
3. 输入 "Coobee: Submit Task to Tavern"
4. 输入任务描述
5. 等待提交确认

## 开发

```bash
# 安装依赖
npm install

# 编译
npm run compile

# 监听模式
npm run watch

# 打包
vsce package
```

## 许可证

MIT
