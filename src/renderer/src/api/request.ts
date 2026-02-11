import { ErrorCodes, RequestOptions, Result, UnifiedRequest } from '@shared/api'
import { EventTypes } from '@shared/ipc/events'
import axios, { type AxiosRequestConfig } from 'axios'

import configManager from '@/config'
import eventBus from '@/eventbus'
import { AbstractSSEConnection, SSEConnection } from '@/types/sse'

/**
 * 流式数据包装类型
 */
export interface StreamResult<T = unknown> {
  type: 'data' | 'error' | 'end' | 'start' | 'heartbeat'
  data?: T
  error?: string
  streamId?: string
  timestamp: number
}

/**
 * SSE 连接初始化响应
 */
interface SSEInitResponse {
  isStream: boolean
  streamId: string
}

/**
 * 从 unknown 类型的错误中安全提取消息
 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 生成请求ID
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}

/**
 * 检查参数是否为控制选项
 */
function isRequestOptions(arg: unknown): arg is RequestOptions {
  if (!arg || typeof arg !== 'object' || Array.isArray(arg)) return false
  const obj = arg as Record<string, unknown>
  return obj.timeout !== undefined || obj.method !== undefined
}

/**
 * 分离业务参数和控制参数
 */
function separateArgs(args: unknown[]): { businessArgs: unknown[]; options?: RequestOptions } {
  if (args.length === 0) {
    return { businessArgs: [] }
  }

  const lastArg = args[args.length - 1]
  if (isRequestOptions(lastArg)) {
    return {
      businessArgs: args.slice(0, -1),
      options: lastArg
    }
  }

  return { businessArgs: args }
}

/**
 * 构建资源访问 URL（用于 <img>、<a> 等直接访问场景）
 */
export function buildResourceUrl(channel: string, args: unknown[]): string {
  const baseUrl = configManager.getBaseUrl()
  const queryParams = new URLSearchParams()

  queryParams.append('requestId', generateRequestId())
  queryParams.append('timestamp', Date.now().toString())

  args.forEach((arg, index) => {
    if (arg !== undefined && arg !== null) {
      if (typeof arg === 'object') {
        queryParams.append(`args[${index}]`, JSON.stringify(arg))
      } else {
        queryParams.append(`args[${index}]`, String(arg))
      }
    }
  })

  return `${baseUrl}${channel}?${queryParams.toString()}`
}

/**
 * 通用响应处理方法
 */
function handleResponse<T>(
  request: UnifiedRequest,
  response: Result<T> | null | undefined,
  channel: string,
  context: { type: 'IPC' | 'HTTP'; url?: string }
): Result<T> {
  console.log(`[${context.type}] 📥 Response received for ${channel}:`, {
    requestId: request.requestId,
    success: response?.success,
    code: response?.code,
    message: response?.message,
    url: context.url,
    data: response?.data
  })
  if (!(response && response.success === true)) {
    console.error(
      `${context.type} call to ${context.type === 'HTTP' ? context.url : `channel "${channel}"`} failed with no specific error message.`,
      response
    )

    const result = response as Result<T>
    eventBus.emit(EventTypes.SYSTEM_ERROR, {
      code: result.code || ErrorCodes.SYSTEM_ERROR.code,
      message: result.message || result.error || 'Unknown error',
      details: result
    })
  }
  return response as Result<T>
}

/**
 * 通用的后端服务调用函数
 */
export async function invokeBackend<T = unknown>(
  channel: string,
  ...args: unknown[]
): Promise<Result<T>> {
  const { businessArgs, options } = separateArgs(args)

  const unifiedRequest: UnifiedRequest = {
    args: businessArgs,
    options,
    requestId: generateRequestId(),
    timestamp: Date.now()
  }

  const isElectronEnvironment = configManager.isElectronEnvironment()
  if (isElectronEnvironment) {
    return invokeBackendUseIpc(channel, unifiedRequest)
  } else {
    return invokeBackendUseHttp(channel, unifiedRequest, options)
  }
}

async function invokeBackendUseIpc<T = unknown>(
  channel: string,
  request: UnifiedRequest
): Promise<Result<T>> {
  try {
    console.log(`[IPC] Calling ${channel} with request:`, request)

    const response = await window.electron.ipcRenderer.invoke(channel, request)
    return handleResponse<T>(request, response, channel, { type: 'IPC' })
  } catch (error: unknown) {
    console.error(`Failed to invoke IPC channel "${channel}":`, error)
    throw new Error(`Failed to invoke IPC channel "${channel}": ${getErrorMessage(error)}`)
  }
}

const isFormData = function (value: unknown): value is FormData {
  return value != null && typeof value === 'object' && value instanceof FormData
}

