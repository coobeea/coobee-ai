/**
 * decorators.ts 单元测试
 *
 * 测试目标：装饰器、路由元数据存储、辅助函数
 * 特点：纯逻辑，无外部依赖，无需 mock
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  DecoratorType,
  getHttpMethod,
  isSSEDecorator,
  isStreamDecorator,
  routeMetadataStorage,
  getRouteMetadata,
  SSE,
  Get,
  Post,
  Stream
} from '../decorators'

// ==================== 辅助函数测试 ====================

describe('decorators - 辅助函数', () => {
  describe('getHttpMethod', () => {
    it('SSE → POST', () => {
      expect(getHttpMethod(DecoratorType.SSE)).toBe('POST')
    })

    it('GET → GET', () => {
      expect(getHttpMethod(DecoratorType.GET)).toBe('GET')
    })

    it('POST → POST', () => {
      expect(getHttpMethod(DecoratorType.POST)).toBe('POST')
    })

    it('STREAM → STREAM', () => {
      expect(getHttpMethod(DecoratorType.STREAM)).toBe('STREAM')
    })
  })

  describe('isSSEDecorator', () => {
    it('SSE 类型返回 true', () => {
      expect(isSSEDecorator(DecoratorType.SSE)).toBe(true)
    })

    it('非 SSE 类型返回 false', () => {
      expect(isSSEDecorator(DecoratorType.GET)).toBe(false)
      expect(isSSEDecorator(DecoratorType.POST)).toBe(false)
      expect(isSSEDecorator(DecoratorType.STREAM)).toBe(false)
    })
  })

  describe('isStreamDecorator', () => {
    it('STREAM 类型返回 true', () => {
      expect(isStreamDecorator(DecoratorType.STREAM)).toBe(true)
    })

    it('非 STREAM 类型返回 false', () => {
      expect(isStreamDecorator(DecoratorType.GET)).toBe(false)
      expect(isStreamDecorator(DecoratorType.POST)).toBe(false)
      expect(isStreamDecorator(DecoratorType.SSE)).toBe(false)
    })
  })
})

// ==================== 装饰器测试（手动调用方式，兼容标准装饰器编译） ====================

/**
 * 辅助：模拟 legacy decorator 调用
 * 因为 vitest/esbuild 可能使用标准装饰器编译，@Decorator 语法中
 * descriptor 可能为 undefined。这里手动构造 legacy 格式调用以测试核心逻辑。
 */
function applyLegacyDecorator(
  decoratorFactory: () => MethodDecorator,
  TargetClass: new (...args: unknown[]) => unknown,
  methodName: string
): void {
  const proto = TargetClass.prototype
  const descriptor = Object.getOwnPropertyDescriptor(proto, methodName)!
  const decorator = decoratorFactory()
  decorator(proto, methodName, descriptor)
}

