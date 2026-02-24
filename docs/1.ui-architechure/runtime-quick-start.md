# Runtime 快速开始

## ✅ 已完成的工作

- ✅ 路径管理系统（已集成到 `env.ts`）
- ✅ 自动下载脚本（`download-uv.mjs`）
- ✅ 打包配置（`electron-builder.yml`）
- ✅ Linux 二进制已下载

---

## 🚀 立即使用

### 方案 1：等待自动下载完成

```bash
# 下载正在后台进行，可以等待完成
# 或者重新运行（会跳过已下载的）
pnpm install
```

### 方案 2：手动下载当前平台（macOS ARM64）

```bash
cd /Users/lifeng/git/git_agents/coobee-ai/runtime/macos-arm64

# 下载（约 35MB）
curl -L -O https://github.com/astral-sh/uv/releases/download/0.7.13/uv-aarch64-apple-darwin.tar.gz

# 解压
tar -xzf uv-aarch64-apple-darwin.tar.gz
mv uv-aarch64-apple-darwin/uv .
rm -rf uv-aarch64-apple-darwin uv-aarch64-apple-darwin.tar.gz

# 给予执行权限
chmod +x uv

# 复制到开发目录
cp uv ../macos/

# 验证
./uv --version
```

### 方案 3：使用代理下载

```bash
# 设置代理（根据你的代理配置）
export http_proxy=http://127.0.0.1:7890
export https_proxy=http://127.0.0.1:7890

# 重新下载
pnpm install
```

---

## 📋 使用示例

下载完成后，在代码中使用：

```typescript
import { Env } from '@main/common';
import path from 'path';
import { exec } from 'child_process';

// 获取 uv 路径
const uvPath = path.join(Env.getPlatformRuntimeDir(), process.platform === 'win32' ? 'uv.exe' : 'uv');

// 执行命令
exec(`"${uvPath}" --version`, (error, stdout) => {
  console.log(stdout); // uv 0.7.13
});
```

---

## 🔍 检查下载状态

```bash
# 查看已下载的文件
ls -lh runtime/*/uv*

# 查看目录结构
tree -L 2 runtime/

# 测试 uv 是否可用
runtime/macos/uv --version
```

---

## 📦 完整性检查

所有平台都下载完成后：

```bash
ls -1 runtime/*/uv* | wc -l
# 应该输出 5（5 个平台）
```

---

**当前状态**: 基础设施完成，部分二进制已下载  
**下一步**: 等待下载完成或手动补充缺失的平台
