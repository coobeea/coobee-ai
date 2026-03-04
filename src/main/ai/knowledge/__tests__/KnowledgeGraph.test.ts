/**
 * KnowledgeGraph 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KnowledgeGraph } from '../KnowledgeGraph';
import { GraphStore } from '../storage/GraphStore';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('KnowledgeGraph', () => {
  let graph: KnowledgeGraph;
  let testDbPath: string;

  beforeEach(async () => {
    const tmpDir = fs.mkdtempSync(path.join(__dirname, 'tmp-graph-'));
    testDbPath = path.join(tmpDir, 'test-graph.db');

    GraphStore.resetInstance();
    graph = await KnowledgeGraph.create();
  });

  afterEach(() => {
    GraphStore.resetInstance();
    if (fs.existsSync(path.dirname(testDbPath))) {
      fs.rmSync(path.dirname(testDbPath), { recursive: true, force: true });
    }
  });

  describe('Node operations', () => {
    it('should add and retrieve node', () => {
      const node = graph.addNode({
        id: 'test-node-1',
        type: 'concept',
        label: 'Test Concept',
        properties: { description: 'A test concept' }
      });

      expect(node.id).toBe('test-node-1');
      expect(node.type).toBe('concept');

      const retrieved = graph.getNode('test-node-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.label).toBe('Test Concept');
    });

    it('should return null for non-existent node', () => {
      const node = graph.getNode('non-existent');
      expect(node).toBeNull();
    });

    it('should delete node', () => {
      graph.addNode({
        id: 'test-node-2',
        type: 'file',
        label: 'test.ts',
        properties: { path: 'test.ts' }
      });

      expect(graph.getNode('test-node-2')).not.toBeNull();

      graph.deleteNode('test-node-2');
      expect(graph.getNode('test-node-2')).toBeNull();
    });
  });

  describe('Edge operations', () => {
    it('should add edge between nodes', () => {
      graph.addNode({ id: 'node-a', type: 'file', label: 'A', properties: {} });
      graph.addNode({ id: 'node-b', type: 'file', label: 'B', properties: {} });

      const edge = graph.addEdge({
        from: 'node-a',
        to: 'node-b',
        type: 'imports',
        weight: 0.9
      });

      expect(edge.from).toBe('node-a');
      expect(edge.to).toBe('node-b');
      expect(edge.type).toBe('imports');
    });

    it('should get neighbors', () => {
      graph.addNode({ id: 'center', type: 'file', label: 'Center', properties: {} });
      graph.addNode({ id: 'neighbor-1', type: 'file', label: 'N1', properties: {} });
      graph.addNode({ id: 'neighbor-2', type: 'file', label: 'N2', properties: {} });

      graph.addEdge({ from: 'center', to: 'neighbor-1', type: 'calls', weight: 1.0 });
      graph.addEdge({ from: 'center', to: 'neighbor-2', type: 'imports', weight: 0.8 });

      const neighbors = graph.getNeighbors('center');
      expect(neighbors.length).toBe(2);

      const callNeighbors = graph.getNeighbors('center', 'calls');
      expect(callNeighbors.length).toBe(1);
      expect(callNeighbors[0].id).toBe('neighbor-1');
    });
  });

  describe('Query operations', () => {
    it('should query nodes by type', () => {
      graph.addNode({ id: 'file-1', type: 'file', label: 'F1', properties: {} });
      graph.addNode({ id: 'file-2', type: 'file', label: 'F2', properties: {} });
      graph.addNode({ id: 'func-1', type: 'function', label: 'Fn1', properties: {} });

      const result = graph.query({ nodeTypes: ['file'] });
      expect(result.nodes.length).toBe(2);
      expect(result.nodes.every((n) => n.type === 'file')).toBe(true);
    });

    it('should query with limit and offset', () => {
      for (let i = 0; i < 10; i++) {
        graph.addNode({ id: `node-${i}`, type: 'file', label: `N${i}`, properties: {} });
      }

      const page1 = graph.query({ limit: 5, offset: 0 });
      expect(page1.nodes.length).toBe(5);

      const page2 = graph.query({ limit: 5, offset: 5 });
      expect(page2.nodes.length).toBe(5);
    });
  });

  describe('Path finding', () => {
    it('should find shortest path', () => {
      graph.addNode({ id: 'a', type: 'file', label: 'A', properties: {} });
      graph.addNode({ id: 'b', type: 'file', label: 'B', properties: {} });
      graph.addNode({ id: 'c', type: 'file', label: 'C', properties: {} });

      graph.addEdge({ from: 'a', to: 'b', type: 'calls', weight: 1.0 });
      graph.addEdge({ from: 'b', to: 'c', type: 'calls', weight: 1.0 });

      const pathResult = graph.findPath('a', 'c');
      expect(pathResult).not.toBeNull();
      expect(pathResult?.path).toEqual(['a', 'b', 'c']);
      expect(pathResult?.length).toBe(2);
    });

    it('should return null when no path exists', () => {
      graph.addNode({ id: 'x', type: 'file', label: 'X', properties: {} });
      graph.addNode({ id: 'y', type: 'file', label: 'Y', properties: {} });

      const pathResult = graph.findPath('x', 'y');
      expect(pathResult).toBeNull();
    });
  });

  describe('Statistics', () => {
    it('should return correct stats', () => {
      graph.addNode({ id: 'f1', type: 'file', label: 'F1', properties: {} });
      graph.addNode({ id: 'f2', type: 'file', label: 'F2', properties: {} });
      graph.addNode({ id: 'fn1', type: 'function', label: 'Fn1', properties: {} });

      graph.addEdge({ from: 'f1', to: 'f2', type: 'imports', weight: 1.0 });

      const stats = graph.getStats();
      expect(stats.nodeCount).toBe(3);
      expect(stats.edgeCount).toBe(1);
      expect(stats.nodesByType.file).toBe(2);
      expect(stats.nodesByType.function).toBe(1);
    });
  });

  describe('Clear', () => {
    it('should clear all data', () => {
      graph.addNode({ id: 'n1', type: 'file', label: 'N1', properties: {} });
      graph.addEdge({ from: 'n1', to: 'n1', type: 'calls', weight: 1.0 });

      let stats = graph.getStats();
      expect(stats.nodeCount).toBeGreaterThan(0);

      graph.clear();

      stats = graph.getStats();
      expect(stats.nodeCount).toBe(0);
      expect(stats.edgeCount).toBe(0);
    });
  });
});
