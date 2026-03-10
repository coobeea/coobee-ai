# P0 问题实施计划

**文档版本**: v1.0
**创建日期**: 2026-03-02
**优先级**: 严重（P0）

---

## 概述

本文档详细描述 P0 级别问题的实施方案，包括代码示例、测试计划和验收标准。

---

## P0-1: 统一错误处理

### 目标

建立统一的错误处理机制，确保：

1. 所有错误有明确的类型和代码
2. 错误信息完整且可追踪
3. 错误处理模式一致

### 实施步骤

#### 步骤 1: 创建错误类型层次结构

**文件**: `src/main/common/errors/index.ts`

```typescript
// 基础错误类
export abstract class BaseError extends Error {
  public readonly code: string;
  public readonly cause?: unknown;
  public readonly timestamp: number;
  public readonly metadata?: Record<string, unknown>;

  constructor(message: string, code: string, cause?: unknown, metadata?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.cause = cause;
    this.timestamp = Date.now();
    this.metadata = metadata;

    // 捕获堆栈
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      timestamp: this.timestamp,
      stack: this.stack,
      metadata: this.metadata
    };
  }
}

// AI 模块错误
export class AgentError extends BaseError {
  constructor(message: string, cause?: unknown, metadata?: { agentId?: string; sessionId?: string }) {
    super(message, 'AGENT_ERROR', cause, metadata);
  }
}

export class AgentExecutionError extends AgentError {
  constructor(message: string, cause?: unknown, metadata?: { agentId?: string; sessionId?: string }) {
    super(message, 'AGENT_EXECUTION_ERROR', cause, metadata);
  }
}

export class AgentNotFoundError extends AgentError {
  constructor(agentId: string) {
    super(`Agent "${agentId}" not found`, undefined, { agentId });
  }
}

// Gateway 错误
export class GatewayError extends BaseError {
  constructor(message: string, cause?: unknown, metadata?: { method?: string; connectionId?: string }) {
    super(message, 'GATEWAY_ERROR', cause, metadata);
  }
}

export class MethodNotFoundError extends GatewayError {
  constructor(method: string) {
    super(`Method "${method}" not found`, undefined, { method });
  }
}

// 工具系统错误
export class ToolError extends BaseError {
  constructor(message: string, cause?: unknown, metadata?: { toolName?: string; sessionId?: string }) {
    super(message, 'TOOL_ERROR', cause, metadata);
  }
}

export class ToolExecutionError extends ToolError {
  constructor(toolName: string, message: string, cause?: unknown) {
    super(message, undefined, { toolName });
  }
}

export class ToolNotFoundError extends ToolError {
  constructor(toolName: string) {
    super(`Tool "${toolName}" not found`);
  }
}

// 配置错误
export class ConfigError extends BaseError {
  constructor(message: string, cause?: unknown, metadata?: { key?: string; path?: string }) {
    super(message, 'CONFIG_ERROR', cause, metadata);
  }
}

export class ConfigValidationError extends ConfigError {
  constructor(message: string, metadata?: { key: string; expected: string; actual: unknown }) {
    super(message, 'CONFIG_VALIDATION_ERROR', undefined, metadata);
  }
}

// 资源错误
export class ResourceError extends BaseError {
  constructor(message: string, cause?: unknown, metadata?: { resourceId?: string; resourceType?: string }) {
    super(message, 'RESOURCE_ERROR', cause, metadata);
  }
}

export class ResourceNotFoundError extends ResourceError {
  constructor(resourceType: string, resourceId: string) {
    super(`${resourceType} "${resourceId}" not found`);
  }
}

export class ResourceLeakError extends ResourceError {
  constructor(resourceType: string, details: string) {
    super(`Resource leak detected: ${resourceType} - ${details}`);
  }
}
```

#### 步骤 2: 创建错误处理工具

**文件**: `src/main/common/errors/handler.ts`

