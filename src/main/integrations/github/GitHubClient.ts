/**
 * GitHubClient - GitHub API 客户端
 *
 * 提供与 GitHub REST API 交互的方法
 */

import type { GitHubConfig, GitHubPullRequest, GitHubComment, GitHubCheckRun } from './types';

export class GitHubClient {
  private token: string;
  private apiBaseUrl: string;

  constructor(config: GitHubConfig) {
    this.token = config.token;
    this.apiBaseUrl = config.apiBaseUrl || 'https://api.github.com';
  }

  /**
   * 发送 API 请求
   */
  private async request<T>(method: string, endpoint: string, body?: unknown): Promise<T> {
    const url = `${this.apiBaseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'coobee-ai'
    };

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${error}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * 获取 Pull Request 详情
   */
  async getPullRequest(owner: string, repo: string, prNumber: number): Promise<GitHubPullRequest> {
    return this.request<GitHubPullRequest>('GET', `/repos/${owner}/${repo}/pulls/${prNumber}`);
  }

  /**
   * 获取 PR 的文件变更列表
   */
  async getPullRequestFiles(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<Array<{ filename: string; status: string; patch?: string }>> {
    return this.request('GET', `/repos/${owner}/${repo}/pulls/${prNumber}/files`);
  }

  /**
   * 在 PR 上发表评论
   */
  async createPullRequestComment(owner: string, repo: string, prNumber: number, body: string): Promise<GitHubComment> {
    return this.request<GitHubComment>('POST', `/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
      body
    });
  }

  /**
   * 在 PR 上发表 Review
   */
  async createPullRequestReview(
    owner: string,
    repo: string,
    prNumber: number,
    event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
    body: string
  ): Promise<unknown> {
    return this.request('POST', `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, {
      event,
      body
    });
  }

  /**
   * 获取 Commit 的 Check Runs（CI 状态）
   */
  async getCheckRuns(owner: string, repo: string, ref: string): Promise<GitHubCheckRun[]> {
    const response = await this.request<{ check_runs: GitHubCheckRun[] }>(
      'GET',
      `/repos/${owner}/${repo}/commits/${ref}/check-runs`
    );
    return response.check_runs;
  }

  /**
   * 获取文件内容
   */
  async getFileContent(owner: string, repo: string, path: string, ref?: string): Promise<string> {
    const endpoint = ref
      ? `/repos/${owner}/${repo}/contents/${path}?ref=${ref}`
      : `/repos/${owner}/${repo}/contents/${path}`;

    const response = await this.request<{ content: string; encoding: string }>('GET', endpoint);

    if (response.encoding === 'base64') {
      return Buffer.from(response.content, 'base64').toString('utf-8');
    }

    return response.content;
  }

  /**
   * 创建或更新文件
   */
  async updateFile(
    owner: string,
    repo: string,
    path: string,
    content: string,
    message: string,
    branch: string,
    sha?: string
  ): Promise<unknown> {
    const encoded = Buffer.from(content, 'utf-8').toString('base64');

    return this.request('PUT', `/repos/${owner}/${repo}/contents/${path}`, {
      message,
      content: encoded,
      branch,
      sha
    });
  }
}
