/**
 * TransferManager 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TransferManager } from '../TransferManager';
import { KnowledgeExtractor } from '../KnowledgeExtractor';
import { KnowledgeAdapter } from '../KnowledgeAdapter';
import type { AdaptationConfig } from '../types';

describe('TransferManager', () => {
  let manager: TransferManager;

  beforeEach(() => {
    manager = new TransferManager();
  });

  describe('Package creation', () => {
    it('should create knowledge package', async () => {
      const pkg = await manager.createPackage('/test/project', 'Test Package');

      expect(pkg.name).toBe('Test Package');
      expect(pkg.sourceProject).toBe('/test/project');
      expect(pkg.items.length).toBeGreaterThan(0);
    });

    it('should list packages', async () => {
      await manager.createPackage('/project1', 'Package 1');
      await manager.createPackage('/project2', 'Package 2');

      const packages = manager.listPackages();
      expect(packages.length).toBe(2);
    });
  });

  describe('Knowledge transfer', () => {
    it('should transfer package to target project', async () => {
      const pkg = await manager.createPackage('/source', 'Test Package');

      const config: AdaptationConfig = {
        autoAdaptThreshold: 0.7,
        similarityMethod: 'hybrid',
        requireHumanReview: false
      };

      const task = await manager.transferPackage(pkg.id, '/target', config);

      expect(task.status).toBe('completed');
      expect(task.progress).toBe(1.0);
      expect(task.adaptationResult).toBeDefined();
    });

    it('should track transfer progress', async () => {
      const pkg = await manager.createPackage('/source', 'Test Package');

      const config: AdaptationConfig = {
        autoAdaptThreshold: 0.7,
        similarityMethod: 'keyword',
        requireHumanReview: false
      };

      const task = await manager.transferPackage(pkg.id, '/target', config);

      const retrieved = manager.getTask(task.id);
      expect(retrieved?.status).toBe('completed');
    });
  });
});

describe('KnowledgeExtractor', () => {
  let extractor: KnowledgeExtractor;

  beforeEach(() => {
    extractor = new KnowledgeExtractor();
  });

  it('should extract knowledge from project', async () => {
    const pkg = await extractor.extractFromProject('/test/project', 'Test');

    expect(pkg.items.length).toBeGreaterThan(0);
    expect(pkg.tags.length).toBeGreaterThan(0);
  });
});

describe('KnowledgeAdapter', () => {
  let adapter: KnowledgeAdapter;

  beforeEach(() => {
    adapter = new KnowledgeAdapter();
  });

  it('should adapt package to target project', async () => {
    const pkg = await new KnowledgeExtractor().extractFromProject('/source', 'Test');

    const config: AdaptationConfig = {
      autoAdaptThreshold: 0.7,
      similarityMethod: 'keyword',
      requireHumanReview: false
    };

    const result = await adapter.adaptToProject(pkg, '/target', config);

    expect(result.applicable.length + result.modified.length + result.skipped.length).toBe(pkg.items.length);
  });
});
