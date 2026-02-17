/**
 * 配置系统类型导出
 */
export type { CoobeeConfig } from './schema';
export {
  CoobeeConfigSchema,
  ModelApiSchema,
  ModelConfigSchema,
  ModelCostSchema,
  ProviderConfigSchema,
  ModelSelectionSchema,
  QueueModeSchema,
  QueueSettingsSchema
} from './schema';

/** 配置文件快照 */
export interface ConfigSnapshot {
  /** 配置文件绝对路径 */
  path: string;
  /** 文件是否存在 */
  exists: boolean;
  /** 原始文件内容 */
  raw: string | null;
  /** 解析后的配置（校验通过） */
  config: import('./schema').CoobeeConfig;
  /** 是否通过校验 */
  valid: boolean;
  /** 校验问题列表 */
  issues: ConfigValidationIssue[];
  /** 内容哈希（用于 diff） */
  hash: string | null;
}

/** 配置校验问题 */
export interface ConfigValidationIssue {
  path: string;
  message: string;
}

/** 热重载行为类型 */
export type ReloadKind = 'hot' | 'none';

/** 热重载规则 */
export interface ReloadRule {
  prefix: string;
  kind: ReloadKind;
}

/** 热重载计划 */
export interface ReloadPlan {
  /** 变更的配置路径 */
  changedPaths: string[];
  /** 需要热重载的路径 */
  hotPaths: string[];
  /** 无需操作的路径 */
  nonePaths: string[];
}
