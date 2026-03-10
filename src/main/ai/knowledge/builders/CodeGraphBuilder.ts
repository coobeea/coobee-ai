/**
 * CodeGraphBuilder - 代码图谱构建器
 *
 * 从代码库中提取节点和关系，构建代码知识图谱
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createLogger } from '@main/common/logger';
import type { KnowledgeGraph } from '../KnowledgeGraph';

const log = createLogger('code-graph-builder');

export class CodeGraphBuilder {
  private graph: KnowledgeGraph;

  constructor(graph: KnowledgeGraph) {
    this.graph = graph;
  }

  /**
   * 构建项目代码图谱
   */
  async buildFromProject(projectPath: string): Promise<void> {
    log.info(`[CodeGraphBuilder] Building code graph from ${projectPath}`);

    const files = await this.scanFiles(projectPath, ['.ts', '.tsx', '.js', '.jsx', '.vue']);

    for (const file of files) {
      await this.analyzeFile(file, projectPath);
    }

    log.info(`[CodeGraphBuilder] Code graph built with ${files.length} files`);
  }

  /**
   * 扫描文件
   */
  private async scanFiles(dir: string, extensions: string[]): Promise<string[]> {
    const results: string[] = [];

    const scan = async (currentDir: string): Promise<void> => {
      const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          // 跳过 node_modules 等
          if (['node_modules', '.git', 'dist', 'build', '.next'].includes(entry.name)) {
            continue;
          }
          await scan(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (extensions.includes(ext)) {
            results.push(fullPath);
          }
        }
      }
    };

    await scan(dir);
    return results;
  }

  /**
   * 分析单个文件
   */
  private async analyzeFile(filePath: string, projectPath: string): Promise<void> {
    const relativePath = path.relative(projectPath, filePath);
    const content = await fs.promises.readFile(filePath, 'utf-8');

    // 添加文件节点
    this.graph.addNode({
      id: `file:${relativePath}`,
      type: 'file',
      label: path.basename(filePath),
      properties: {
        path: relativePath,
        extension: path.extname(filePath),
        lines: content.split('\n').length
      }
    });

    // 简单的 import 分析（正则匹配）
    this.extractImports(content, relativePath);

    // 简单的函数/类分析
    this.extractSymbols(content, relativePath);
  }

  /**
   * 提取 import 关系
   */
  private extractImports(content: string, filePath: string): void {
    const importRegex = /import\s+.*?\s+from\s+['"](.+?)['"]/g;
    let match: RegExpExecArray | null;

    while ((match = importRegex.exec(content)) !== null) {
      const imported = match[1];

      // 只处理相对导入
      if (imported.startsWith('.')) {
        const targetPath = path.normalize(path.join(path.dirname(filePath), imported));

        this.graph.addEdge({
          from: `file:${filePath}`,
          to: `file:${targetPath}`,
          type: 'imports',
          weight: 0.8
        });
      }
    }
  }

  /**
   * 提取函数和类
   */
  private extractSymbols(content: string, filePath: string): void {
    // 函数声明
    const functionRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;
    let match: RegExpExecArray | null;

    while ((match = functionRegex.exec(content)) !== null) {
      const funcName = match[1];
      const nodeId = `function:${filePath}:${funcName}`;

      this.graph.addNode({
        id: nodeId,
        type: 'function',
        label: funcName,
        properties: {
          file: filePath,
          name: funcName
        }
      });

      this.graph.addEdge({
        from: `file:${filePath}`,
        to: nodeId,
        type: 'depends-on',
        weight: 1.0
      });
    }

    // 类声明
    const classRegex = /(?:export\s+)?class\s+(\w+)/g;

    while ((match = classRegex.exec(content)) !== null) {
      const className = match[1];
      const nodeId = `class:${filePath}:${className}`;

      this.graph.addNode({
        id: nodeId,
        type: 'class',
        label: className,
        properties: {
          file: filePath,
          name: className
        }
      });

      this.graph.addEdge({
        from: `file:${filePath}`,
        to: nodeId,
        type: 'depends-on',
        weight: 1.0
      });
    }
  }
}
