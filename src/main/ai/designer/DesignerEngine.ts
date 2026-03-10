/**
 * DesignerEngine - 设计器引擎
 *
 * 管理可视化工作流的创建和执行
 */

import { createLogger } from '@main/common/logger';
import type { DesignerNode, DesignerEdge, WorkflowTemplate } from './types';

const log = createLogger('designer-engine');

export class DesignerEngine {
  private templates = new Map<string, WorkflowTemplate>();

  /**
   * 创建模板
   */
  createTemplate(name: string, description: string): WorkflowTemplate {
    const id = `template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const template: WorkflowTemplate = {
      id,
      name,
      description,
      nodes: [],
      edges: [],
      tags: [],
      createdAt: Date.now()
    };

    this.templates.set(id, template);

    log.info(`[DesignerEngine] Created template: ${name}`);

    return template;
  }

  /**
   * 添加节点
   */
  addNode(templateId: string, node: DesignerNode): boolean {
    const template = this.templates.get(templateId);

    if (!template) return false;

    template.nodes.push(node);

    log.info(`[DesignerEngine] Added node ${node.id} to template ${templateId}`);

    return true;
  }

  /**
   * 添加连接
   */
  addEdge(templateId: string, edge: DesignerEdge): boolean {
    const template = this.templates.get(templateId);

    if (!template) return false;

    const sourceExists = template.nodes.some((n) => n.id === edge.source);
    const targetExists = template.nodes.some((n) => n.id === edge.target);

    if (!sourceExists || !targetExists) {
      log.warn(`[DesignerEngine] Invalid edge: source or target node not found`);
      return false;
    }

    template.edges.push(edge);

    log.info(`[DesignerEngine] Added edge ${edge.id} to template ${templateId}`);

    return true;
  }

  /**
   * 验证工作流
   */
  validateWorkflow(templateId: string): { valid: boolean; errors: string[] } {
    const template = this.templates.get(templateId);

    if (!template) {
      return { valid: false, errors: ['Template not found'] };
    }

    const errors: string[] = [];

    if (template.nodes.length === 0) {
      errors.push('工作流至少需要一个节点');
    }

    const agentNodes = template.nodes.filter((n) => n.type === 'agent');
    if (agentNodes.length === 0) {
      errors.push('工作流至少需要一个 Agent 节点');
    }

    for (const edge of template.edges) {
      const sourceNode = template.nodes.find((n) => n.id === edge.source);
      const targetNode = template.nodes.find((n) => n.id === edge.target);

      if (!sourceNode || !targetNode) {
        errors.push(`无效的连接: ${edge.id}`);
      }
    }

    const nodeIds = new Set(template.nodes.map((n) => n.id));
    if (nodeIds.size !== template.nodes.length) {
      errors.push('存在重复的节点 ID');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 导出为 JSON
   */
  exportTemplate(templateId: string): string | null {
    const template = this.templates.get(templateId);

    if (!template) return null;

    return JSON.stringify(template, null, 2);
  }

  /**
   * 从 JSON 导入
   */
  importTemplate(json: string): WorkflowTemplate | null {
    try {
      const template = JSON.parse(json) as WorkflowTemplate;

      this.templates.set(template.id, template);

      log.info(`[DesignerEngine] Imported template: ${template.name}`);

      return template;
    } catch (err) {
      log.error('[DesignerEngine] Failed to import template:', err);
      return null;
    }
  }

  /**
   * 获取模板
   */
  getTemplate(templateId: string): WorkflowTemplate | undefined {
    return this.templates.get(templateId);
  }

  /**
   * 列出所有模板
   */
  listTemplates(): WorkflowTemplate[] {
    return Array.from(this.templates.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 删除模板
   */
  deleteTemplate(templateId: string): boolean {
    const deleted = this.templates.delete(templateId);

    if (deleted) {
      log.info(`[DesignerEngine] Deleted template: ${templateId}`);
    }

    return deleted;
  }
}
