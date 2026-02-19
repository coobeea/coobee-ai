/**
 * AgentEventWriter 子会话转发测试
 *
 * 覆盖 M-P0-2：子 Agent 审批事件转发到主 thread
 *   - 子会话事件转发到主会话
 *   - data 中包含 subSessionId 标记
 *   - 主会话不转发给自己
 *   - HITL 事件正确转发
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { IStreamEmitter } from '../streaming/StreamEmitter';

// Mock logger to avoid electron dependencies
vi.mock('@main/common/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

import { AgentEventWriter } from '../AgentEventWriter';

// Helper to create mock emitter
function createMockEmitter(): IStreamEmitter {
  return {
    forward: vi.fn(),
    emit: vi.fn()
  } as unknown as IStreamEmitter;
}

// ==================== Test Helpers ====================

let tempDir: string;

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-writer-sub-test-'));
}

function cleanupTempWorkspace(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ==================== Tests ====================

describe('AgentEventWriter - Sub-session Forwarding', () => {
  beforeEach(() => {
    tempDir = createTempWorkspace();
  });

  afterEach(() => {
    cleanupTempWorkspace(tempDir);
  });

  it('子会话事件转发到主会话', () => {
    // 创建主会话 writer
    const mainWriter = new AgentEventWriter(tempDir);
    const mainEmitter = createMockEmitter();
    mainWriter.register('main-session');
    mainWriter.setEmitter(mainEmitter);

    // 创建子会话 writer
    const childWorkspace = path.join(tempDir, 'child');
    fs.mkdirSync(childWorkspace, { recursive: true });
    const childWriter = new AgentEventWriter(childWorkspace);
    const childEmitter = createMockEmitter();
    childWriter.register('main-session:child-1');
    childWriter.setEmitter(childEmitter);

    // 子会话发送事件
    AgentEventWriter.dispatchForSession('main-session:child-1', {
      type: 'hitl:required',
      content: 'Child needs approval',
      data: { toolName: 'exec', index: 0 }
    });

    // 验证子会话收到事件
    expect(childEmitter.forward).toHaveBeenCalledTimes(1);
    expect(childEmitter.forward).toHaveBeenCalledWith({
      type: 'hitl:required',
      content: 'Child needs approval',
      data: { toolName: 'exec', index: 0 }
    });

    // 验证主会话也收到转发的事件，且包含 subSessionId
    expect(mainEmitter.forward).toHaveBeenCalledTimes(1);
    expect(mainEmitter.forward).toHaveBeenCalledWith({
      type: 'hitl:required',
      content: 'Child needs approval',
      data: {
        toolName: 'exec',
        index: 0,
        subSessionId: 'main-session:child-1' // 标记来源
      }
    });
  });

  it('主会话事件不转发给自己', () => {
    const mainWriter = new AgentEventWriter(tempDir);
    const mainEmitter = createMockEmitter();
    mainWriter.register('main-session');
    mainWriter.setEmitter(mainEmitter);

    // 主会话发送事件（不包含冒号）
    AgentEventWriter.dispatchForSession('main-session', {
      type: 'run:start',
      content: 'Main session started'
    });

    // 验证主会话只收到一次（没有转发）
    expect(mainEmitter.forward).toHaveBeenCalledTimes(1);
    expect(mainEmitter.forward).toHaveBeenCalledWith({
      type: 'run:start',
      content: 'Main session started'
    });
  });

  it('多层嵌套子会话转发到顶层主会话', () => {
    // 创建主会话
    const mainWriter = new AgentEventWriter(tempDir);
    const mainEmitter = createMockEmitter();
    mainWriter.register('main-session');
    mainWriter.setEmitter(mainEmitter);

    // 创建二级子会话
    const child2Workspace = path.join(tempDir, 'child2');
    fs.mkdirSync(child2Workspace, { recursive: true });
    const child2Writer = new AgentEventWriter(child2Workspace);
    const child2Emitter = createMockEmitter();
    child2Writer.register('main-session:child-1:child-2');
    child2Writer.setEmitter(child2Emitter);

    // 二级子会话发送事件
    AgentEventWriter.dispatchForSession('main-session:child-1:child-2', {
      type: 'hitl:required',
      content: 'Nested child needs approval',
      data: { toolName: 'delete_file', index: 0 }
    });

    // 验证二级子会话收到事件
    expect(child2Emitter.forward).toHaveBeenCalledTimes(1);

    // 验证主会话收到转发事件
    expect(mainEmitter.forward).toHaveBeenCalledTimes(1);
    expect(mainEmitter.forward).toHaveBeenCalledWith({
      type: 'hitl:required',
      content: 'Nested child needs approval',
      data: {
        toolName: 'delete_file',
        index: 0,
        subSessionId: 'main-session:child-1:child-2'
      }
    });
  });

  it('HITL approved 事件正确转发', () => {
    // 创建主会话和子会话
    const mainWriter = new AgentEventWriter(tempDir);
    const mainEmitter = createMockEmitter();
    mainWriter.register('main-session');
    mainWriter.setEmitter(mainEmitter);

    const childWorkspace = path.join(tempDir, 'child');
    fs.mkdirSync(childWorkspace, { recursive: true });
    const childWriter = new AgentEventWriter(childWorkspace);
    const childEmitter = createMockEmitter();
    childWriter.register('main-session:child-1');
    childWriter.setEmitter(childEmitter);

    // 子会话发送审批通过事件
    AgentEventWriter.dispatchForSession('main-session:child-1', {
      type: 'hitl:approved',
      content: 'approved: exec',
      data: { toolName: 'exec', index: 0, action: 'approved' }
    });

    // 验证主会话收到转发
    expect(mainEmitter.forward).toHaveBeenCalledTimes(1);
    expect(mainEmitter.forward).toHaveBeenCalledWith({
      type: 'hitl:approved',
      content: 'approved: exec',
      data: {
        toolName: 'exec',
        index: 0,
        action: 'approved',
        subSessionId: 'main-session:child-1'
      }
    });
  });

  it('HITL rejected 事件正确转发', () => {
    // 创建主会话和子会话
    const mainWriter = new AgentEventWriter(tempDir);
    const mainEmitter = createMockEmitter();
    mainWriter.register('main-session');
    mainWriter.setEmitter(mainEmitter);

    const childWorkspace = path.join(tempDir, 'child');
    fs.mkdirSync(childWorkspace, { recursive: true });
    const childWriter = new AgentEventWriter(childWorkspace);
    const childEmitter = createMockEmitter();
    childWriter.register('main-session:child-1');
    childWriter.setEmitter(childEmitter);

    // 子会话发送审批拒绝事件
    AgentEventWriter.dispatchForSession('main-session:child-1', {
      type: 'hitl:rejected',
      content: 'rejected: exec',
      data: { toolName: 'exec', index: 0, action: 'rejected' }
    });

    // 验证主会话收到转发
    expect(mainEmitter.forward).toHaveBeenCalledTimes(1);
    expect(mainEmitter.forward).toHaveBeenCalledWith({
      type: 'hitl:rejected',
      content: 'rejected: exec',
      data: {
        toolName: 'exec',
        index: 0,
        action: 'rejected',
        subSessionId: 'main-session:child-1'
      }
    });
  });

  it('主会话未注册时子会话事件不转发', () => {
    // 只创建子会话，主会话未注册
    const childWorkspace = path.join(tempDir, 'child');
    fs.mkdirSync(childWorkspace, { recursive: true });
    const childWriter = new AgentEventWriter(childWorkspace);
    const childEmitter = createMockEmitter();
    childWriter.register('main-session:child-1');
    childWriter.setEmitter(childEmitter);

    // 子会话发送事件
    AgentEventWriter.dispatchForSession('main-session:child-1', {
      type: 'hitl:required',
      content: 'Child needs approval'
    });

    // 验证子会话收到事件
    expect(childEmitter.forward).toHaveBeenCalledTimes(1);

    // 主会话未注册，不会崩溃（静默失败）
  });

  it('子会话未注册时事件被丢弃', () => {
    // 不注册任何 writer
    AgentEventWriter.dispatchForSession('main-session:orphan-child', {
      type: 'hitl:required',
      content: 'Orphan child'
    });

    // 不应抛错，静默丢弃
  });
});
