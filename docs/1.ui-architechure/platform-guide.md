# Platform 工具函数使用指南

## 📋 概述

`platform.ts` 提供了跨平台的系统信息获取和操作功能。

---

## 📁 文件结构

```
src/
├── main/
│   └── common/
│       ├── platform.ts     # 平台相关工具函数
│       └── index.ts        # 统一导出
└── shared/
    └── types.ts            # 类型定义
```

---

## 🚀 快速开始

```typescript
import {
  getAppVersion,
  getDeviceInfo,
  getCPUUsage,
  getMemoryUsage,
  getDiskSpace,
  selectDirectory,
  selectFiles,
  restartApp,
  getHardwareSerialNumbers,
  getMachineId
} from '@main/common';

// 获取应用版本
const version = await getAppVersion();

// 获取设备信息
const deviceInfo = await getDeviceInfo();

// 获取 CPU 使用率
const cpuUsage = await getCPUUsage();

// 获取内存使用情况
const memInfo = await getMemoryUsage();

// 获取磁盘空间
const diskInfo = await getDiskSpace();

// 选择目录
const dirResult = await selectDirectory();

// 选择文件
const fileResult = await selectFiles({
  filters: [{ name: 'Images', extensions: ['png', 'jpg'] }],
  multiple: true
});

// 重启应用
await restartApp();
```

---

## 📚 API 文档

### getAppVersion()

```typescript
async function getAppVersion(): Promise<string>;
```

获取应用版本号。

### getDeviceInfo()

```typescript
async function getDeviceInfo(): Promise<DeviceInfo>;
```

获取设备信息，包括平台、架构、CPU、内存等。

### getCPUUsage()

```typescript
async function getCPUUsage(): Promise<number>;
```

获取 CPU 使用率（0-100），采样时间 100ms。

### getMemoryUsage()

```typescript
async function getMemoryUsage(): Promise<MemoryInfo>;
```

获取内存使用情况。

### getDiskSpace()

```typescript
async function getDiskSpace(): Promise<DiskInfo>;
```

获取磁盘空间信息（跨平台）。

### selectDirectory()

```typescript
async function selectDirectory(): Promise<{ canceled: boolean; filePaths: string[] }>;
```

打开目录选择对话框。

### selectFiles(options?)

```typescript
async function selectFiles(options?: {
  filters?: { name: string; extensions: string[] }[];
  multiple?: boolean;
}): Promise<{ canceled: boolean; filePaths: string[] }>;
```

打开文件选择对话框。

### restartApp()

```typescript
async function restartApp(): Promise<void>;
```

重启应用程序。

### getHardwareSerialNumbers()

```typescript
async function getHardwareSerialNumbers(): Promise<HardwareSerialNumbers>;
```

获取硬件序列号信息，包括 CPU ID、主板序列号、机器 UUID 等。

**跨平台支持**：

- **Windows**: 通过 `wmic` 命令获取完整信息
- **macOS**: 通过 `system_profiler` 获取系统序列号和 UUID
- **Linux**: 通过系统文件获取（部分功能需要 root 权限）

### getMachineId()

```typescript
async function getMachineId(): Promise<string>;
```

获取机器唯一标识符（SHA256 哈希）。综合多个硬件信息生成稳定的机器指纹，用于设备识别和授权验证。

---

## 💡 使用示例

### 示例 1：系统信息面板

```typescript
import { getAppVersion, getDeviceInfo, getCPUUsage, getMemoryUsage, getDiskSpace } from '@main/common';

async function getSystemInfo(): Promise<void> {
  const [version, deviceInfo, cpuUsage, memInfo, diskInfo] = await Promise.all([
    getAppVersion(),
    getDeviceInfo(),
    getCPUUsage(),
    getMemoryUsage(),
    getDiskSpace()
  ]);

  console.log('=== System Information ===');
  console.log(`App Version: ${version}`);
  console.log(`Platform: ${deviceInfo.platform}`);
  console.log(`CPU Usage: ${cpuUsage.toFixed(2)}%`);
  console.log(
    `Memory: ${(memInfo.used / 1024 / 1024 / 1024).toFixed(2)} GB / ${(memInfo.total / 1024 / 1024 / 1024).toFixed(2)} GB`
  );
}
```

