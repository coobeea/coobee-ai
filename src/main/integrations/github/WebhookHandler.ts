/**
 * WebhookHandler - GitHub Webhook 事件处理器
 *
 * 监听 GitHub webhook 事件，根据配置自动创建任务或触发操作
 */

import { createLogger } from '@main/common/logger';
import { TavernStore } from '@main/ai/tavern/TavernStore';
import type { GitHubConfig, GitHubWebhookEvent, GitHubIssue, GitHubPullRequest } from './types';
import { GitHubClient } from './GitHubClient';

const log = createLogger('github-webhook');

export class WebhookHandler {
  private config: GitHubConfig;
  private client: GitHubClient;

  constructor(config: GitHubConfig) {
    this.config = config;
    this.client = new GitHubClient(config);
  }

  /**
   * 处理 Webhook 事件
   */
  async handle(event: GitHubWebhookEvent): Promise<void> {
    const { event: eventType, payload } = event;

    log.info(`[WebhookHandler] Received GitHub event: ${eventType}`);

    try {
      switch (eventType) {
        case 'issue_comment':
          await this.handleIssueComment(
            payload as {
              action: string;
              comment: { body: string; user: { login: string } };
              issue: GitHubIssue;
            }
          );
          break;

        case 'pull_request':
          await this.handlePullRequest(payload as { action: string; pull_request: GitHubPullRequest });
          break;

        case 'check_run':
          await this.handleCheckRun(
            payload as {
              action: string;
              check_run: { conclusion: string; name: string; html_url: string };
            }
          );
          break;

        case 'push':
          await this.handlePush(payload as { ref: string; commits: unknown[] });
          break;

        default:
          log.debug(`[WebhookHandler] Unhandled event type: ${eventType}`);
      }
    } catch (err) {
      log.error(`[WebhookHandler] Error handling ${eventType}:`, err);
      throw err;
    }
  }

  /**
   * 处理 Issue/PR 评论事件
   */
  private async handleIssueComment(payload: {
    action: string;
    comment: { body: string; user: { login: string } };
    issue: GitHubIssue;
  }): Promise<void> {
    if (payload.action !== 'created') return;

    const { comment, issue } = payload;
    const body = comment.body.trim();

    // 检查是否是 PR review 触发
    if (this.config.autoReview?.enabled && body.includes(this.config.autoReview.trigger || '@coobee review')) {
      if (!issue.pull_request) return;

      const prNumber = issue.number;
      const repo = issue.html_url.split('/').slice(-4, -2).join('/');
      const [owner, repoName] = repo.split('/');

      log.info(`[WebhookHandler] PR review triggered for ${owner}/${repoName}#${prNumber}`);

      await this.createReviewTask(owner, repoName, prNumber, comment.user.login);
    }

    // 检查是否是普通任务创建触发
    if (body.includes('@coobee')) {
      const command = this.extractCommand(body);
      if (command) {
        await this.createTaskFromComment(issue, command, comment.user.login);
      }
    }
  }

  /**
   * 处理 Pull Request 事件
   */
  private async handlePullRequest(payload: { action: string; pull_request: GitHubPullRequest }): Promise<void> {
    const { action, pull_request: pr } = payload;

    if (action === 'opened' && this.config.autoReview?.enabled) {
      const owner = pr.base.repo.owner.login;
      const repo = pr.base.repo.name;

      log.info(`[WebhookHandler] New PR opened: ${owner}/${repo}#${pr.number}`);
      // 可选：自动触发 PR 审查
    }
  }

  /**
   * 处理 Check Run 事件（CI 失败）
   */
  private async handleCheckRun(payload: {
    action: string;
    check_run: { conclusion: string; name: string; html_url: string };
  }): Promise<void> {
    const { action, check_run: checkRun } = payload;

    if (action === 'completed' && checkRun.conclusion === 'failure' && this.config.autoFixCI?.enabled) {
      log.info(`[WebhookHandler] CI failed: ${checkRun.name}`);
      // TODO: 触发自动修复任务
    }
  }

  /**
   * 处理 Push 事件
   */
  private async handlePush(payload: { ref: string; commits: unknown[] }): Promise<void> {
    log.debug(`[WebhookHandler] Push to ${payload.ref}, ${payload.commits.length} commits`);
    // 预留：可用于触发自动分析、自动测试等
  }

  /**
   * 创建 PR 审查任务
   */
  private async createReviewTask(owner: string, repo: string, prNumber: number, requester: string): Promise<void> {
    const pr = await this.client.getPullRequest(owner, repo, prNumber);
    const files = await this.client.getPullRequestFiles(owner, repo, prNumber);

    const store = await TavernStore.getInstance();
    await store.createTask({
      title: `审查 PR #${prNumber}: ${pr.title}`,
      description: `## Pull Request 信息

- **仓库**: ${owner}/${repo}
- **PR**: #${prNumber} - ${pr.title}
- **作者**: @${pr.user.login}
- **分支**: ${pr.head.ref} → ${pr.base.ref}
- **链接**: ${pr.html_url}

## 描述

${pr.body || '（无描述）'}

## 变更文件

${files.map((f) => `- ${f.status.toUpperCase()}: ${f.filename}`).join('\n')}

## 审查要求

1. 检查代码质量和安全性
2. 分析是否有潜在 Bug
3. 评估代码可维护性
4. 提出改进建议

完成后，请使用 GitHub Skill 在 PR 上发表 Review 评论。

**请求人**: @${requester}`,
      amount: 0,
      files: files.map((f) => f.filename),
      status: 'pending'
    });

    log.info(`[WebhookHandler] Created review task for PR ${owner}/${repo}#${prNumber}`);
  }

  /**
   * 从评论中创建普通任务
   */
  private async createTaskFromComment(issue: GitHubIssue, command: string, requester: string): Promise<void> {
    const store = await TavernStore.getInstance();
    await store.createTask({
      title: `GitHub #${issue.number}: ${command}`,
      description: `## Issue 信息

- **Issue**: #${issue.number} - ${issue.title}
- **请求人**: @${requester}
- **链接**: ${issue.html_url}

## 指令

${command}

## 上下文

${issue.body || '（无描述）'}`,
      amount: 0,
      files: [],
      status: 'pending'
    });

    log.info(`[WebhookHandler] Created task from issue comment: ${issue.number}`);
  }

  /**
   * 提取命令（去除 @coobee 前缀）
   */
  private extractCommand(body: string): string | null {
    const match = body.match(/@coobee\s+(.+)/i);
    return match ? match[1].trim() : null;
  }
}