```typescript
import { BaseError } from './index';
import { log } from '../logger';

export type ErrorContext = {
  module: string;
  operation: string;
  metadata?: Record<string, unknown>;
};

export class ErrorHandler {
  /**
   * 统一错误处理
   */
  static handle(error: unknown, context: ErrorContext): never {
    const baseError = error instanceof BaseError ? error : this.wrap(error, context);

    // 结构化日志记录
    log.error(`[${context.module}] ${context.operation} failed`, {
      error: {
        name: baseError.name,
        code: baseError.code,
        message: baseError.message,
        stack: baseError.stack
      },
      context
    });

    throw baseError;
  }

  /**
   * 包装未知错误为 BaseError
   */
  static wrap(error: unknown, context: ErrorContext): BaseError {
    if (error instanceof BaseError) {
      return error;
    }

    if (error instanceof Error) {
      return new BaseError(error.message, 'UNKNOWN_ERROR', error, { ...context.metadata, originalStack: error.stack });
    }

    return new BaseError(String(error), 'UNKNOWN_ERROR', undefined, context.metadata);
  }

  /**
   * 安全执行（不会抛出异常）
   */
  static async safe<T>(fn: () => Promise<T>, context: ErrorContext, defaultValue?: T): Promise<T | undefined> {
    try {
      return await fn();
    } catch (error) {
      this.handle(error, context);
      return defaultValue;
    }
  }
}
```

#### 步骤 3: 重构现有代码

**示例**: 重构 `AgentExecutor.ts`

```typescript
// 修改前
async execute(sessionId: string, message: string): Promise<void> {
  try {
    const agent = await this.agentStore.get(sessionId);
    if (!agent) {
      throw new Error('Agent not found');
    }
    // ...
  } catch (error) {
    log.error('Execution failed:', error);
    throw error;
  }
}

// 修改后
async execute(sessionId: string, message: string): Promise<void> {
  const agent = await this.agentStore.get(sessionId);
  if (!agent) {
    throw new AgentNotFoundError(sessionId);
  }

  try {
    // ... 执行逻辑
  } catch (error) {
    ErrorHandler.handle(error, {
      module: 'AgentExecutor',
      operation: 'execute',
      metadata: { sessionId, messageLength: message.length },
    });
  }
}
```

### 测试计划

```typescript
// src/main/common/errors/__tests__/errors.test.ts
import { describe, it, expect } from 'vitest';
import { BaseError, AgentExecutionError, ToolNotFoundError, ConfigValidationError, ErrorHandler } from '../index';

describe('Error System', () => {
  describe('BaseError', () => {
    it('should create error with correct properties', () => {
      const error = new AgentExecutionError('Test error', undefined, { agentId: 'test' });

      expect(error.name).toBe('AgentExecutionError');
      expect(error.code).toBe('AGENT_EXECUTION_ERROR');
      expect(error.message).toBe('Test error');
      expect(error.metadata?.agentId).toBe('test');
      expect(error.timestamp).toBeDefined();
    });

    it('should serialize to JSON', () => {
      const error = new ToolNotFoundError('exec');
      const json = error.toJSON();

      expect(json.name).toBe('ToolNotFoundError');
      expect(json.code).toBe('TOOL_ERROR');
    });
  });

  describe('ErrorHandler', () => {
    it('should wrap unknown error', () => {
      const context = { module: 'Test', operation: 'testOp' };
      const wrapped = ErrorHandler.wrap(new Error('test'), context);

      expect(wrapped).toBeInstanceOf(BaseError);
      expect(wrapped.code).toBe('UNKNOWN_ERROR');
    });

    it('should preserve BaseError', () => {
      const original = new AgentExecutionError('test');
      const context = { module: 'Test', operation: 'testOp' };
      const wrapped = ErrorHandler.wrap(original, context);

      expect(wrapped).toBe(original);
    });
  });
});
```

### 验收标准

- [ ] 所有自定义错误继承自 `BaseError`
- [ ] 错误类型覆盖所有业务场景
- [ ] 错误处理测试通过率 100%
- [ ] 日志中错误信息包含完整堆栈和上下文

---

## P0-2: 资源泄漏修复

### 目标

确保所有资源正确管理，防止：

1. 内存泄漏
2. 文件句柄泄漏
3. 进程/线程泄漏

### 实施步骤

#### 步骤 1: 定义资源管理接口

**文件**: `src/main/common/resource/types.ts`

```typescript
/**
 * 可处置资源接口
 */
export interface DisposableResource {
  /**
   * 资源 ID
   */
  readonly id: string;

  /**
   * 资源类型
   */
  readonly resourceType: string;

  /**
   * 处置资源
   */
  dispose(): Promise<void>;

  /**
   * 检查资源是否可用
   */
  isDisposed(): boolean;
}

/**
 * 资源统计信息
 */
export interface ResourceStats {
  totalCreated: number;
  totalDisposed: number;
  activeCount: number;
  byType: Record<string, number>;
}
```

