import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorHandler } from '../ErrorHandler';
import { CoobeeError } from '../CoobeeError';
import { ErrorCode } from '../ErrorCodes';

describe('ErrorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('normalize', () => {
    it('应该保留 CoobeeError', () => {
      const original = new CoobeeError({
        code: ErrorCode.FILE_NOT_FOUND,
        message: 'Test file not found'
      });

      const normalized = ErrorHandler.normalize(original);

      expect(normalized).toBe(original);
    });

    it('应该转换原生 Error', () => {
      const error = new Error('Test error');
      const normalized = ErrorHandler.normalize(error);

      expect(normalized).toBeInstanceOf(CoobeeError);
      expect(normalized.message).toBe('Test error');
      expect(normalized.code).toBe(ErrorCode.UNKNOWN_ERROR);
    });

    it('应该转换 Node.js 系统错误', () => {
      const error: NodeJS.ErrnoException = new Error('File not found');
      error.code = 'ENOENT';

      const normalized = ErrorHandler.normalize(error);

      expect(normalized).toBeInstanceOf(CoobeeError);
      expect(normalized.code).toBe(ErrorCode.FILE_NOT_FOUND);
    });

    it('应该转换字符串错误', () => {
      const error = 'Something went wrong';
      const normalized = ErrorHandler.normalize(error);

      expect(normalized).toBeInstanceOf(CoobeeError);
      expect(normalized.message).toBe('Something went wrong');
    });

    it('应该转换对象错误', () => {
      const error = { message: 'Object error', code: 500 };
      const normalized = ErrorHandler.normalize(error);

      expect(normalized).toBeInstanceOf(CoobeeError);
      expect(normalized.message).toContain('Object error');
    });
  });

  describe('handle', () => {
    it('应该处理错误并返回 CoobeeError', () => {
      const error = new Error('Test error');
      const result = ErrorHandler.handle(error, { logError: false });

      expect(result).toBeInstanceOf(CoobeeError);
    });

    it('应该记录可重试的错误', () => {
      const error = new CoobeeError({
        code: ErrorCode.NETWORK_TIMEOUT,
        message: 'Network timeout'
      });

      const result = ErrorHandler.handle(error, {
        logError: false,
        shouldRetry: true
      });

      expect(result.retriable).toBe(true);
    });
  });

  describe('withRetry', () => {
    it('应该在成功时不重试', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await ErrorHandler.withRetry(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('应该重试可重试的错误', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(
          new CoobeeError({
            code: ErrorCode.NETWORK_TIMEOUT,
            message: 'Timeout'
          })
        )
        .mockRejectedValueOnce(
          new CoobeeError({
            code: ErrorCode.NETWORK_TIMEOUT,
            message: 'Timeout'
          })
        )
        .mockResolvedValue('success');

      const result = await ErrorHandler.withRetry(fn, {
        maxRetries: 3,
        retryDelay: 10
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    }, 10000);

    it('应该在不可重试的错误时立即失败', async () => {
      const error = new CoobeeError({
        code: ErrorCode.FILE_NOT_FOUND,
        message: 'File not found'
      });

      const fn = vi.fn().mockRejectedValue(error);

      await expect(ErrorHandler.withRetry(fn, { maxRetries: 3 })).rejects.toThrow(error);

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('应该在达到最大重试次数后失败', async () => {
      const error = new CoobeeError({
        code: ErrorCode.NETWORK_TIMEOUT,
        message: 'Timeout'
      });

      const fn = vi.fn().mockRejectedValue(error);

      await expect(ErrorHandler.withRetry(fn, { maxRetries: 2, retryDelay: 10 })).rejects.toThrow(error);

      expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    }, 10000);

    it('应该调用 onRetry 回调', async () => {
      const error = new CoobeeError({
        code: ErrorCode.NETWORK_TIMEOUT,
        message: 'Timeout'
      });

      const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue('success');

      const onRetry = vi.fn();

      await ErrorHandler.withRetry(fn, {
        maxRetries: 1,
        retryDelay: 10,
        onRetry
      });

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(error, 1);
    }, 10000);
  });
});

describe('CoobeeError', () => {
  describe('constructor', () => {
    it('应该创建错误对象', () => {
      const error = new CoobeeError({
        code: ErrorCode.FILE_NOT_FOUND,
        message: 'Test file not found'
      });

      expect(error.code).toBe(ErrorCode.FILE_NOT_FOUND);
      expect(error.message).toBe('Test file not found');
      expect(error.retriable).toBe(false);
    });

    it('应该使用默认消息', () => {
      const error = new CoobeeError({
        code: ErrorCode.FILE_NOT_FOUND
      });

      expect(error.message).toBe('文件不存在');
    });

    it('应该推断严重级别', () => {
      const fatalError = new CoobeeError({
        code: ErrorCode.CONFIG_NOT_FOUND
      });
      expect(fatalError.severity).toBe('fatal');

      const warningError = new CoobeeError({
        code: ErrorCode.RATE_LIMIT_EXCEEDED
      });
      expect(warningError.severity).toBe('warning');

      const normalError = new CoobeeError({
        code: ErrorCode.FILE_NOT_FOUND
      });
      expect(normalError.severity).toBe('error');
    });
  });

  describe('fromError', () => {
    it('应该从原生 Error 创建', () => {
      const native = new Error('Native error');
      const error = CoobeeError.fromError(native);

      expect(error).toBeInstanceOf(CoobeeError);
      expect(error.message).toBe('Native error');
      expect(error.cause).toBe(native);
    });

    it('应该保留已经是 CoobeeError 的对象', () => {
      const original = new CoobeeError({
        code: ErrorCode.FILE_NOT_FOUND
      });

      const result = CoobeeError.fromError(original);

      expect(result).toBe(original);
    });
  });

  describe('fromNodeError', () => {
    it('应该正确映射 Node.js 错误码', () => {
      const testCases: Array<[string, ErrorCode]> = [
        ['ENOENT', ErrorCode.FILE_NOT_FOUND],
        ['EEXIST', ErrorCode.FILE_ALREADY_EXISTS],
        ['EACCES', ErrorCode.FILE_PERMISSION_DENIED],
        ['ETIMEDOUT', ErrorCode.NETWORK_TIMEOUT],
        ['ECONNREFUSED', ErrorCode.CONNECTION_REFUSED]
      ];

      for (const [nodeCode, expectedCode] of testCases) {
        const nodeError: NodeJS.ErrnoException = new Error('Test error');
        nodeError.code = nodeCode;

        const error = CoobeeError.fromNodeError(nodeError);

        expect(error.code).toBe(expectedCode);
      }
    });
  });

  describe('toJSON', () => {
    it('应该序列化为 JSON', () => {
      const error = new CoobeeError({
        code: ErrorCode.FILE_NOT_FOUND,
        message: 'Test error',
        context: { filePath: '/test/file.txt' }
      });

      const json = error.toJSON();

      expect(json.code).toBe(ErrorCode.FILE_NOT_FOUND);
      expect(json.message).toBe('Test error');
      expect(json.context).toEqual({ filePath: '/test/file.txt' });
    });
  });

  describe('toUserString', () => {
    it('应该生成用户友好的字符串', () => {
      const error = new CoobeeError({
        code: ErrorCode.FILE_NOT_FOUND,
        message: 'File not found',
        context: {
          filePath: '/test/file.txt',
          sessionId: 'test-session'
        }
      });

      const userString = error.toUserString();

      expect(userString).toContain('[4001]');
      expect(userString).toContain('File not found');
      expect(userString).toContain('/test/file.txt');
      expect(userString).toContain('test-session');
    });
  });
});
