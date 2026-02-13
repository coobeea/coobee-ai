/**
 * Gateway 协议类型和错误码测试
 */
import { describe, it, expect } from 'vitest'
import { GatewayErrorCode, GatewayMethodError, getErrorMessage } from '../protocol/errors'

describe('GatewayErrorCode', () => {
  it('定义了协议错误码 (1xxx)', () => {
    expect(GatewayErrorCode.PARSE_ERROR).toBe(1001)
    expect(GatewayErrorCode.INVALID_MESSAGE).toBe(1002)
    expect(GatewayErrorCode.UNKNOWN_MESSAGE_TYPE).toBe(1003)
  })

  it('定义了路由错误码 (2xxx)', () => {
    expect(GatewayErrorCode.METHOD_NOT_FOUND).toBe(2001)
    expect(GatewayErrorCode.INVALID_PARAMS).toBe(2002)
  })

  it('定义了业务错误码 (3xxx)', () => {
    expect(GatewayErrorCode.SESSION_BUSY).toBe(3001)
    expect(GatewayErrorCode.TIMEOUT).toBe(3002)
    expect(GatewayErrorCode.INTERNAL_ERROR).toBe(3003)
  })

  it('定义了认证错误码 (4xxx)', () => {
    expect(GatewayErrorCode.UNAUTHORIZED).toBe(4001)
    expect(GatewayErrorCode.FORBIDDEN).toBe(4002)
  })
})

describe('GatewayMethodError', () => {
  it('使用默认消息', () => {
    const error = new GatewayMethodError(GatewayErrorCode.METHOD_NOT_FOUND)
    expect(error.code).toBe(GatewayErrorCode.METHOD_NOT_FOUND)
    expect(error.message).toBe('Method not found')
    expect(error.name).toBe('GatewayMethodError')
  })

  it('支持自定义消息', () => {
    const error = new GatewayMethodError(GatewayErrorCode.INVALID_PARAMS, 'sessionId is required')
    expect(error.code).toBe(GatewayErrorCode.INVALID_PARAMS)
    expect(error.message).toBe('sessionId is required')
  })

  it('是 Error 的实例', () => {
    const error = new GatewayMethodError(GatewayErrorCode.INTERNAL_ERROR)
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(GatewayMethodError)
  })
})

describe('getErrorMessage', () => {
  it('返回错误码的默认消息', () => {
    expect(getErrorMessage(GatewayErrorCode.PARSE_ERROR)).toBe('Failed to parse message')
    expect(getErrorMessage(GatewayErrorCode.METHOD_NOT_FOUND)).toBe('Method not found')
    expect(getErrorMessage(GatewayErrorCode.SESSION_BUSY)).toBe('Session is busy')
  })
})
