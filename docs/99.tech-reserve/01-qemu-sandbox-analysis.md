# QEMU 虚拟机沙箱技术储备

> **状态**: 技术储备（未实现）
> **来源**: LobsterAI 项目沙箱架构分析
> **日期**: 2026-02-22

---

## 一、技术概述

QEMU 虚拟机沙箱是一种通过完整虚拟化实现 AI 执行隔离的方案。核心思路是在 QEMU VM 中运行 Alpine Linux + Node.js，通过 9p VirtFS（macOS/Linux）或 virtio-serial（Windows）实现宿主机与 VM 之间的双向通信。

### 三层架构

```
┌──────────────────────────────────────────────────────┐
│  应用层：会话编排 → 沙箱编排 → 资源管理              │
├──────────────────────────────────────────────────────┤
│  虚拟化层：QEMU + HVF/KVM/WHPX + 9p VirtFS + IPC   │
├──────────────────────────────────────────────────────┤
│  客户机层：Alpine Linux + agentd + Node.js Runtime   │
└──────────────────────────────────────────────────────┘
```

### 关键技术要点

1. **硬件加速**: macOS 用 HVF，Windows 用 WHPX，Linux 用 KVM
2. **镜像**: Alpine Linux qcow2 格式，快照模式（重启还原）
3. **通信**: 9p VirtFS 文件系统共享（macOS/Linux），virtio-serial TCP 桥接（Windows）
4. **安全**: 进程隔离 + 内存隔离 + 文件系统隔离 + 网络隔离 + 权限控制

---

## 二、与 coobee-ai 现有沙箱的对比

### 现有沙箱体系（三层模型）

| 模式        | 实现                            | 隔离级别           | 启动时间 | 内存开销 |
| ----------- | ------------------------------- | ------------------ | -------- | -------- |
| `off`       | 无隔离                          | 无                 | 0        | 0        |
| `path-only` | path-guard + tool-policy        | 文件路径边界       | 毫秒级   | 几乎为零 |
| `docker`    | 容器 + path-guard + tool-policy | 容器级（共享内核） | 1-2 秒   | ~100MB   |

### QEMU VM 沙箱对比

| 维度         | path-only  | docker                   | QEMU VM                  |
| ------------ | ---------- | ------------------------ | ------------------------ |
| 隔离级别     | 路径检查   | 容器（共享内核）         | 完全隔离（独立内核）     |
| 抵抗内核漏洞 | 否         | 否                       | 是                       |
| 启动时间     | 毫秒       | 1-2 秒                   | 5-30 秒                  |
| 内存开销     | ~0         | ~100MB                   | 2-4 GB                   |
| 跨平台       | 好         | 一般（需 Docker Daemon） | 好（QEMU 全平台）        |
| 文件共享性能 | 原生       | bind mount（好）         | 9p/virtio-serial（中等） |
| 适合场景     | 常规 Agent | 中等安全                 | 执行不可信代码           |

### 结论

QEMU VM 沙箱提供了最高级别的隔离，但代价是启动时间和内存开销显著增加。适合：

- 执行用户提交的不可信代码
- 高安全要求的生产环境
- 恶意软件分析

**不适合**当前 coobee-ai 的常规 Agent 交互场景（对响应速度敏感）。

---

## 三、与 WorkerManager 外接进程模式的结合分析

### 当前 WorkerManager 模式

coobee-ai 的 `WorkerManager`（`src/main/common/worker/`）管理外接子进程：

- **类型**: `python`（venv + uv）或 `native`（原生二进制）
- **通信**: HTTP 服务（`127.0.0.1:port`），健康检查 `/health`
- **生命周期**: 注册 → 初始化 → 启动 → 健康检查 → 就绪 → 停止
- **现有 Worker**: tts、asr、brain、ocr、tavern

### QEMU 作为 Worker 的可行性

理论上可以将 QEMU VM 作为一种特殊的 Worker 类型：

```typescript
// 假想的 worker.json
{
  "name": "sandbox-vm",
  "type": "qemu",           // 新增类型
  "imagePath": "linux.qcow2",
  "memoryMb": 2048,
  "cpus": 2,
  "port": 18200,            // VM 内的 HTTP 服务端口
  "healthCheckPath": "/health",
  "autoStart": false         // 按需启动
}
```