const axiosInstance = axios.create({
  baseURL: configManager.getBaseUrl(),
  timeout: 1500000,
  headers: {
    'Content-Type': 'application/json'
  },
  withCredentials: false,
  transformRequest: [
    function (data) {
      if (isFormData(data)) {
        return data
      }
      return JSON.stringify(data)
    }
  ]
})

async function invokeBackendUseHttp<T = unknown>(
  channel: string,
  request: UnifiedRequest,
  options?: RequestOptions
): Promise<Result<T>> {
  const url = `${channel}`

  console.log(`[HTTP] Calling ${url} with request:`, request)

  try {
    const method = options?.method || 'post'

    const httpConfig: AxiosRequestConfig = {
      url,
      method,
      timeout: options?.timeout
    }

    if (method === 'get') {
      const queryParams = new URLSearchParams()

      queryParams.append('requestId', request.requestId)
      queryParams.append('timestamp', request.timestamp.toString())

      request.args.forEach((arg, index) => {
        if (arg !== undefined && arg !== null) {
          if (typeof arg === 'object') {
            queryParams.append(`args[${index}]`, JSON.stringify(arg))
          } else {
            queryParams.append(`args[${index}]`, String(arg))
          }
        }
      })

      if (request.options) {
        queryParams.append('options', JSON.stringify(request.options))
      }

      httpConfig.url = `${url}?${queryParams.toString()}`

      console.log(`[HTTP GET] Final URL with params:`, httpConfig.url)
    } else {
      httpConfig.data = request
    }

    const httpResponse = await axiosInstance(httpConfig)
    const response = httpResponse.data
    return handleResponse<T>(request, response, channel, { type: 'HTTP', url })
  } catch (error: unknown) {
    console.error(`[HTTP] Failed to call HTTP endpoint "${url}":`, error)
    throw new Error(`HTTP request to "${url}" failed: ${getErrorMessage(error)}`)
  }
}

/**
 * 统一的SSE连接函数 - 自动适配HTTP/IPC
 */
export async function createSSEConnection<T = unknown>(
  channel: string,
  args: unknown[]
): Promise<SSEConnection<T>> {
  const { businessArgs } = separateArgs(args)

  const unifiedRequest: UnifiedRequest = {
    args: businessArgs,
    requestId: generateRequestId(),
    timestamp: Date.now()
  }

  const isElectronEnvironment = configManager.isElectronEnvironment()

  console.log(
    `[SSE] Creating connection to ${channel} , isElectron: ${isElectronEnvironment}, with request: `,
    unifiedRequest
  )

  if (isElectronEnvironment) {
    return createIPCSSEConnection(channel, unifiedRequest)
  } else {
    return createHTTPSSEConnection(channel, unifiedRequest)
  }
}

/**
 * 创建IPC SSE连接
 */
async function createIPCSSEConnection<T>(
  channel: string,
  request: UnifiedRequest
): Promise<SSEConnection<T>> {
  return new IPCSSEConnection(channel, request)
}

class IPCSSEConnection<T> extends AbstractSSEConnection<T> {
  private channel: string
  private request: UnifiedRequest
  private cleanup: () => void = () => {}
  private streamId?: string
  private streamChannel?: string

  constructor(channel: string, request: UnifiedRequest) {
    super()
    this.channel = channel
    this.request = request
  }

  async open(): Promise<void> {
    try {
      console.log(`[IPC SSE] Creating connection to ${this.channel} with request: `, this.request)

      const result = await invokeBackendUseIpc<SSEInitResponse>(this.channel, this.request)

      if (!result.success || !result.data?.isStream) {
        throw new Error('Failed to create SSE connection')
      }

      this.triggerOpen()

      const { streamId } = result.data
      const streamChannel = `sse_${streamId}`

      this.streamId = streamId
      this.streamChannel = streamChannel

      console.log(`[IPC SSE] Created stream ${streamId} on channel ${streamChannel}`)

      this.cleanup = () => {
        console.log(`[IPC SSE] Cleaning up stream ${streamId}`)
        window.electron.ipcRenderer.removeAllListeners(streamChannel)

        if (this.streamId && this.streamChannel) {
          const replyChannel = `${this.streamChannel}:reply`
          console.debug(`[IPC SSE] Sending close message for stream ${this.streamId}`)
          window.electron.ipcRenderer.send(replyChannel, {
            type: 'close',
            streamId: this.streamId,
            timestamp: Date.now()
          })
        }
      }

      const handleStreamData = (_event: unknown, streamData: StreamResult<T>): void => {
        switch (streamData.type) {
          case 'start':
            this.triggerStart()
            break
          case 'data':
            if (streamData.data !== undefined) {
              this.triggerMessage(streamData.data)
            }
            break
          case 'heartbeat':
            if (this.streamId && this.streamChannel) {
              const replyChannel = `${this.streamChannel}:reply`
              console.debug(
                `[IPC SSE] Heartbeat received for stream ${this.streamId}, sending reply`
              )
              window.electron.ipcRenderer.send(replyChannel, {
                type: 'heartbeat',
                streamId: this.streamId,
                timestamp: Date.now()
              })
            } else {
              console.warn(`[IPC SSE] Heartbeat received but streamId not available`)
            }
            break
          case 'error':
            this.triggerError(new Error(streamData.error))
            this.close()
            break
          case 'end':
            this.close()
            break
        }
      }

      window.electron.ipcRenderer.on(streamChannel, handleStreamData)
    } catch (error: unknown) {
      console.error('[IPC SSE] Connection failed:', error)
      this.triggerError(error instanceof Error ? error : new Error(getErrorMessage(error)))
      this.close()
    }
  }

