/**
 * ToolRegistry 全面测试
 *
 * 覆盖：
 *   - 单例模式
 *   - register / get / getAll / registerAll
 *   - 重复注册
 *   - 工具名唯一性
 *   - ToolDefinition 接口兼容性
 *   - AsyncGenerator 消费
 *   - 边界情况
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../registry';
import type { ToolDefinition, ToolStreamUpdate, ToolResult } from '../types';
import { ToolCategory } from '../types';

/** 创建模拟工具 */
function mockTool(name: string, category: ToolCategory = ToolCategory.Extension): ToolDefinition {
  return {
    name,
    description: `Mock tool: ${name}`,
    category,
    parameters: z.object({}),
    execute: async function* (): AsyncGenerator<ToolStreamUpdate, ToolResult, unknown> {
      yield { type: 'progress', content: 'working...' };
      return { success: true, llmContent: `executed ${name}` };
    }
  };
}

/** 创建带 needUserConfirm 的模拟工具 */
function mockToolWithConfirm(name: string, needConfirm: boolean): ToolDefinition {
  return {
    ...mockTool(name),
    needUserConfirm: needConfirm
  };
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    // 重置单例
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ToolRegistry as any).instance = undefined;
    registry = ToolRegistry.getInstance();
  });

  // --- 单例模式 ---

  describe('单例模式', () => {
    it('getInstance 返回同一实例', () => {
      const a = ToolRegistry.getInstance();
      const b = ToolRegistry.getInstance();
      expect(a).toBe(b);
    });

    it('重置后创建新实例', () => {
      const first = ToolRegistry.getInstance();
      first.register(mockTool('temp'));
      expect(first.getAll()).toHaveLength(1);

      // 重置单例
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ToolRegistry as any).instance = undefined;

      const second = ToolRegistry.getInstance();
      expect(second.getAll()).toHaveLength(0);
      expect(first).not.toBe(second);
    });
  });

  // --- register / get ---

  describe('register / get', () => {
    it('注册并获取工具', () => {
      const tool = mockTool('test_tool');
      registry.register(tool);
      expect(registry.get('test_tool')).toBe(tool);
    });

    it('获取不存在的工具返回 undefined', () => {
      expect(registry.get('not_exist')).toBeUndefined();
    });

    it('重复注册同名工具抛出错误', () => {
      registry.register(mockTool('dup'));
      expect(() => registry.register(mockTool('dup'))).toThrow('Tool dup already registered');
    });

    it('不同名称的工具可以注册', () => {
      registry.register(mockTool('tool_a'));
      registry.register(mockTool('tool_b'));
      expect(registry.get('tool_a')).toBeDefined();
      expect(registry.get('tool_b')).toBeDefined();
    });

    it('注册后获取到的是同一引用', () => {
      const tool = mockTool('ref_test');
      registry.register(tool);
      expect(registry.get('ref_test')).toBe(tool);
    });
  });

  // --- registerAll / getAll ---

  describe('registerAll / getAll', () => {
    it('批量注册工具', () => {
      const tools = [mockTool('a'), mockTool('b'), mockTool('c')];
      registry.registerAll(tools);
      expect(registry.getAll()).toHaveLength(3);
    });

    it('getAll 返回所有已注册工具', () => {
      const toolA = mockTool('x');
      const toolB = mockTool('y');
      registry.register(toolA);
      registry.register(toolB);
      const all = registry.getAll();
      expect(all).toHaveLength(2);
      expect(all).toContain(toolA);
      expect(all).toContain(toolB);
    });

    it('空注册表返回空数组', () => {
      expect(registry.getAll()).toHaveLength(0);
    });

    it('registerAll 遇到重复名称抛出错误', () => {
      registry.register(mockTool('existing'));
      expect(() => {
        registry.registerAll([mockTool('new_one'), mockTool('existing')]);
      }).toThrow('Tool existing already registered');
    });

    it('registerAll 中有同名工具抛出错误', () => {
      expect(() => {
        registry.registerAll([mockTool('same'), mockTool('same')]);
      }).toThrow('Tool same already registered');
    });

    it('getAll 返回数组副本（或实际引用）', () => {
      registry.register(mockTool('t1'));
      const all1 = registry.getAll();
      const all2 = registry.getAll();
      // 每次调用返回新的数组实例（从 Map.values() 构建）
      expect(all1).not.toBe(all2);
      expect(all1).toEqual(all2);
    });
  });

  // --- ToolDefinition 兼容性 ---

  describe('ToolDefinition 兼容性', () => {
    it('注册的工具具有完整的 ToolDefinition 属性', () => {
      const tool = mockTool('full');
      registry.register(tool);

      const retrieved = registry.get('full')!;
      expect(retrieved.name).toBe('full');
      expect(retrieved.description).toBeDefined();
      expect(retrieved.category).toBe(ToolCategory.Extension);
      expect(retrieved.parameters).toBeDefined();
      expect(typeof retrieved.execute).toBe('function');
    });

    it('工具 execute 返回 AsyncGenerator 可被正常消费', async () => {
      const tool = mockTool('runnable');
      registry.register(tool);

      const gen = registry.get('runnable')!.execute({});
      const updates: ToolStreamUpdate[] = [];
      let iterResult = await gen.next();
      while (!iterResult.done) {
        updates.push(iterResult.value);
        iterResult = await gen.next();
      }
      const result = iterResult.value;

      expect(updates.length).toBeGreaterThan(0);
      expect(updates[0].type).toBe('progress');
      expect(result.success).toBe(true);
      expect(result.llmContent).toBe('executed runnable');
    });

    it('支持不同 ToolCategory 的工具', () => {
      registry.register(mockTool('fs_tool', ToolCategory.FileSystem));
      registry.register(mockTool('exec_tool', ToolCategory.Execute));
      registry.register(mockTool('web_tool', ToolCategory.Web));
      registry.register(mockTool('search_tool', ToolCategory.Search));

      expect(registry.get('fs_tool')!.category).toBe(ToolCategory.FileSystem);
      expect(registry.get('exec_tool')!.category).toBe(ToolCategory.Execute);
      expect(registry.get('web_tool')!.category).toBe(ToolCategory.Web);
      expect(registry.get('search_tool')!.category).toBe(ToolCategory.Search);
    });

    it('支持 needUserConfirm 元数据', () => {
      registry.register(mockToolWithConfirm('safe', false));
      registry.register(mockToolWithConfirm('dangerous', true));

      expect(registry.get('safe')!.needUserConfirm).toBe(false);
      expect(registry.get('dangerous')!.needUserConfirm).toBe(true);
    });

    it('不带 needUserConfirm 的工具默认 undefined', () => {
      registry.register(mockTool('default_confirm'));
      expect(registry.get('default_confirm')!.needUserConfirm).toBeUndefined();
    });
  });

  // --- 边界情况 ---

  describe('边界情况', () => {
    it('工具名可以包含特殊字符', () => {
      const tool = mockTool('my-tool_v2.0');
      registry.register(tool);
      expect(registry.get('my-tool_v2.0')).toBe(tool);
    });

    it('注册大量工具', () => {
      const tools = Array.from({ length: 100 }, (_, i) => mockTool(`tool_${i}`));
      registry.registerAll(tools);
      expect(registry.getAll()).toHaveLength(100);
      expect(registry.get('tool_0')).toBeDefined();
      expect(registry.get('tool_99')).toBeDefined();
    });

    it('注册后再次获取 getAll 包含新工具', () => {
      registry.register(mockTool('first'));
      expect(registry.getAll()).toHaveLength(1);

      registry.register(mockTool('second'));
      expect(registry.getAll()).toHaveLength(2);
    });
  });
});