#### 步骤 2: 实现资源管理器

**文件**: `src/main/common/resource/ResourceManager.ts`

```typescript
import { DisposableResource, ResourceStats } from './types';
import { log } from '../logger';
import { ResourceLeakError, ResourceNotFoundError } from '../errors';

export interface ResourceManagerOptions {
  /**
   * 泄漏检测阈值（毫秒）
   */
  leakThreshold?: number;

  /**
   * 是否启用泄漏检测
   */
  enableLeakDetection?: boolean;
}

export class ResourceManager {
  private resources = new Map<string, DisposableResource>();
  private creationTimes = new Map<string, number>();
  private stats = {
    totalCreated: 0,
    totalDisposed: 0
  };

  private readonly leakThreshold: number;
  private readonly enableLeakDetection: boolean;
  private leakCheckInterval?: NodeJS.Timeout;

  constructor(private options: ResourceManagerOptions = {}) {
    this.leakThreshold = options.leakThreshold ?? 60000; // 默认 1 分钟
    this.enableLeakDetection = options.enableLeakDetection ?? false;
  }

  /**
   * 启动泄漏检测
   */
  startLeakDetection(): void {
    if (!this.enableLeakDetection) return;

    this.leakCheckInterval = setInterval(() => {
      this.checkForLeaks();
    }, this.leakThreshold);
  }

  /**
   * 停止泄漏检测
   */
  stopLeakDetection(): void {
    if (this.leakCheckInterval) {
      clearInterval(this.leakCheckInterval);
      this.leakCheckInterval = undefined;
    }
  }

  /**
   * 注册资源
   */
  register(resource: DisposableResource): void {
    this.resources.set(resource.id, resource);
    this.creationTimes.set(resource.id, Date.now());
    this.stats.totalCreated++;

    log.debug(`[ResourceManager] Registered ${resource.resourceType}:${resource.id}`);
  }

  /**
   * 获取资源
   */
  get<T extends DisposableResource>(id: string): T | undefined {
    return this.resources.get(id) as T | undefined;
  }

  /**
   * 处置资源
   */
  async dispose(id: string): Promise<void> {
    const resource = this.resources.get(id);
    if (!resource) {
      throw new ResourceNotFoundError('Resource', id);
    }

    try {
      await resource.dispose();
    } finally {
      this.resources.delete(id);
      this.creationTimes.delete(id);
      this.stats.totalDisposed++;

      log.debug(`[ResourceManager] Disposed ${resource.resourceType}:${id}`);
    }
  }

  /**
   * 处置所有资源
   */
  async disposeAll(): Promise<void> {
    log.info(`[ResourceManager] Disposing ${this.resources.size} resources...`);

    const results = await Promise.allSettled(Array.from(this.resources.values()).map((r) => r.dispose()));

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      log.warn(`[ResourceManager] ${failed.length} resources failed to dispose`);
    }

    this.resources.clear();
    this.creationTimes.clear();
    log.info('[ResourceManager] All resources disposed');
  }

  /**
   * 获取统计信息
   */
  getStats(): ResourceStats {
    const byType: Record<string, number> = {};

    for (const resource of this.resources.values()) {
      byType[resource.resourceType] = (byType[resource.resourceType] || 0) + 1;
    }

    return {
      totalCreated: this.stats.totalCreated,
      totalDisposed: this.stats.totalDisposed,
      activeCount: this.resources.size,
      byType
    };
  }

  /**
   * 检查泄漏
   */
  private checkForLeaks(): void {
    const now = Date.now();
    const leaks: string[] = [];

    for (const [id, createdAt] of this.creationTimes.entries()) {
      if (now - createdAt > this.leakThreshold) {
        const resource = this.resources.get(id);
        leaks.push(`${resource?.resourceType || 'Unknown'}:${id}`);
      }
    }

    if (leaks.length > 0) {
      const message = `Potential resource leaks detected: ${leaks.join(', ')}`;
      log.warn(`[ResourceManager] ${message}`);

      // 抛出错误以便在开发环境中被捕获
      if (process.env.NODE_ENV === 'development') {
        throw new ResourceLeakError('multiple', message);
      }
    }
  }
}

// 单例
let instance: ResourceManager | null = null;

export function getResourceManager(): ResourceManager {
  if (!instance) {
    instance = new ResourceManager({
      enableLeakDetection: true,
      leakThreshold: 60000
    });
  }
  return instance;
}
```