  private closed: boolean = false
  close(): void {
    try {
      if (!this.closed) {
        this.closed = true
        this.cleanup()
        this.triggerClose()
      }
    } catch (error: unknown) {
      console.error('[IPC SSE] Close failed:', error)
    }
  }
}

/**
 * 创建HTTP SSE连接
 */
async function createHTTPSSEConnection<T = unknown>(
  channel: string,
  request: UnifiedRequest
): Promise<SSEConnection<T>> {
  return new HTTPSSSEConnection(channel, request)
}

class HTTPSSSEConnection<T> extends AbstractSSEConnection<T> {
  private channel: string
  private request: UnifiedRequest
  private cleanup: () => void = () => {}
  private abortController = new AbortController()

  constructor(channel: string, request: UnifiedRequest) {
    super()
    this.channel = channel
    this.request = request
  }

  async open(): Promise<void> {
    console.log(`[HTTP SSE] Creating connection to ${this.channel} with request: `, this.request)

    try {
      const sseUrl = `${configManager.getBaseUrl()}${this.channel}`
      console.log(`[HTTP SSE] Connecting to: ${sseUrl}`)

      const response = await fetch(sseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify(this.request),
        signal: this.abortController.signal
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      if (!response.body) {
        throw new Error('Response body is null')
      }

      this.triggerOpen()

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      this.cleanup = () => {
        console.log(`[HTTP SSE] Cleaning up stream ${this.request.requestId}`)
        if (!this.abortController.signal.aborted) {
          this.abortController.abort()
        }
        reader.cancel()
      }

      const processStream = async (): Promise<void> => {
        try {
          while (true) {
            const { done, value } = await reader.read()

            if (done) {
              console.log('[HTTP SSE] Stream ended')
              this.triggerClose()
              break
            }

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')

            buffer = lines.pop() || ''

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = line.substring(6)
                  if (data.trim() === '') continue

                  const streamData: StreamResult<T> = JSON.parse(data)

                  switch (streamData.type) {
                    case 'start':
                      this.triggerStart()
                      break
                    case 'data':
                      if (streamData.data !== undefined) {
                        this.triggerMessage(streamData.data)
                      }
                      break
                    case 'heartbeat':
                      console.debug(`[HTTP SSE] Heartbeat received`)
                      break
                    case 'error':
                      this.triggerError(new Error(streamData.error))
                      this.close()
                      return
                    case 'end':
                      this.close()
                      return
                  }
                } catch (error: unknown) {
                  console.debug('[HTTP SSE] Failed to parse line:', line, error)
                }
              }
            }
          }
          this.close()
        } catch (error: unknown) {
          console.error('[HTTP SSE] Stream error:', error)
          this.triggerError(error instanceof Error ? error : new Error(getErrorMessage(error)))
          this.close()
        }
      }

      processStream()
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('[HTTP SSE] Connection aborted by user')
        this.close()
        return
      }

      console.error('[HTTP SSE] Connection failed:', error)
      this.triggerError(error instanceof Error ? error : new Error(getErrorMessage(error)))
      this.close()
    }
  }

  private closed: boolean = false
  close(): void {
    try {
      if (!this.closed) {
        this.closed = true
        this.cleanup()
        this.triggerClose()
      }
    } catch (error: unknown) {
      console.error('[HTTP SSE] Connection failed:', error)
    }
  }
}

/**
 * 创建 Stream 数据流连接
 */
export async function createStreamConnection<T = unknown>(
  endpoint: string,
  ...args: unknown[]
): Promise<T[]> {
  const unifiedRequest: UnifiedRequest = {
    args: args,
    requestId: generateRequestId(),
    timestamp: Date.now()
  }

  try {
    if (window.electron) {
      const channelName = endpoint
      const result = await window.electron.ipcRenderer.invoke(channelName, unifiedRequest)

      return result as T[]
    } else {
      const response = await axiosInstance({
        url: endpoint,
        method: 'POST',
        data: unifiedRequest,
        responseType: 'arraybuffer'
      })

      return [response.data] as T[]
    }
  } catch (error: unknown) {
    console.error('[HTTP Stream] Stream connection error:', error)
    throw error
  }
}
