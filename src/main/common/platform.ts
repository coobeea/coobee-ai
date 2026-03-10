import type { DeviceInfo, MemoryInfo, DiskInfo } from '@shared/api';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { app, dialog } from 'electron';

const execAsync = promisify(exec);

/**
 * 获取应用版本
 */
export async function getAppVersion(): Promise<string> {
  return app.getVersion();
}

/**
 * 获取设备信息
 */
export async function getDeviceInfo(): Promise<DeviceInfo> {
  const platform = process.platform;
  const osVersion = os.release();

  // 根据不同平台构建版本元数据
  let osVersionMetadata: Array<{ name: string; build: number }> = [];

  if (platform === 'win32') {
    osVersionMetadata = [
      { name: 'Windows 11', build: 22000 },
      { name: 'Windows 10', build: 10240 },
      { name: 'Windows 8.1', build: 9600 },
      { name: 'Windows 8', build: 9200 }
    ];
  } else if (platform === 'darwin') {
    osVersionMetadata = [
      { name: 'macOS Tahoe', build: 25 },
      { name: 'macOS Sequoia', build: 24 },
      { name: 'macOS Sonoma', build: 23 },
      { name: 'macOS Ventura', build: 22 },
      { name: 'macOS Monterey', build: 21 },
      { name: 'macOS Big Sur', build: 20 }
    ];
  }

  return {
    platform,
    arch: process.arch,
    cpuModel: os.cpus()[0].model,
    totalMemory: os.totalmem(),
    osVersion,
    osVersionMetadata
  };
}

/**
 * 获取 CPU 使用率
 * 通过两次采样计算平均 CPU 使用率
 */
export async function getCPUUsage(): Promise<number> {
  const startMeasure = os.cpus().map((cpu) => cpu.times);

  // 等待 100ms 获取有意义的 CPU 使用率测量
  await new Promise((resolve) => setTimeout(resolve, 100));

  const endMeasure = os.cpus().map((cpu) => cpu.times);

  const idleDifferences = endMeasure.map((end, i) => {
    const start = startMeasure[i];
    const idle = end.idle - start.idle;
    const total =
      end.user - start.user + (end.nice - start.nice) + (end.sys - start.sys) + (end.irq - start.irq) + idle;
    return 1 - idle / total;
  });

  // 返回所有核心的平均 CPU 使用率
  return (idleDifferences.reduce((sum, idle) => sum + idle, 0) / idleDifferences.length) * 100;
}

/**
 * 获取内存使用情况
 */
export async function getMemoryUsage(): Promise<MemoryInfo> {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;

  return {
    total,
    free,
    used
  };
}

/**
 * 获取磁盘空间信息
 * Windows 和类 Unix 系统使用不同的命令
 */
export async function getDiskSpace(): Promise<DiskInfo> {
  if (process.platform === 'win32') {
    // Windows 实现
    const { stdout } = await execAsync('wmic logicaldisk get size,freespace');
    const lines = stdout.trim().split('\n').slice(1);
    let total = 0;
    let free = 0;

    lines.forEach((line) => {
      const [freeSpace, size] = line.trim().split(/\s+/).map(Number);
      if (!isNaN(freeSpace) && !isNaN(size)) {
        free += freeSpace;
        total += size;
      }
    });

    return {
      total,
      free,
      used: total - free
    };
  } else {
    // Unix-like 系统实现
    const { stdout } = await execAsync('df -k /');
    const [, line] = stdout.trim().split('\n');
    const [, total, , used, free] = line.split(/\s+/);

    return {
      total: parseInt(total) * 1024,
      free: parseInt(free) * 1024,
      used: parseInt(used) * 1024
    };
  }
}

/**
 * 选择目录
 * @returns 返回所选目录的路径，如果用户取消则返回空数组
 */
export async function selectDirectory(): Promise<{ canceled: boolean; filePaths: string[] }> {
  return dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory']
  });
}

/**
 * 选择文件
 * @param options 文件选择选项
 * @returns 返回所选文件的路径，如果用户取消则返回空数组
 */
export async function selectFiles(options?: {
  filters?: { name: string; extensions: string[] }[];
  multiple?: boolean;
}): Promise<{ canceled: boolean; filePaths: string[] }> {
  const properties: ('openFile' | 'multiSelections')[] = ['openFile'];
  if (options?.multiple) {
    properties.push('multiSelections');
  }
  return dialog.showOpenDialog({
    properties,
    filters: options?.filters
  });
}