### 示例 2：IPC Handler

```typescript
import { ipcMain } from 'electron';
import { getAppVersion, getDeviceInfo, selectFiles } from '@main/common';

ipcMain.handle('platform:getVersion', () => getAppVersion());
ipcMain.handle('platform:getDeviceInfo', () => getDeviceInfo());
ipcMain.handle('platform:selectFiles', (_event, options) => selectFiles(options));
```

### 示例 3：性能监控

```typescript
import { getCPUUsage, getMemoryUsage } from '@main/common';

setInterval(async () => {
  const [cpuUsage, memInfo] = await Promise.all([getCPUUsage(), getMemoryUsage()]);

  console.log(`CPU: ${cpuUsage.toFixed(2)}%, Memory: ${((memInfo.used / memInfo.total) * 100).toFixed(2)}%`);
}, 5000);
```

### 示例 4：设备识别和授权

```typescript
import { getHardwareSerialNumbers, getMachineId } from '@main/common';

// 获取硬件序列号
async function getDeviceIdentity() {
  const serialNumbers = await getHardwareSerialNumbers();

  console.log('Hardware Serial Numbers:', {
    platform: serialNumbers.platform,
    cpuId: serialNumbers.cpuId,
    boardSerial: serialNumbers.boardSerial,
    machineUUID: serialNumbers.machineUUID,
    diskSerial: serialNumbers.diskSerial
  });

  // 获取稳定的机器指纹（用于授权验证）
  const machineId = await getMachineId();
  console.log('Machine ID:', machineId);

  return { serialNumbers, machineId };
}

// 用于软件激活验证
async function validateLicense(licenseKey: string) {
  const machineId = await getMachineId();

  // 将 machineId 发送到服务器验证授权
  const response = await fetch('https://api.example.com/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ licenseKey, machineId })
  });

  return response.json();
}
```

---

## 📊 类型定义

```typescript
// src/shared/types.ts

export interface DeviceInfo {
  platform: string;
  arch: string;
  cpuModel: string;
  totalMemory: number;
  osVersion: string;
  osVersionMetadata: Array<{ name: string; build: number }>;
}

export interface MemoryInfo {
  total: number;
  free: number;
  used: number;
}

export interface DiskInfo {
  total: number;
  free: number;
  used: number;
}

export interface HardwareSerialNumbers {
  cpuId?: string;
  boardSerial?: string;
  machineUUID?: string;
  diskSerial?: string;
  platform: string;
}
```

---

## 🎯 最佳实践

1. **错误处理**

```typescript
try {
  const diskInfo = await getDiskSpace();
} catch (error) {
  console.error('Failed to get disk space:', error);
}
```

2. **性能优化**

- `getCPUUsage()` 需要 100ms 采样时间，不要频繁调用
- 建议监控间隔 >= 5 秒

3. **跨平台兼容**

- `getDiskSpace()` 在不同平台使用不同命令
- Windows 和 Unix-like 系统的实现已自动处理
- `getHardwareSerialNumbers()` 在不同平台获取不同的硬件信息

4. **隐私和权限**

- 获取硬件序列号可能需要管理员权限（Linux）
- 某些平台可能无法获取完整的硬件信息
- 建议在用户协议中说明硬件信息的使用目的

---

## 🔐 硬件序列号说明

### Windows 平台

- ✅ CPU ProcessorId
- ✅ 主板序列号
- ✅ 机器 UUID
- ✅ 硬盘序列号

### macOS 平台

- ✅ 系统序列号
- ✅ 硬件 UUID
- ✅ CPU 品牌信息
- ❌ 硬盘序列号（需要额外权限）

### Linux 平台

- ⚠️ CPU 序列号（部分设备支持）
- ✅ Machine ID
- ✅ 主板序列号（需要 root 权限）
- ❌ 硬盘序列号（需要额外工具）

### 使用建议

1. **机器指纹生成**
   - 使用 `getMachineId()` 获取稳定的机器标识
   - 该方法综合多个硬件信息，避免单一信息丢失导致标识变化

2. **软件授权验证**
   - 将 `machineId` 绑定到许可证
   - 在服务器端验证机器 ID 和许可证的匹配关系

3. **设备管理**
   - 使用硬件序列号追踪设备
   - 记录设备激活历史