### 挑战

1. **启动时间**: Worker 期望秒级启动，QEMU VM 需要 5-30 秒
2. **资源占用**: 每个 VM 需要 2-4GB 内存，不适合常开
3. **文件共享**: 需要 9p VirtFS / virtio-serial 桥接，比 HTTP API 复杂
4. **镜像管理**: 需要下载和维护 qcow2 镜像（~200MB-1GB）
5. **QEMU 分发**: macOS 需要打包 QEMU 二进制 + dylib，Windows 需要 NSIS 安装

### 可行方案

如果未来需要实现，推荐分阶段：

1. **Phase 1**: 新增 `WorkerConfig.type = 'qemu'`，`WorkerManager` 支持启动 QEMU 进程
2. **Phase 2**: 构建 Alpine Linux 镜像（含 Node.js + agentd HTTP 服务）
3. **Phase 3**: 实现 IPC 桥接（9p VirtFS 优先，Windows 降级 virtio-serial）
4. **Phase 4**: 集成到 sandbox 模式（`security.sandbox.mode = 'qemu'`）

---

## 四、技术风险和依赖

| 风险                     | 影响                                   | 缓解措施                             |
| ------------------------ | -------------------------------------- | ------------------------------------ |
| QEMU 二进制分发复杂      | macOS 需 dylibbundler，Windows 需 NSIS | 参考 LobsterAI 的 build-runtime 脚本 |
| VM 启动慢                | 用户体验差                             | 后台预热 + 快照模式                  |
| 内存占用大               | 低配机器不可用                         | 动态调整 VM 内存（2-8GB）            |
| Windows 9p 不支持        | 需要 virtio-serial 替代方案            | 代码量翻倍                           |
| Apple Silicon 需额外内核 | ARM64 镜像构建复杂                     | 使用 GRUB + UEFI 引导                |
| Hypervisor entitlement   | macOS 需 codesign                      | 构建时自动签名                       |

---

## 五、参考资料

- **LobsterAI 源码**: https://github.com/netease-youdao/LobsterAI
- **QEMU 官方文档**: https://www.qemu.org/docs/
- **9p VirtFS 协议规范**: https://wiki.qemu.org/Documentation/9pfilesys
- **Alpine Linux 构建指南**: https://wiki.alpinelinux.org/wiki/Release_Engineering
- **原始分析文档**: `/Users/lifeng/git/git_agents/LobsterAI/QEMU_SANDBOX_ANALYSIS.md`

---

## 六、核心代码参考

### QEMU 启动参数

```typescript
const args = [
  '-m',
  '4096', // 4GB 内存
  '-smp',
  '2', // 2 核 CPU
  '-nographic', // 无图形界面
  '-snapshot', // 快照模式（重启还原）
  '-accel',
  getPreferredAccel(), // hvf / whpx / kvm
  '-drive',
  `file=${imagePath},if=virtio,format=qcow2`,
  '-netdev',
  'user,id=net0',
  '-device',
  'virtio-net,netdev=net0',
  '-virtfs',
  `local,path=${ipcDir},mount_tag=ipc,security_model=none`
];
```

### 心跳检测

```typescript
async function waitForVmReady(ipcDir: string, timeoutMs = 60000): Promise<void> {
  const heartbeatPath = path.join(ipcDir, 'heartbeat');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(heartbeatPath)) {
      const heartbeat = JSON.parse(fs.readFileSync(heartbeatPath, 'utf-8'));
      if (Date.now() - heartbeat.timestamp < 5000) return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('VM failed to start within timeout');
}
```

### 路径遍历防护

```typescript
function resolveHostPath(relativePath: string, hostCwd: string): string | null {
  const normalized = relativePath.replace(/\//g, path.sep);
  const resolved = path.resolve(hostCwd, normalized);
  const resolvedCwd = path.resolve(hostCwd);
  if (!resolved.startsWith(resolvedCwd + path.sep) && resolved !== resolvedCwd) {
    return null; // 路径遍历攻击，拒绝
  }
  return resolved;
}
```
