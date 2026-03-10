/**
 * GitHubClient 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubClient } from '../GitHubClient';
import type { GitHubConfig } from '../types';

describe('GitHubClient', () => {
  let client: GitHubClient;
  const mockConfig: GitHubConfig = {
    token: 'test-token',
    apiBaseUrl: 'https://api.github.com'
  };

  beforeEach(() => {
    client = new GitHubClient(mockConfig);
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with config', () => {
      expect(client).toBeInstanceOf(GitHubClient);
    });

    it('should use default API base URL if not provided', () => {
      const defaultClient = new GitHubClient({ token: 'test' });
      expect(defaultClient).toBeInstanceOf(GitHubClient);
    });
  });

  describe('API methods', () => {
    it('should have getPullRequest method', () => {
      expect(typeof client.getPullRequest).toBe('function');
    });

    it('should have getPullRequestFiles method', () => {
      expect(typeof client.getPullRequestFiles).toBe('function');
    });

    it('should have createPullRequestComment method', () => {
      expect(typeof client.createPullRequestComment).toBe('function');
    });

    it('should have createPullRequestReview method', () => {
      expect(typeof client.createPullRequestReview).toBe('function');
    });

    it('should have getCheckRuns method', () => {
      expect(typeof client.getCheckRuns).toBe('function');
    });

    it('should have getFileContent method', () => {
      expect(typeof client.getFileContent).toBe('function');
    });

    it('should have updateFile method', () => {
      expect(typeof client.updateFile).toBe('function');
    });
  });
});