describe('decorators - 装饰器', () => {
  beforeEach(() => {
    routeMetadataStorage.clear()
  })

  describe('Get()', () => {
    it('注册 GET 路由元数据', () => {
      class TestController {
        getList(): string {
          return 'list'
        }
      }

      applyLegacyDecorator(
        Get,
        TestController as unknown as new (...args: unknown[]) => unknown,
        'getList'
      )

      const metadata = getRouteMetadata(
        TestController as unknown as new (...args: unknown[]) => unknown
      )
      expect(metadata).toHaveLength(1)
      expect(metadata[0].propertyKey).toBe('getList')
      expect(metadata[0].decoratorType).toBe(DecoratorType.GET)
      expect(typeof metadata[0].handler).toBe('function')
    })
  })

  describe('Post()', () => {
    it('注册 POST 路由元数据', () => {
      class TestController {
        createItem(): string {
          return 'created'
        }
      }

      applyLegacyDecorator(
        Post,
        TestController as unknown as new (...args: unknown[]) => unknown,
        'createItem'
      )

      const metadata = getRouteMetadata(
        TestController as unknown as new (...args: unknown[]) => unknown
      )
      expect(metadata).toHaveLength(1)
      expect(metadata[0].propertyKey).toBe('createItem')
      expect(metadata[0].decoratorType).toBe(DecoratorType.POST)
    })
  })

  describe('SSE()', () => {
    it('注册 SSE 路由元数据', () => {
      class TestController {
        *streamEvents(): Generator<string> {
          yield 'event1'
        }
      }

      applyLegacyDecorator(
        SSE,
        TestController as unknown as new (...args: unknown[]) => unknown,
        'streamEvents'
      )

      const metadata = getRouteMetadata(
        TestController as unknown as new (...args: unknown[]) => unknown
      )
      expect(metadata).toHaveLength(1)
      expect(metadata[0].propertyKey).toBe('streamEvents')
      expect(metadata[0].decoratorType).toBe(DecoratorType.SSE)
    })
  })

  describe('Stream()', () => {
    it('默认 method 为 POST', () => {
      class TestController {
        downloadFile(): string {
          return 'data'
        }
      }

      // Stream 需要带 options 参数，这里手动调用
      const proto = TestController.prototype
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'downloadFile')!
      const decorator = Stream()
      decorator(proto, 'downloadFile', descriptor)

      const metadata = getRouteMetadata(
        TestController as unknown as new (...args: unknown[]) => unknown
      )
      expect(metadata).toHaveLength(1)
      expect(metadata[0].decoratorType).toBe(DecoratorType.STREAM)
      expect(metadata[0].method).toBe('POST')
    })

    it('指定 method 为 GET', () => {
      class TestController {
        previewFile(): string {
          return 'data'
        }
      }

      const proto = TestController.prototype
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'previewFile')!
      const decorator = Stream({ method: 'GET' })
      decorator(proto, 'previewFile', descriptor)

      const metadata = getRouteMetadata(
        TestController as unknown as new (...args: unknown[]) => unknown
      )
      expect(metadata).toHaveLength(1)
      expect(metadata[0].method).toBe('GET')
    })
  })

  describe('多装饰器组合', () => {
    it('同一个类多个装饰器方法', () => {
      class MultiController {
        getList(): string {
          return 'list'
        }
        create(): string {
          return 'created'
        }
        *stream(): Generator<string> {
          yield 'data'
        }
        download(): string {
          return 'file'
        }
      }

      const Cls = MultiController as unknown as new (...args: unknown[]) => unknown

      applyLegacyDecorator(Get, Cls, 'getList')
      applyLegacyDecorator(Post, Cls, 'create')
      applyLegacyDecorator(SSE, Cls, 'stream')

      // Stream 装饰器
      const proto = MultiController.prototype
      const desc = Object.getOwnPropertyDescriptor(proto, 'download')!
      Stream({ method: 'GET' })(proto, 'download', desc)

      const metadata = getRouteMetadata(Cls)
      expect(metadata).toHaveLength(4)

      const types = metadata.map((m) => m.decoratorType)
      expect(types).toContain(DecoratorType.GET)
      expect(types).toContain(DecoratorType.POST)
      expect(types).toContain(DecoratorType.SSE)
      expect(types).toContain(DecoratorType.STREAM)

      const names = metadata.map((m) => m.propertyKey)
      expect(names).toContain('getList')
      expect(names).toContain('create')
      expect(names).toContain('stream')
      expect(names).toContain('download')
    })
  })

  describe('getRouteMetadata', () => {
    it('未装饰的类返回空数组', () => {
      class PlainClass {
        doSomething(): void {
          /* noop */
        }
      }

      const metadata = getRouteMetadata(
        PlainClass as unknown as new (...args: unknown[]) => unknown
      )
      expect(metadata).toEqual([])
    })

    it('不同类的元数据互不干扰', () => {
      class ControllerA {
        listA(): string {
          return 'a'
        }
      }
      class ControllerB {
        createB(): string {
          return 'b'
        }
        listB(): string {
          return 'b'
        }
      }

      const ClsA = ControllerA as unknown as new (...args: unknown[]) => unknown
      const ClsB = ControllerB as unknown as new (...args: unknown[]) => unknown

      applyLegacyDecorator(Get, ClsA, 'listA')
      applyLegacyDecorator(Post, ClsB, 'createB')
      applyLegacyDecorator(Get, ClsB, 'listB')

      const metaA = getRouteMetadata(ClsA)
      const metaB = getRouteMetadata(ClsB)

      expect(metaA).toHaveLength(1)
      expect(metaB).toHaveLength(2)
      expect(metaA[0].propertyKey).toBe('listA')
    })
  })
})

// ==================== DecoratorType 枚举 ====================

describe('DecoratorType 枚举', () => {
  it('包含所有预期值', () => {
    expect(DecoratorType.GET).toBe('GET')
    expect(DecoratorType.POST).toBe('POST')
    expect(DecoratorType.SSE).toBe('SSE')
    expect(DecoratorType.STREAM).toBe('STREAM')
  })
})
