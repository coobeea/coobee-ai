/**
 * 装饰器类型枚举
 */
export enum DecoratorType {
  GET = 'GET',
  POST = 'POST',
  SSE = 'SSE',
  STREAM = 'STREAM'
}

/**
 * 路由元数据接口
 */
export interface RouteMetadata {
  target: unknown
  propertyKey: string
  handler: (...args: unknown[]) => unknown
  decoratorType: DecoratorType
  method?: 'GET' | 'POST'
}

/**
 * 获取HTTP方法
 */
export function getHttpMethod(decoratorType: DecoratorType): string {
  return decoratorType === DecoratorType.SSE ? 'POST' : decoratorType
}

/**
 * 判断是否为SSE装饰器
 */
export function isSSEDecorator(decoratorType: DecoratorType): boolean {
  return decoratorType === DecoratorType.SSE
}

/**
 * 判断是否为Stream装饰器
 */
export function isStreamDecorator(decoratorType: DecoratorType): boolean {
  return decoratorType === DecoratorType.STREAM
}

/**
 * 全局路由元数据存储
 */
export const ROUTE_METADATA_KEY = Symbol('route_metadata')
export const routeMetadataStorage = new Map<new (...args: unknown[]) => unknown, RouteMetadata[]>()

/**
 * 统一流式装饰器
 */
export function SSE(): MethodDecorator {
  return function (_target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) {
    const metadata: RouteMetadata = {
      target: _target,
      propertyKey: String(propertyKey),
      handler: descriptor.value,
      decoratorType: DecoratorType.SSE
    }

    const constructor = (_target as { constructor: new (...args: unknown[]) => unknown })
      .constructor
    if (!routeMetadataStorage.has(constructor)) {
      routeMetadataStorage.set(constructor, [])
    }

    const metadataList = routeMetadataStorage.get(constructor)!
    metadataList.push(metadata)
  } as MethodDecorator
}

/**
 * GET方法装饰器
 */
export function Get(): MethodDecorator {
  return function (_target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) {
    const metadata: RouteMetadata = {
      target: _target,
      propertyKey: String(propertyKey),
      handler: descriptor.value,
      decoratorType: DecoratorType.GET
    }

    const constructor = (_target as { constructor: new (...args: unknown[]) => unknown })
      .constructor
    if (!routeMetadataStorage.has(constructor)) {
      routeMetadataStorage.set(constructor, [])
    }

    const metadataList = routeMetadataStorage.get(constructor)!
    metadataList.push(metadata)
  } as MethodDecorator
}

/**
 * POST方法装饰器
 */
export function Post(): MethodDecorator {
  return function (_target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) {
    const metadata: RouteMetadata = {
      target: _target,
      propertyKey: String(propertyKey),
      handler: descriptor.value,
      decoratorType: DecoratorType.POST
    }

    const constructor = (_target as { constructor: new (...args: unknown[]) => unknown })
      .constructor
    if (!routeMetadataStorage.has(constructor)) {
      routeMetadataStorage.set(constructor, [])
    }

    const metadataList = routeMetadataStorage.get(constructor)!
    metadataList.push(metadata)
  } as MethodDecorator
}

/**
 * Stream数据流装饰器
 * 用于直接输出数据流（如文件下载、二进制数据、图片预览）
 */
export function Stream(options?: { method?: 'GET' | 'POST' }): MethodDecorator {
  return function (_target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) {
    const metadata: RouteMetadata = {
      target: _target,
      propertyKey: String(propertyKey),
      handler: descriptor.value,
      decoratorType: DecoratorType.STREAM,
      method: options?.method || 'POST'
    }

    const constructor = (_target as { constructor: new (...args: unknown[]) => unknown })
      .constructor
    if (!routeMetadataStorage.has(constructor)) {
      routeMetadataStorage.set(constructor, [])
    }

    const metadataList = routeMetadataStorage.get(constructor)!
    metadataList.push(metadata)
  } as MethodDecorator
}

/**
 * 获取类的路由元数据
 */
export function getRouteMetadata(target: new (...args: unknown[]) => unknown): RouteMetadata[] {
  return routeMetadataStorage.get(target) || []
}
