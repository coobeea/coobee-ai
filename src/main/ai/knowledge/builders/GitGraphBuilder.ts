/**
 * GitGraphBuilder - Git 历史图谱构建器
 *
 * 从 Git 历史中提取提交、作者、文件变更等关系，构建 Git 知识图谱
 */

import { execSync } from 'node:child_process';
import { createLogger } from '@main/common/logger';
import type { KnowledgeGraph } from '../KnowledgeGraph';

const log = createLogger('git-graph-builder');

interface GitCommit {
  hash: string;
  author: string;
  email: string;
  date: string;
  message: string;
  files: string[];
}

export class GitGraphBuilder {
  private graph: KnowledgeGraph;

  constructor(graph: KnowledgeGraph) {
    this.graph = graph;
  }

  /**
   * 构建 Git 历史图谱
   *
   * @param repoPath Git 仓库路径
   * @param limit 最多分析的提交数（默认 100）
   */
  async buildFromRepo(repoPath: string, limit = 100): Promise<void> {
    log.info(`[GitGraphBuilder] Building Git graph from ${repoPath} (limit: ${limit})`);

    const commits = this.getCommits(repoPath, limit);

    for (const commit of commits) {
      this.addCommitNode(commit);
      this.addAuthorNode(commit);
      this.addFileNodes(commit);
      this.addRelationships(commit);
    }

    log.info(`[GitGraphBuilder] Git graph built with ${commits.length} commits`);
  }

  /**
   * 获取 Git 提交历史
   */
  private getCommits(repoPath: string, limit: number): GitCommit[] {
    try {
      const output = execSync(`git log --pretty=format:'%H|%an|%ae|%ad|%s' --name-only -${limit}`, {
        cwd: repoPath,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024
      });

      const commits: GitCommit[] = [];
      const blocks = output.split('\n\n').filter((b) => b.trim());

      for (const block of blocks) {
        const lines = block.split('\n');
        if (lines.length < 1) continue;

        const [hash, author, email, date, message] = lines[0].split('|');
        const files = lines.slice(1).filter((f) => f.trim());

        commits.push({ hash, author, email, date, message, files });
      }

      return commits;
    } catch (err) {
      log.warn(`[GitGraphBuilder] Failed to get Git history:`, err);
      return [];
    }
  }

  /**
   * 添加提交节点
   */
  private addCommitNode(commit: GitCommit): void {
    this.graph.addNode({
      id: `commit:${commit.hash}`,
      type: 'task',
      label: commit.message,
      properties: {
        hash: commit.hash,
        message: commit.message,
        date: commit.date,
        fileCount: commit.files.length
      }
    });
  }

  /**
   * 添加作者节点
   */
  private addAuthorNode(commit: GitCommit): void {
    const authorId = `person:${commit.email}`;

    // 检查作者节点是否已存在
    if (!this.graph.getNode(authorId)) {
      this.graph.addNode({
        id: authorId,
        type: 'person',
        label: commit.author,
        properties: {
          name: commit.author,
          email: commit.email
        }
      });
    }
  }

  /**
   * 添加文件节点
   */
  private addFileNodes(commit: GitCommit): void {
    for (const file of commit.files) {
      const fileId = `file:${file}`;

      if (!this.graph.getNode(fileId)) {
        this.graph.addNode({
          id: fileId,
          type: 'file',
          label: file,
          properties: {
            path: file
          }
        });
      }
    }
  }

  /**
   * 添加关系
   */
  private addRelationships(commit: GitCommit): void {
    const commitId = `commit:${commit.hash}`;
    const authorId = `person:${commit.email}`;

    // 作者 → 提交
    this.graph.addEdge({
      from: authorId,
      to: commitId,
      type: 'authored-by',
      weight: 1.0
    });

    // 提交 → 文件
    for (const file of commit.files) {
      this.graph.addEdge({
        from: commitId,
        to: `file:${file}`,
        type: 'mentions',
        weight: 0.7
      });
    }
  }
}