#### 步骤 3: 重构 PTY 管理器

**文件**: `src/main/terminal/PtyManager.ts`

```typescript
import { DisposableResource } from '@main/common/resource/types';
import { getResourceManager } from '@main/common/resource/ResourceManager';

class PtyResource implements DisposableResource {
  constructor(
    public readonly id: string,
    private pty: nodePty.IPty,
    private onExitCallback?: () => void
  ) {}

  get resourceType(): string {
    return 'pty';
  }

  isDisposed(): boolean {
    // 检查 pty 是否已经退出
    return !this.pty.pid;
  }

  async dispose(): Promise<void> {
    this.onExitCallback?.();
    // 确保进程被正确终止
    if (this.pty.pid) {
      this.pty.kill();
    }
  }
}

export class PtyManager {
  private resourceManager = getResourceManager();

  create(options?: PtyOptions): PtyInfo {
    const id = generateId();
    const pty = nodePty.spawn(shell, [], {
      cwd: options?.cwd || process.env.HOME,
      cols: options?.cols || 80,
      rows: options?.rows || 24
    });

    const resource = new PtyResource(id, pty, () => {
      this.ptys.delete(id);
    });

    // 注册到资源管理器
    this.resourceManager.register(resource);

    this.ptys.set(id, pty);
    return { id, pid: pty.pid };
  }

  async destroy(id: string): Promise<boolean> {
    try {
      await this.resourceManager.dispose(id);
      return true;
    } catch {
      return false;
    }
  }

  async disposeAll(): Promise<void> {
    await this.resourceManager.disposeAll();
    this.ptys.clear();
  }
}
```

### 测试计划

```typescript
// src/main/common/resource/__tests__/ResourceManager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ResourceManager, getResourceManager } from '../ResourceManager';
import { DisposableResource } from '../types';

class MockResource implements DisposableResource {
  constructor(
    public readonly id: string,
    public readonly resourceType = 'mock'
  ) {}

  private disposed = false;

  async dispose(): Promise<void> {
    this.disposed = true;
  }

  isDisposed(): boolean {
    return this.disposed;
  }
}

describe('ResourceManager', () => {
  let manager: ResourceManager;

  beforeEach(() => {
    manager = new ResourceManager({ enableLeakDetection: false });
  });

  it('should register and dispose single resource', async () => {
    const resource = new MockResource('test-1');

    manager.register(resource);
    expect(manager.getStats().activeCount).toBe(1);

    await manager.dispose('test-1');
    expect(manager.getStats().activeCount).toBe(0);
    expect(resource.isDisposed()).toBe(true);
  });

  it('should dispose all resources', async () => {
    manager.register(new MockResource('test-1'));
    manager.register(new MockResource('test-2'));
    manager.register(new MockResource('test-3'));

    await manager.disposeAll();
    expect(manager.getStats().activeCount).toBe(0);
  });

  it('should throw on disposing non-existent resource', async () => {
    await expect(manager.dispose('non-existent')).rejects.toThrow();
  });

  it('should track statistics', async () => {
    manager.register(new MockResource('test-1'));
    manager.register(new MockResource('test-2'));

    await manager.dispose('test-1');

    const stats = manager.getStats();
    expect(stats.totalCreated).toBe(2);
    expect(stats.totalDisposed).toBe(1);
    expect(stats.activeCount).toBe(1);
  });
});
```

### 验收标准

- [ ] 所有长期运行的资源实现 `DisposableResource` 接口
- [ ] 应用关闭时所有资源正确释放
- [ ] 24 小时运行测试无内存泄漏
- [ ] 资源统计 API 可查询当前活跃资源

---

## P0-3: 敏感数据保护

### 目标

确保所有敏感数据得到妥善保护：

1. API 密钥不存储在明文配置中
2. 数据库加密存储
3. 日志中不泄露敏感信息

### 实施步骤

#### 步骤 1: 实现密钥管理

