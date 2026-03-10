/**
 * 错误码体系
 *
 * 分类：
 * - 1xxx: 配置错误
 * - 2xxx: Agent 错误
 * - 3xxx: 工具错误
 * - 4xxx: 文件系统错误
 * - 5xxx: 网络错误
 * - 6xxx: LLM 提供商错误
 * - 7xxx: 扩展错误
 * - 9xxx: 系统内部错误
 */

/** 错误码 */
export enum ErrorCode {
  // ========== 1xxx: 配置错误 ==========
  /** 配置文件不存在 */
  CONFIG_NOT_FOUND = 1001,
  /** 配置文件格式错误 */
  CONFIG_INVALID_FORMAT = 1002,
  /** 配置验证失败 */
  CONFIG_VALIDATION_FAILED = 1003,
  /** API Key 缺失 */
  CONFIG_MISSING_API_KEY = 1004,
  /** 配置值无效 */
  CONFIG_INVALID_VALUE = 1005,

  // ========== 2xxx: Agent 错误 ==========
  /** Agent 不存在 */
  AGENT_NOT_FOUND = 2001,
  /** Agent 创建失败 */
  AGENT_CREATE_FAILED = 2002,
  /** Agent 执行失败 */
  AGENT_EXECUTION_FAILED = 2003,
  /** Agent 超时 */
  AGENT_TIMEOUT = 2004,
  /** Agent 指令无效 */
  AGENT_INVALID_INSTRUCTIONS = 2005,
  /** 会话不存在 */
  SESSION_NOT_FOUND = 2006,
  /** 会话已关闭 */
  SESSION_CLOSED = 2007,

  // ========== 3xxx: 工具错误 ==========
  /** 工具不存在 */
  TOOL_NOT_FOUND = 3001,
  /** 工具执行失败 */
  TOOL_EXECUTION_FAILED = 3002,
  /** 工具参数无效 */
  TOOL_INVALID_PARAMS = 3003,
  /** 工具超时 */
  TOOL_TIMEOUT = 3004,
  /** 工具被拒绝（HITL） */
  TOOL_REJECTED = 3005,
  /** 工具不可用 */
  TOOL_UNAVAILABLE = 3006,

  // ========== 4xxx: 文件系统错误 ==========
  /** 文件不存在 */
  FILE_NOT_FOUND = 4001,
  /** 文件已存在 */
  FILE_ALREADY_EXISTS = 4002,
  /** 文件权限不足 */
  FILE_PERMISSION_DENIED = 4003,
  /** 文件大小超限 */
  FILE_SIZE_EXCEEDED = 4004,
  /** 文件类型不支持 */
  FILE_TYPE_NOT_SUPPORTED = 4005,
  /** 目录不存在 */
  DIRECTORY_NOT_FOUND = 4006,
  /** 目录非空 */
  DIRECTORY_NOT_EMPTY = 4007,
  /** 路径安全检查失败 */
  PATH_SECURITY_VIOLATION = 4008,

  // ========== 5xxx: 网络错误 ==========
  /** 网络请求失败 */
  NETWORK_REQUEST_FAILED = 5001,
  /** 网络超时 */
  NETWORK_TIMEOUT = 5002,
  /** 连接被拒绝 */
  CONNECTION_REFUSED = 5003,
  /** DNS 解析失败 */
  DNS_LOOKUP_FAILED = 5004,

  // ========== 6xxx: LLM 提供商错误 ==========
  /** 模型不可用 */
  MODEL_UNAVAILABLE = 6001,
  /** 配额超限 */
  QUOTA_EXCEEDED = 6002,
  /** Token 超限 */
  TOKEN_LIMIT_EXCEEDED = 6003,
  /** 内容被过滤 */
  CONTENT_FILTERED = 6004,
  /** API Key 无效 */
  INVALID_API_KEY = 6005,
  /** 请求速率超限 */
  RATE_LIMIT_EXCEEDED = 6006,
  /** 服务不可用 */
  SERVICE_UNAVAILABLE = 6007,

  // ========== 7xxx: 扩展错误 ==========
  /** 扩展不存在 */
  EXTENSION_NOT_FOUND = 7001,
  /** 扩展加载失败 */
  EXTENSION_LOAD_FAILED = 7002,
  /** 扩展执行失败 */
  EXTENSION_EXECUTION_FAILED = 7003,
  /** 扩展配置无效 */
  EXTENSION_INVALID_CONFIG = 7004,

  // ========== 9xxx: 系统内部错误 ==========
  /** 未知错误 */
  UNKNOWN_ERROR = 9000,
  /** 内部错误 */
  INTERNAL_ERROR = 9001,
  /** 未实现 */
  NOT_IMPLEMENTED = 9002,
  /** 资源不足 */
  RESOURCE_EXHAUSTED = 9003,
  /** 并发冲突 */
  CONCURRENT_CONFLICT = 9004
}