/**
 * 重启应用程序
 */
export async function restartApp(): Promise<void> {
  console.log('Restarting application...');
  app.relaunch();
  app.exit();
}

/**
 * 获取硬件序列号信息
 * 返回 CPU ID、主板序列号、机器 UUID 等信息
 */
export async function getHardwareSerialNumbers(): Promise<{
  cpuId?: string;
  boardSerial?: string;
  machineUUID?: string;
  diskSerial?: string;
  platform: string;
}> {
  const platform = process.platform;
  const result: {
    cpuId?: string;
    boardSerial?: string;
    machineUUID?: string;
    diskSerial?: string;
    platform: string;
  } = { platform };

  try {
    if (platform === 'win32') {
      // Windows 平台
      try {
        const { stdout: cpuId } = await execAsync('wmic cpu get ProcessorId');
        result.cpuId = cpuId.split('\n')[1]?.trim();
      } catch {
        // 忽略错误
      }

      try {
        const { stdout: boardSerial } = await execAsync('wmic baseboard get serialnumber');
        result.boardSerial = boardSerial.split('\n')[1]?.trim();
      } catch {
        // 忽略错误
      }

      try {
        const { stdout: uuid } = await execAsync('wmic csproduct get uuid');
        result.machineUUID = uuid.split('\n')[1]?.trim();
      } catch {
        // 忽略错误
      }

      try {
        const { stdout: diskSerial } = await execAsync('wmic diskdrive get serialnumber');
        result.diskSerial = diskSerial.split('\n')[1]?.trim();
      } catch {
        // 忽略错误
      }
    } else if (platform === 'darwin') {
      // macOS 平台
      try {
        const { stdout } = await execAsync('system_profiler SPHardwareDataType');

        // 解析硬件序列号
        const serialMatch = stdout.match(/Serial Number \(system\):\s*(.+)/);
        if (serialMatch) {
          result.boardSerial = serialMatch[1].trim();
        }

        // 解析硬件 UUID
        const uuidMatch = stdout.match(/Hardware UUID:\s*(.+)/);
        if (uuidMatch) {
          result.machineUUID = uuidMatch[1].trim();
        }
      } catch {
        // 忽略错误
      }

      try {
        const { stdout } = await execAsync('sysctl -n machdep.cpu.brand_string');
        result.cpuId = stdout.trim();
      } catch {
        // 忽略错误
      }
    } else {
      // Linux 平台
      try {
        const { stdout } = await execAsync('cat /proc/cpuinfo | grep "Serial"');
        const match = stdout.match(/Serial\s*:\s*(.+)/);
        if (match) {
          result.cpuId = match[1].trim();
        }
      } catch {
        // 忽略错误
      }

      try {
        const { stdout } = await execAsync('cat /etc/machine-id');
        result.machineUUID = stdout.trim();
      } catch {
        // 尝试备选方法
        try {
          const { stdout } = await execAsync('cat /sys/class/dmi/id/product_uuid');
          result.machineUUID = stdout.trim();
        } catch {
          // 忽略错误
        }
      }

      try {
        const { stdout } = await execAsync('cat /sys/class/dmi/id/board_serial');
        result.boardSerial = stdout.trim();
      } catch {
        // 忽略错误
      }
    }
  } catch (error) {
    console.error('Failed to get hardware serial numbers:', error);
  }

  return result;
}

/**
 * 获取机器唯一标识符
 * 综合多个硬件信息生成稳定的机器指纹
 */
export async function getMachineId(): Promise<string> {
  const crypto = await import('crypto');
  const serialNumbers = await getHardwareSerialNumbers();

  // 组合多个硬件信息
  const identifiers = [
    serialNumbers.cpuId,
    serialNumbers.boardSerial,
    serialNumbers.machineUUID,
    serialNumbers.diskSerial,
    serialNumbers.platform,
    os.hostname(),
    os.arch()
  ]
    .filter(Boolean)
    .join('-');

  // 生成 SHA256 哈希作为机器 ID
  return crypto.createHash('sha256').update(identifiers).digest('hex');
}
