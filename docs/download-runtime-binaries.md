# Runtime 二进制下载指南

## 📦 当前状态

✅ **已下载：**

- Linux x64 (42MB)
- Linux ARM64 (35MB)

⏳ **下载中/待下载：**

- macOS x64
- macOS ARM64
- Windows x64

---

## 🚀 方案 A：自动下载（推荐）

### 正常执行

```bash
pnpm install
```

**如果网络慢或超时：**

- 脚本会自动重试 3 次
- 失败的平台会跳过，不影响其他平台
- 可以稍后手动补充

---

## 🔧 方案 B：手动下载（网络不稳定时）

### macOS ARM64

```bash
# 1. 下载
cd runtime/macos-arm64
curl -L -O https://github.com/astral-sh/uv/releases/download/0.7.13/uv-aarch64-apple-darwin.tar.gz

# 2. 解压
tar -xzf uv-aarch64-apple-darwin.tar.gz

# 3. 移动
mv uv-aarch64-apple-darwin/uv .
rm -rf uv-aarch64-apple-darwin uv-aarch64-apple-darwin.tar.gz

# 4. 给予执行权限
chmod +x uv
```

### macOS x64

```bash
cd runtime/macos-x64
curl -L -O https://github.com/astral-sh/uv/releases/download/0.7.13/uv-x86_64-apple-darwin.tar.gz
tar -xzf uv-x86_64-apple-darwin.tar.gz
mv uv-x86_64-apple-darwin/uv .
rm -rf uv-x86_64-apple-darwin uv-x86_64-apple-darwin.tar.gz
chmod +x uv
```

### Windows x64

```bash
cd runtime/win
curl -L -O https://github.com/astral-sh/uv/releases/download/0.7.13/uv-x86_64-pc-windows-msvc.zip
# Windows: 使用 7-Zip 或其他工具解压
```

---

## 🌍 方案 C：使用镜像源

### 设置环境变量

```bash
# 使用国内镜像（如果有）
export UV_MIRROR_URL="https://your-mirror.com/uv/releases/download/0.7.13"

# 重新运行
pnpm install
```

---

## 🎯 当前平台快速开始

你在 macOS ARM64，可以直接下载：

```bash
cd /Users/lifeng/git/git_agents/coobee-ai/runtime/macos-arm64

# 下载
curl -L -O https://github.com/astral-sh/uv/releases/download/0.7.13/uv-aarch64-apple-darwin.tar.gz

# 解压
tar -xzf uv-aarch64-apple-darwin.tar.gz

# 移动
mv uv-aarch64-apple-darwin/uv .

# 清理
rm -rf uv-aarch64-apple-darwin uv-aarch64-apple-darwin.tar.gz

# 给予执行权限
chmod +x uv

# 复制到开发目录
cp uv ../macos/

# 验证
./uv --version
```

---

## ✅ 验证下载结果

```bash
# 检查所有平台
ls -lh runtime/*/uv*

# 应该看到：
# runtime/linux-x64/uv (42MB) ✓
# runtime/linux-arm64/uv (35MB) ✓
# runtime/macos-arm64/uv (~35MB)
# runtime/macos-x64/uv (~42MB)
# runtime/win/uv.exe (~40MB)
```

---

## 📝 下载链接

直接下载地址（uv 0.7.13）：

| 平台        | 下载链接                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------- |
| macOS ARM64 | https://github.com/astral-sh/uv/releases/download/0.7.13/uv-aarch64-apple-darwin.tar.gz      |
| macOS x64   | https://github.com/astral-sh/uv/releases/download/0.7.13/uv-x86_64-apple-darwin.tar.gz       |
| Linux x64   | https://github.com/astral-sh/uv/releases/download/0.7.13/uv-x86_64-unknown-linux-gnu.tar.gz  |
| Linux ARM64 | https://github.com/astral-sh/uv/releases/download/0.7.13/uv-aarch64-unknown-linux-gnu.tar.gz |
| Windows x64 | https://github.com/astral-sh/uv/releases/download/0.7.13/uv-x86_64-pc-windows-msvc.zip       |

---

**提示**: 如果 GitHub 访问慢，建议使用代理或手动下载。