/** 错误码到错误消息的映射 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  // 1xxx: 配置错误
  [ErrorCode.CONFIG_NOT_FOUND]: '配置文件不存在',
  [ErrorCode.CONFIG_INVALID_FORMAT]: '配置文件格式错误',
  [ErrorCode.CONFIG_VALIDATION_FAILED]: '配置验证失败',
  [ErrorCode.CONFIG_MISSING_API_KEY]: 'API Key 缺失',
  [ErrorCode.CONFIG_INVALID_VALUE]: '配置值无效',

  // 2xxx: Agent 错误
  [ErrorCode.AGENT_NOT_FOUND]: 'Agent 不存在',
  [ErrorCode.AGENT_CREATE_FAILED]: 'Agent 创建失败',
  [ErrorCode.AGENT_EXECUTION_FAILED]: 'Agent 执行失败',
  [ErrorCode.AGENT_TIMEOUT]: 'Agent 执行超时',
  [ErrorCode.AGENT_INVALID_INSTRUCTIONS]: 'Agent 指令无效',
  [ErrorCode.SESSION_NOT_FOUND]: '会话不存在',
  [ErrorCode.SESSION_CLOSED]: '会话已关闭',

  // 3xxx: 工具错误
  [ErrorCode.TOOL_NOT_FOUND]: '工具不存在',
  [ErrorCode.TOOL_EXECUTION_FAILED]: '工具执行失败',
  [ErrorCode.TOOL_INVALID_PARAMS]: '工具参数无效',
  [ErrorCode.TOOL_TIMEOUT]: '工具执行超时',
  [ErrorCode.TOOL_REJECTED]: '工具调用被拒绝',
  [ErrorCode.TOOL_UNAVAILABLE]: '工具不可用',

  // 4xxx: 文件系统错误
  [ErrorCode.FILE_NOT_FOUND]: '文件不存在',
  [ErrorCode.FILE_ALREADY_EXISTS]: '文件已存在',
  [ErrorCode.FILE_PERMISSION_DENIED]: '文件权限不足',
  [ErrorCode.FILE_SIZE_EXCEEDED]: '文件大小超限',
  [ErrorCode.FILE_TYPE_NOT_SUPPORTED]: '文件类型不支持',
  [ErrorCode.DIRECTORY_NOT_FOUND]: '目录不存在',
  [ErrorCode.DIRECTORY_NOT_EMPTY]: '目录非空',
  [ErrorCode.PATH_SECURITY_VIOLATION]: '路径安全检查失败',

  // 5xxx: 网络错误
  [ErrorCode.NETWORK_REQUEST_FAILED]: '网络请求失败',
  [ErrorCode.NETWORK_TIMEOUT]: '网络超时',
  [ErrorCode.CONNECTION_REFUSED]: '连接被拒绝',
  [ErrorCode.DNS_LOOKUP_FAILED]: 'DNS 解析失败',

  // 6xxx: LLM 提供商错误
  [ErrorCode.MODEL_UNAVAILABLE]: '模型不可用',
  [ErrorCode.QUOTA_EXCEEDED]: '配额超限',
  [ErrorCode.TOKEN_LIMIT_EXCEEDED]: 'Token 超限',
  [ErrorCode.CONTENT_FILTERED]: '内容被过滤',
  [ErrorCode.INVALID_API_KEY]: 'API Key 无效',
  [ErrorCode.RATE_LIMIT_EXCEEDED]: '请求速率超限',
  [ErrorCode.SERVICE_UNAVAILABLE]: '服务不可用',

  // 7xxx: 扩展错误
  [ErrorCode.EXTENSION_NOT_FOUND]: '扩展不存在',
  [ErrorCode.EXTENSION_LOAD_FAILED]: '扩展加载失败',
  [ErrorCode.EXTENSION_EXECUTION_FAILED]: '扩展执行失败',
  [ErrorCode.EXTENSION_INVALID_CONFIG]: '扩展配置无效',

  // 9xxx: 系统内部错误
  [ErrorCode.UNKNOWN_ERROR]: '未知错误',
  [ErrorCode.INTERNAL_ERROR]: '系统内部错误',
  [ErrorCode.NOT_IMPLEMENTED]: '功能未实现',
  [ErrorCode.RESOURCE_EXHAUSTED]: '系统资源不足',
  [ErrorCode.CONCURRENT_CONFLICT]: '并发操作冲突'
};

/** 错误严重级别 */
export enum ErrorSeverity {
  /** 致命错误（需要终止） */
  FATAL = 'fatal',
  /** 错误（需要处理） */
  ERROR = 'error',
  /** 警告（可以继续） */
  WARNING = 'warning'
}

/** 错误是否可重试 */
export const RETRIABLE_ERRORS = new Set<ErrorCode>([
  ErrorCode.NETWORK_TIMEOUT,
  ErrorCode.CONNECTION_REFUSED,
  ErrorCode.RATE_LIMIT_EXCEEDED,
  ErrorCode.SERVICE_UNAVAILABLE,
  ErrorCode.MODEL_UNAVAILABLE,
  ErrorCode.RESOURCE_EXHAUSTED
]);
