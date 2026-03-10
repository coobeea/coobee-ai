/**
 * GitHub Integration Types
 */

export interface GitHubConfig {
  /** GitHub API Token */
  token: string;

  /** Webhook Secret（用于验证请求） */
  webhookSecret?: string;

  /** API Base URL（默认 https://api.github.com，私有部署可自定义） */
  apiBaseUrl?: string;

  /** 自动审查 PR 的规则 */
  autoReview?: {
    enabled: boolean;
    /** 触发关键词（如 "@coobee review"） */
    trigger?: string;
  };

  /** 自动修复 CI 失败 */
  autoFixCI?: {
    enabled: boolean;
    /** 最大尝试次数 */
    maxAttempts?: number;
  };
}

export interface GitHubWebhookEvent {
  /** 事件类型 */
  event: string;

  /** 事件载荷 */
  payload: unknown;

  /** 请求头 */
  headers: Record<string, string>;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  html_url: string;
  user: {
    login: string;
  };
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
    repo: {
      name: string;
      owner: {
        login: string;
      };
    };
  };
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  html_url: string;
  user: {
    login: string;
  };
  pull_request?: {
    url: string;
  };
}

export interface GitHubComment {
  id: number;
  body: string;
  user: {
    login: string;
  };
  created_at: string;
}

export interface GitHubCheckRun {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | null;
  html_url: string;
}