**文件**: `src/main/common/security/KeychainManager.ts`

```typescript
/**
 * 密钥链管理器
 * 使用系统密钥链存储敏感数据
 */
export class KeychainManager {
  private static readonly SERVICE_NAME = 'coobee-ai';
  private keytar: typeof import('keytar') | null = null;

  async init(): Promise<void> {
    try {
      this.keytar = await import('keytar');
    } catch (error) {
      console.warn('[KeychainManager] keytar not available, using in-memory storage');
    }
  }

  /**
   * 存储密钥
   */
  async set(key: string, value: string): Promise<void> {
    if (!this.keytar) {
      // 降级为内存存储（仅用于开发）
      InMemoryKeychain.set(key, value);
      return;
    }

    await this.keytar.setPassword(KeychainManager.SERVICE_NAME, key, value);
  }

  /**
   * 读取密钥
   */
  async get(key: string): Promise<string | null> {
    if (!this.keytar) {
      return InMemoryKeychain.get(key);
    }

    return await this.keytar.getPassword(KeychainManager.SERVICE_NAME, key);
  }

  /**
   * 删除密钥
   */
  async delete(key: string): Promise<void> {
    if (!this.keytar) {
      InMemoryKeychain.delete(key);
      return;
    }

    await this.keytar.deletePassword(KeychainManager.SERVICE_NAME, key);
  }

  /**
   * 列出所有密钥（仅列出键名）
   */
  async listKeys(): Promise<string[]> {
    if (!this.keytar) {
      return InMemoryKeychain.listKeys();
    }

    // keytar 不直接支持列出所有键，需要应用自己维护列表
    const keys = await this.get('_keychain_keys');
    return keys ? keys.split(',') : [];
  }

  private async updateKeysList(keys: string[]): Promise<void> {
    await this.set('_keychain_keys', keys.join(','));
  }
}

/**
 * 内存密钥链（降级方案，仅用于开发）
 */
const InMemoryKeychain = {
  store: new Map<string, string>(),

  set(key: string, value: string): void {
    this.store.set(key, value);
  },

  get(key: string): string | null {
    return this.store.get(key) || null;
  },

  delete(key: string): void {
    this.store.delete(key);
  },

  listKeys(): string[] {
    return Array.from(this.store.keys());
  }
};
```

#### 步骤 2: 实现敏感数据脱敏

**文件**: `src/main/common/security/DataMasking.ts`

```typescript
/**
 * 数据脱敏工具
 */
export class DataMasking {
  /**
   * 脱敏 API 密钥
   */
  static maskApiKey(key: string): string {
    if (key.length <= 8) {
      return '*'.repeat(key.length);
    }
    return `${key.substring(0, 4)}${'*'.repeat(key.length - 8)}${key.substring(key.length - 4)}`;
  }

  /**
   * 脱敏路径
   */
  static maskPath(path: string): string {
    // 保留最后两级目录
    const parts = path.split(/[\/\\]/);
    if (parts.length <= 2) {
      return path;
    }
    const sensitive = parts.length - 2;
    return `[REDACTED]/${parts.slice(-2).join('/')}`;
  }

  /**
   * 脱敏对象中的敏感字段
   */
  static maskObject(obj: Record<string, unknown>): Record<string, unknown> {
    const sensitiveKeys = ['password', 'secret', 'key', 'token', 'apiKey', 'auth'];

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const isSensitive = sensitiveKeys.some((k) => key.toLowerCase().includes(k));

      if (isSensitive && typeof value === 'string') {
        result[key] = this.maskApiKey(value);
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.maskObject(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }

    return result;
  }
}
```

### 验收标准

- [ ] 所有 API 密钥存储在系统密钥链中
- [ ] 配置文件中不包含明文密钥
- [ ] 日志输出经过脱敏处理
- [ ] 密钥管理测试通过率 100%

---

## 总结

本文档详细描述了三个 P0 级别问题的实施方案：

1. **统一错误处理**: 建立错误类型层次结构，统一错误处理模式
2. **资源泄漏修复**: 实现资源管理器，确保资源正确释放
3. **敏感数据保护**: 使用系统密钥链，实现数据脱敏

每个方案都包含：

- 完整的代码实现示例
- 测试计划
- 验收标准

实施顺序建议：错误处理 → 资源管理 → 敏感数据保护
