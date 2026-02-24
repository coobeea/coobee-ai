/**
 * API Key 密钥管理
 *
 * 从独立的 secrets.json5 文件加载 API Key，
 * 合并到 provider 配置中，避免在大配置文件里翻找。
 *
 * secrets.json5 格式极简：
 * {
 *   dashscope: "sk-xxx",
 *   silicon: "sk-xxx",
 * }
 */
import fs from 'fs';
import JSON5 from 'json5';
import path from 'path';
import { createLogger } from '@main/common/logger';

const log = createLogger('ConfigSecrets');

/** 密钥文件名 */
const SECRETS_FILE_NAME = 'secrets.json5';

/** 期望的 secrets 文件权限：仅所有者可读写 (rw-------) */
const EXPECTED_MODE = 0o600;

/** provider id → api key */
export type SecretsMap = Record<string, string>;

/**
 * 读取 secrets.json5
 *
 * @param secretsDir 敏感信息目录（新架构使用独立的 secrets/ 目录）
 * @returns 解析后的 key-value map，文件不存在或格式错误时返回空对象
 */
export function loadSecrets(secretsDir: string): SecretsMap {
  const filePath = path.join(secretsDir, SECRETS_FILE_NAME);

  if (!fs.existsSync(filePath)) return {};

  // Unix 平台检查文件权限，非 600 时告警
  if (process.platform !== 'win32') {
    try {
      const stat = fs.statSync(filePath);
      const mode = stat.mode & 0o777;
      if (mode !== EXPECTED_MODE) {
        log.warn(`secrets.json5 文件权限为 ${mode.toString(8)}，建议改为 600 (chmod 600) 以保护敏感信息`);
      }
    } catch {
      // 权限获取失败时不影响加载，静默跳过
    }
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON5.parse(raw);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }

    // 只保留 string 类型的值
    const result: SecretsMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.length > 0) {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * 将 secrets 合并到已解析的配置对象中
 *
 * 规则：secrets 中的 apiKey 覆盖 provider 中的 apiKey
 * （仅当 secrets 中有值且非空时才覆盖）
 */
export function mergeSecrets<T>(config: T, secrets: SecretsMap): T {
  if (!config || typeof config !== 'object') return config;
  if (Object.keys(secrets).length === 0) return config;

  // 深拷贝，避免修改原始对象
  const cloned = structuredClone(config);

  const obj = cloned as Record<string, unknown>;
  const providers = (obj.models as Record<string, unknown>)?.providers as
    | Record<string, Record<string, unknown>>
    | undefined;

  if (!providers) return config;

  for (const [providerId, apiKey] of Object.entries(secrets)) {
    if (providers[providerId]) {
      providers[providerId].apiKey = apiKey;
    }
  }

  return cloned;
}

/** secrets.json5 文件路径 */
export function secretsPath(secretsDir: string): string {
  return path.join(secretsDir, SECRETS_FILE_NAME);
}

/** 确保 secrets.json5 存在，不存在则创建模板 */
export function ensureSecretsFile(secretsDir: string): void {
  const filePath = secretsPath(secretsDir);
  if (fs.existsSync(filePath)) {
    // 修正已存在文件的权限为 600 (rw-------)
    fs.chmodSync(filePath, 0o600);
    return;
  }

  // 创建 secrets 目录（700 权限）
  if (!fs.existsSync(secretsDir)) {
    fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
  }

  const template = `// Coobee AI — API Key 配置
// 在这里填写各供应商的 API Key，保存后自动生效
// 格式：供应商ID: "你的Key"
{
  dashscope: "",
  silicon: "",
  deepseek: "",
  // 按需添加更多供应商...
  // zhipu: "",
  // minimax: "",
  // moonshot: "",
  // doubao: "",
}
`;
  fs.writeFileSync(filePath, template, { mode: 0o600, encoding: 'utf-8' });

  // 确保父目录也是 700 权限
  fs.chmodSync(secretsDir, 0o700);
}
