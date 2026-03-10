import crypto from 'crypto';
import { app } from 'electron';
import os from 'os';

export class SnowflakeIdGenerator {
  private static readonly MACHINE_ID_BITS = 10;
  private static readonly SEQUENCE_BITS = 12;

  private static readonly MAX_MACHINE_ID = (1 << this.MACHINE_ID_BITS) - 1;
  private static readonly MAX_SEQUENCE = (1 << this.SEQUENCE_BITS) - 1;

  private static readonly MACHINE_ID_SHIFT = this.SEQUENCE_BITS;
  private static readonly TIMESTAMP_SHIFT = this.SEQUENCE_BITS + this.MACHINE_ID_BITS;

  private static readonly EPOCH = 1704067200000;

  private readonly machineId: number;
  private sequence: number = 0;
  private lastTimestamp: number = -1;

  constructor(machineId?: number) {
    if (machineId !== undefined) {
      if (machineId < 0 || machineId > SnowflakeIdGenerator.MAX_MACHINE_ID) {
        throw new Error(`机器ID必须在0到${SnowflakeIdGenerator.MAX_MACHINE_ID}之间`);
      }
      this.machineId = machineId;
    } else {
      this.machineId = this.generateMachineId();
    }
  }

  /**
   * 生成下一个 Snowflake ID（返回 string）
   */
  public nextId(): string {
    let timestamp = this.getCurrentTimestamp();

    if (timestamp < this.lastTimestamp) {
      throw new Error(`时钟回退检测: 当前时间戳${timestamp}小于上一次时间戳${this.lastTimestamp}`);
    }

    if (timestamp === this.lastTimestamp) {
      this.sequence = (this.sequence + 1) & SnowflakeIdGenerator.MAX_SEQUENCE;

      if (this.sequence === 0) {
        timestamp = this.waitNextMillis(this.lastTimestamp);
      }
    } else {
      this.sequence = 0;
    }

    this.lastTimestamp = timestamp;

    const relativeTimestamp = timestamp - SnowflakeIdGenerator.EPOCH;

    const id =
      (BigInt(relativeTimestamp) << BigInt(SnowflakeIdGenerator.TIMESTAMP_SHIFT)) |
      (BigInt(this.machineId) << BigInt(SnowflakeIdGenerator.MACHINE_ID_SHIFT)) |
      BigInt(this.sequence);

    return id.toString();
  }

  /**
   * 生成下一个 Snowflake ID（返回 bigint）
   * @deprecated 推荐使用 nextId() 返回 string
   */
  public nextIdBigInt(): bigint {
    const id = this.nextId();
    return BigInt(id);
  }

  public static parseTimestamp(id: bigint | string): number {
    const bigIntId = typeof id === 'string' ? BigInt(id) : id;
    const relativeTimestamp = bigIntId >> BigInt(this.TIMESTAMP_SHIFT);
    return Number(relativeTimestamp) + this.EPOCH;
  }

  public static parseMachineId(id: bigint | string): number {
    const bigIntId = typeof id === 'string' ? BigInt(id) : id;
    return Number((bigIntId >> BigInt(this.MACHINE_ID_SHIFT)) & BigInt(this.MAX_MACHINE_ID));
  }

  public static parseSequence(id: bigint | string): number {
    const bigIntId = typeof id === 'string' ? BigInt(id) : id;
    return Number(bigIntId & BigInt(this.MAX_SEQUENCE));
  }

  public static parseId(id: bigint | string): {
    id: string;
    timestamp: number;
    date: Date;
    machineId: number;
    sequence: number;
  } {
    const timestamp = this.parseTimestamp(id);
    const machineId = this.parseMachineId(id);
    const sequence = this.parseSequence(id);

    return {
      id: typeof id === 'string' ? id : id.toString(),
      timestamp,
      date: new Date(timestamp),
      machineId,
      sequence
    };
  }

  private getCurrentTimestamp(): number {
    return Date.now();
  }

  private waitNextMillis(lastTimestamp: number): number {
    let timestamp = this.getCurrentTimestamp();
    while (timestamp <= lastTimestamp) {
      timestamp = this.getCurrentTimestamp();
    }
    return timestamp;
  }

  private generateMachineId(): number {
    try {
      const networkInterfaces = os.networkInterfaces();
      let macAddress = '';

      for (const interfaceName in networkInterfaces) {
        const interfaces = networkInterfaces[interfaceName];
        if (interfaces) {
          for (const iface of interfaces) {
            if (!iface.internal && iface.mac !== '00:00:00:00:00:00') {
              macAddress = iface.mac;
              break;
            }
          }
          if (macAddress) break;
        }
      }

      if (!macAddress) {
        macAddress = os.hostname();
      }

      const appPath = app.getPath('exe');

      const combined = `${macAddress}-${appPath}`;

      const hash = crypto.createHash('sha256').update(combined).digest();

      const machineId = hash.readUInt32BE(0) % (SnowflakeIdGenerator.MAX_MACHINE_ID + 1);

      return machineId;
    } catch (error) {
      console.warn('生成机器ID失败，使用随机数:', error);
      return Math.floor(Math.random() * (SnowflakeIdGenerator.MAX_MACHINE_ID + 1));
    }
  }

  public getMachineId(): number {
    return this.machineId;
  }

  public static isValidId(id: string | bigint): boolean {
    try {
      const bigIntId = typeof id === 'string' ? BigInt(id) : id;

      if (bigIntId <= 0) return false;

      const maxValue = (BigInt(1) << BigInt(63)) - BigInt(1);
      if (bigIntId > maxValue) return false;

      const timestamp = this.parseTimestamp(bigIntId);
      const now = Date.now();

      if (timestamp < this.EPOCH || timestamp > now + 86400000) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }
}

let globalGenerator: SnowflakeIdGenerator | null = null;

export function getGlobalSnowflakeGenerator(): SnowflakeIdGenerator {
  if (!globalGenerator) {
    globalGenerator = new SnowflakeIdGenerator();
  }
  return globalGenerator;
}

/**
 * 生成 Snowflake ID（返回 string）
 */
export function generateSnowflakeId(): string {
  return getGlobalSnowflakeGenerator().nextId();
}

/**
 * 生成 Snowflake ID（返回 bigint）
 * @deprecated 推荐使用 generateSnowflakeId() 返回 string
 */
export function generateSnowflakeIdBigInt(): bigint {
  return getGlobalSnowflakeGenerator().nextIdBigInt();
}
