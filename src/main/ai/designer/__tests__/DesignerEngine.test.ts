/**
 * DesignerEngine 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DesignerEngine } from '../DesignerEngine';
import type { DesignerNode, DesignerEdge } from '../types';

describe('DesignerEngine', () => {
  let engine: DesignerEngine;

  beforeEach(() => {
    engine = new DesignerEngine();
  });

  describe('Template management', () => {
    it('should create template', () => {
      const template = engine.createTemplate('代码审查流程', '自动化代码审查工作流');

      expect(template.name).toBe('代码审查流程');
      expect(template.nodes.length).toBe(0);
      expect(template.edges.length).toBe(0);
    });

    it('should list templates', () => {
      engine.createTemplate('Template 1', 'Desc 1');
      engine.createTemplate('Template 2', 'Desc 2');

      const templates = engine.listTemplates();
      expect(templates.length).toBe(2);
    });

    it('should delete template', () => {
      const template = engine.createTemplate('Test', 'Test');

      const deleted = engine.deleteTemplate(template.id);
      expect(deleted).toBe(true);

      const retrieved = engine.getTemplate(template.id);
      expect(retrieved).toBeUndefined();
    });
  });

  describe('Node and edge management', () => {
    it('should add nodes to template', () => {
      const template = engine.createTemplate('Test', 'Test');

      const node: DesignerNode = {
        id: 'node-1',
        type: 'agent',
        label: 'Code Reviewer',
        position: { x: 100, y: 100 },
        data: { agentId: 'reviewer' }
      };

      const success = engine.addNode(template.id, node);
      expect(success).toBe(true);

      const updated = engine.getTemplate(template.id);
      expect(updated?.nodes.length).toBe(1);
    });

    it('should add edges between nodes', () => {
      const template = engine.createTemplate('Test', 'Test');

      const node1: DesignerNode = {
        id: 'node-1',
        type: 'agent',
        label: 'Agent 1',
        position: { x: 0, y: 0 },
        data: {}
      };

      const node2: DesignerNode = {
        id: 'node-2',
        type: 'agent',
        label: 'Agent 2',
        position: { x: 200, y: 0 },
        data: {}
      };

      engine.addNode(template.id, node1);
      engine.addNode(template.id, node2);

      const edge: DesignerEdge = {
        id: 'edge-1',
        source: 'node-1',
        target: 'node-2',
        type: 'flow'
      };

      const success = engine.addEdge(template.id, edge);
      expect(success).toBe(true);

      const updated = engine.getTemplate(template.id);
      expect(updated?.edges.length).toBe(1);
    });

    it('should reject invalid edges', () => {
      const template = engine.createTemplate('Test', 'Test');

      const node1: DesignerNode = {
        id: 'node-1',
        type: 'agent',
        label: 'Agent 1',
        position: { x: 0, y: 0 },
        data: {}
      };

      engine.addNode(template.id, node1);

      const invalidEdge: DesignerEdge = {
        id: 'edge-1',
        source: 'node-1',
        target: 'node-999',
        type: 'flow'
      };

      const success = engine.addEdge(template.id, invalidEdge);
      expect(success).toBe(false);
    });
  });

  describe('Workflow validation', () => {
    it('should validate complete workflow', () => {
      const template = engine.createTemplate('Test', 'Test');

      const node: DesignerNode = {
        id: 'agent-1',
        type: 'agent',
        label: 'Main Agent',
        position: { x: 0, y: 0 },
        data: {}
      };

      engine.addNode(template.id, node);

      const validation = engine.validateWorkflow(template.id);
      expect(validation.valid).toBe(true);
      expect(validation.errors.length).toBe(0);
    });

    it('should detect empty workflow', () => {
      const template = engine.createTemplate('Empty', 'Empty');

      const validation = engine.validateWorkflow(template.id);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('工作流至少需要一个节点');
    });

    it('should require at least one agent node', () => {
      const template = engine.createTemplate('Test', 'Test');

      const toolNode: DesignerNode = {
        id: 'tool-1',
        type: 'tool',
        label: 'Tool',
        position: { x: 0, y: 0 },
        data: {}
      };

      engine.addNode(template.id, toolNode);

      const validation = engine.validateWorkflow(template.id);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes('Agent 节点'))).toBe(true);
    });
  });

  describe('Import/Export', () => {
    it('should export template to JSON', () => {
      const template = engine.createTemplate('Test', 'Test');

      const node: DesignerNode = {
        id: 'node-1',
        type: 'agent',
        label: 'Agent',
        position: { x: 0, y: 0 },
        data: {}
      };

      engine.addNode(template.id, node);

      const json = engine.exportTemplate(template.id);
      expect(json).not.toBeNull();
      expect(json).toContain('Test');
    });

    it('should import template from JSON', () => {
      const template = engine.createTemplate('Original', 'Original');

      const node: DesignerNode = {
        id: 'node-1',
        type: 'agent',
        label: 'Agent',
        position: { x: 0, y: 0 },
        data: {}
      };

      engine.addNode(template.id, node);

      const json = engine.exportTemplate(template.id)!;

      const imported = engine.importTemplate(json);

      expect(imported).not.toBeNull();
      expect(imported?.name).toBe('Original');
      expect(imported?.nodes.length).toBe(1);
    });
  });
});
