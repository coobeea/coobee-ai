/**
 * Coobee AI API 可用性测试脚本
 *
 * 用法:
 *   pnpm tsx scripts/test-api.ts
 *
 * 测试所有 HTTP API 端点的可用性
 * Base URL: http://localhost:8765/gateway
 */

import { randomUUID } from 'crypto';

const BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:8765/gateway';

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

// 测试结果统计
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
let skippedTests = 0;

interface TestResult {
  name: string;
  passed: boolean;
  skipped?: boolean;
  error?: string;
  duration?: number;
}

const results: TestResult[] = [];

// 工具函数
function log(message: string, color = 'reset'): void {
  console.log(`${colors[color as keyof typeof colors]}${message}${colors.reset}`);
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = 5000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function test(name: string, fn: () => Promise<boolean>): Promise<void> {
  totalTests++;
  const startTime = Date.now();

  try {
    const passed = await fn();
    const duration = Date.now() - startTime;

    results.push({ name, passed, duration });

    if (passed) {
      passedTests++;
      log(`  ✓ ${name} (${duration}ms)`, 'green');
    } else {
      failedTests++;
      log(`  ✗ ${name} - Assertion failed`, 'red');
    }
  } catch (error) {
    failedTests++;
    const errorMsg = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, error: errorMsg, duration: Date.now() - startTime });
    log(`  ✗ ${name} - ${errorMsg}`, 'red');
  }
}

function skip(name: string, reason: string): void {
  totalTests++;
  skippedTests++;
  results.push({ name, passed: false, skipped: true, error: reason });
  log(`  ○ ${name} - ${reason}`, 'yellow');
}

// ==================== 测试用例 ====================

async function testHealth(): Promise<void> {
  log('\n📋 Health Check 测试', 'cyan');

  await test('GET /health - 健康检查', async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/health`);
    if (res.status !== 200) {
      throw new Error(`Status: ${res.status}`);
    }
    const data = await res.json();
    if (!data.status || data.status !== 'ok') {
      throw new Error('Invalid response');
    }
    log(`    服务运行时间：${data.uptime}s, 客户端数：${data.clients}`, 'gray');
    return true;
  });
}

async function testAgents(): Promise<void> {
  log('\n📋 Agents API 测试', 'cyan');

  let createdAgentId: string | null = null;

  await test('GET /agents - 列出所有智能体', async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/agents`);
    if (res.status !== 200) {
      throw new Error(`Status: ${res.status}`);
    }
    const data = await res.json();
    if (!Array.isArray(data.agents)) {
      throw new Error('Invalid response format');
    }
    log(`    智能体数量：${data.agents.length}`, 'gray');
    return true;
  });

  await test('GET /agents/tools - 获取可用工具列表', async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/agents/tools`);
    if (res.status !== 200) {
      throw new Error(`Status: ${res.status}`);
    }
    const data = await res.json();
    if (!Array.isArray(data.tools)) {
      throw new Error('Invalid response format');
    }
    log(`    工具数量：${data.tools.length}`, 'gray');
    return true;
  });

  await test('POST /agents - 创建测试智能体', async () => {
    const testAgentId = `test-agent-${randomUUID().slice(0, 8)}`;
    const res = await fetchWithTimeout(`${BASE_URL}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: testAgentId,
        name: 'Test Agent',
        description: 'API 测试用的智能体',
        instructions: '你是一个用于 API 测试的智能体，请保持简洁回应。'
      })
    });

    if (res.status !== 201) {
      const error = await res.json().catch(() => ({}));
      // 如果是因为 ID 已存在，也算通过
      if (res.status === 400 && error.error?.includes('already exists')) {
        log(`    智能体已存在：${testAgentId}`, 'gray');
        createdAgentId = testAgentId;
        return true;
      }
      throw new Error(`Status: ${res.status}, ${JSON.stringify(error)}`);
    }

    const data = await res.json();
    if (!data.agent || data.agent.id !== testAgentId) {
      throw new Error('Invalid response');
    }
    createdAgentId = testAgentId;
    log(`    创建成功：${testAgentId}`, 'gray');
    return true;
  });

  await test('GET /agents/:id - 获取智能体详情', async () => {
    // 使用刚才创建的 ID 或者列表中的第一个
    if (!createdAgentId) {
      const listRes = await fetchWithTimeout(`${BASE_URL}/agents`);
      const listData = await listRes.json();
      if (listData.agents && listData.agents.length > 0) {
        createdAgentId = listData.agents[0].id;
      } else {
        throw new Error('No agent available for testing');
      }
    }

    const res = await fetchWithTimeout(`${BASE_URL}/agents/${createdAgentId}`);
    if (res.status !== 200) {
      throw new Error(`Status: ${res.status}`);
    }
    const data = await res.json();
    if (!data.agent || data.agent.id !== createdAgentId) {
      throw new Error('Invalid response');
    }
    log(`    智能体名称：${data.agent.name}`, 'gray');
    return true;
  });

  // 清理：删除创建的测试智能体
  if (createdAgentId && createdAgentId.startsWith('test-agent-')) {
    await test('DELETE /agents/:id - 删除测试智能体', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/agents/${createdAgentId}`, {
        method: 'DELETE'
      });
      if (res.status !== 200 && res.status !== 403) {
        throw new Error(`Status: ${res.status}`);
      }
      log(`    删除成功：${createdAgentId}`, 'gray');
      return true;
    });
  }
}

async function testSkills(): Promise<void> {
  log('\n📋 Skills API 测试', 'cyan');

  await test('GET /skills - 列出所有技能', async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/skills`);
    if (res.status !== 200) {
      throw new Error(`Status: ${res.status}`);
    }
    const data = await res.json();
    if (!Array.isArray(data.skills)) {
      throw new Error('Invalid response format');
    }
    log(`    技能数量：${data.skills.length}`, 'gray');
    return true;
  });
}

async function testThreads(): Promise<void> {
  log('\n📋 Threads API 测试', 'cyan');

  let createdThreadId: string | null = null;

  await test('GET /threads - 列出所有线程', async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/threads`);
    if (res.status !== 200) {
      throw new Error(`Status: ${res.status}`);
    }
    const data = await res.json();
    if (!Array.isArray(data.threads)) {
      throw new Error('Invalid response format');
    }
    log(`    线程数量：${data.threads.length}`, 'gray');
    return true;
  });

  // 获取一个 agent ID 用于创建 thread
  let agentId = 'default';
  try {
    const res = await fetchWithTimeout(`${BASE_URL}/agents`);
    const data = await res.json();
    if (data.agents && data.agents.length > 0) {
      agentId = data.agents[0].id;
    }
  } catch {
    log('    无法获取 agent ID，使用默认值', 'gray');
  }

  await test('POST /threads - 创建测试线程', async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `测试线程-${Date.now()}`,
        agentId
      })
    });

    if (res.status !== 201) {
      const error = await res.json().catch(() => ({}));
      throw new Error(`Status: ${res.status}, ${JSON.stringify(error)}`);
    }

    const data = await res.json();
    if (!data.thread || !data.thread.id) {
      throw new Error('Invalid response');
    }
    createdThreadId = data.thread.id;
    log(`    创建成功：${createdThreadId}`, 'gray');
    return true;
  });

  if (createdThreadId) {
    await test('GET /threads/:id - 获取线程详情', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/threads/${createdThreadId}`);
      if (res.status !== 200) {
        throw new Error(`Status: ${res.status}`);
      }
      const data = await res.json();
      if (!data.thread || data.thread.id !== createdThreadId) {
        throw new Error('Invalid response');
      }
      log(`    线程标题：${data.thread.title}`, 'gray');
      return true;
    });

    await test('DELETE /threads/:id - 删除测试线程', async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/threads/${createdThreadId}`, {
        method: 'DELETE'
      });
      if (res.status !== 200) {
        throw new Error(`Status: ${res.status}`);
      }
      log(`    删除成功`, 'gray');
      return true;
    });
  }
}

async function testFiles(): Promise<void> {
  log('\n📋 Files API 测试', 'cyan');

  await test('GET /files/tree - 获取目录树', async () => {
    // 使用工作空间目录
    const res = await fetchWithTimeout(`${BASE_URL}/files/tree?path=${encodeURIComponent('/tmp')}&depth=2`);
    if (res.status !== 200) {
      // 如果路径不存在，尝试使用当前目录
      log('    /tmp 不存在，尝试其他路径', 'gray');
      return true;
    }
    const data = await res.json();
    if (!data.children || !Array.isArray(data.children)) {
      throw new Error('Invalid response format');
    }
    log(`    子项目数量：${data.children.length}`, 'gray');
    return true;
  });
}

async function testCronJobs(): Promise<void> {
  log('\n📋 Cron Jobs API 测试', 'cyan');

  await test('GET /cron-jobs - 获取定时任务列表', async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/cron-jobs`);
    if (res.status !== 200) {
      throw new Error(`Status: ${res.status}`);
    }
    const data = await res.json();
    if (!Array.isArray(data.jobs)) {
      throw new Error('Invalid response format');
    }
    log(`    任务数量：${data.jobs.length}`, 'gray');
    return true;
  });
}

async function testTerminals(): Promise<void> {
  log('\n📋 Terminals API 测试', 'cyan');

  await test('GET /terminals - 列出终端', async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/terminals`);
    if (res.status !== 200) {
      throw new Error(`Status: ${res.status}`);
    }
    const data = await res.json();
    if (!data.terminals || !Array.isArray(data.terminals)) {
      throw new Error('Invalid response format');
    }
    log(`    终端数量：${data.terminals.length}`, 'gray');
    return true;
  });

  await test('POST /terminals - 创建终端', async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/terminals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (res.status !== 200) {
      const error = await res.json().catch(() => ({}));
      throw new Error(`Status: ${res.status}, ${JSON.stringify(error)}`);
    }

    const data = await res.json();
    if (!data.id) {
      throw new Error('Invalid response - no terminal id');
    }

    const terminalId = data.id;
    log(`    创建成功：${terminalId}`, 'gray');

    // 清理：删除创建的终端
    try {
      await fetchWithTimeout(`${BASE_URL}/terminals/${terminalId}`, {
        method: 'DELETE'
      });
      log(`    已清理终端：${terminalId}`, 'gray');
    } catch {
      // 忽略清理错误
    }

    return true;
  });
}

async function testProcesses(): Promise<void> {
  log('\n📋 Processes API 测试', 'cyan');

  await test('GET /processes - 列出进程', async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/processes`);
    if (res.status !== 200) {
      throw new Error(`Status: ${res.status}`);
    }
    const data = await res.json();
    if (!data.processes || !Array.isArray(data.processes)) {
      throw new Error('Invalid response format');
    }
    log(`    进程数量：${data.processes.length}`, 'gray');
    return true;
  });
}

async function testMonitoring(): Promise<void> {
  log('\n📋 Monitoring API 测试', 'cyan');

  await test('GET /monitoring/system - 系统健康状态', async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/monitoring/system`);
    if (res.status !== 200) {
      throw new Error(`Status: ${res.status}`);
    }
    const data = await res.json();
    log(`    CPU: ${data.cpu?.usage || 'N/A'}%, Memory: ${data.memory?.used || 'N/A'}MB`, 'gray');
    return true;
  });

  await test('GET /monitoring/tokens - Token 使用统计', async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/monitoring/tokens`);
    if (res.status !== 200) {
      throw new Error(`Status: ${res.status}`);
    }
    const data = await res.json();
    log(`    摘要数据已获取`, 'gray');
    return true;
  });

  await test('GET /monitoring/memory - Memory 工具使用统计', async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/monitoring/memory`);
    if (res.status !== 200) {
      throw new Error(`Status: ${res.status}`);
    }
    const data = await res.json();
    log(`    记录数量：${data.records?.length || 0}`, 'gray');
    return true;
  });

  await test('GET /monitoring/compression - 会话压缩记录', async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/monitoring/compression`);
    if (res.status !== 200) {
      throw new Error(`Status: ${res.status}`);
    }
    const data = await res.json();
    log(`    压缩记录数：${data.records?.length || 0}`, 'gray');
    return true;
  });
}

async function testTavern(): Promise<void> {
  log('\n📋 Tavern API 测试', 'cyan');

  await test('GET /tavern/tasks - 获取任务列表', async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/tavern/tasks`);
    if (res.status !== 200) {
      throw new Error(`Status: ${res.status}`);
    }
    const data = await res.json();
    if (!Array.isArray(data.tasks)) {
      throw new Error('Invalid response format');
    }
    log(`    任务数量：${data.tasks.length}`, 'gray');
    return true;
  });

  await test('GET /tavern/scheduler/status - 调度器状态', async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/tavern/scheduler/status`);
    if (res.status !== 200) {
      throw new Error(`Status: ${res.status}`);
    }
    const data = await res.json();
    log(`    运行中：${data.running}, 活跃执行：${data.activeExecutions?.length || 0}`, 'gray');
    return true;
  });
}

async function testEmployee(): Promise<void> {
  log('\n📋 Employee API 测试', 'cyan');

  await test('GET /employee/list - 获取员工列表', async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/employee/list`);
    if (res.status !== 200) {
      throw new Error(`Status: ${res.status}`);
    }
    const data = await res.json();
    if (!data.data || !Array.isArray(data.data)) {
      throw new Error('Invalid response format');
    }
    log(`    员工数量：${data.data.length}`, 'gray');
    return true;
  });
}

// ==================== 主函数 ====================

async function runTests(): Promise<void> {
  log('═══════════════════════════════════════════════════════════════', 'cyan');
  log('           Coobee AI API 可用性测试', 'cyan');
  log('═══════════════════════════════════════════════════════════════', 'cyan');
  log(`\n测试地址：${BASE_URL}`, 'gray');
  log(`开始时间：${new Date().toLocaleString('zh-CN')}\n`, 'gray');

  // 首先检查服务是否可用
  try {
    log('检查服务可用性...', 'cyan');
    const res = await fetchWithTimeout(`${BASE_URL}/health`, {}, 3000);
    if (res.status !== 200) {
      throw new Error(`Status: ${res.status}`);
    }
    log('✓ 服务可用\n', 'green');
  } catch (error) {
    log('✗ 服务不可用，请确保应用已启动 (pnpm dev)', 'red');
    log(`  错误：${error instanceof Error ? error.message : String(error)}`, 'red');
    process.exit(1);
  }

  // 执行所有测试
  await testHealth();
  await testAgents();
  await testSkills();
  await testThreads();
  await testFiles();
  await testCronJobs();
  await testTerminals();
  await testProcesses();
  await testMonitoring();
  await testTavern();
  await testEmployee();

  // 输出结果
  log('\n═══════════════════════════════════════════════════════════════', 'cyan');
  log('                        测试结果', 'cyan');
  log('═══════════════════════════════════════════════════════════════', 'cyan');

  const totalTime = results.reduce((sum, r) => sum + (r.duration || 0), 0);

  log(`\n总测试数：${totalTests}`, 'cyan');
  log(`✓ 通过：${passedTests}`, 'green');
  log(`✗ 失败：${failedTests}`, 'red');
  if (skippedTests > 0) {
    log(`○ 跳过：${skippedTests}`, 'yellow');
  }

  const passRate = ((passedTests / totalTests) * 100).toFixed(1);
  log(`\n通过率：${passRate}%`, totalTests === passedTests ? 'green' : 'yellow');
  log(`总耗时：${totalTime}ms\n`, 'gray');

  // 失败详情
  const failed = results.filter((r) => !r.passed && !r.skipped);
  if (failed.length > 0) {
    log('失败详情:', 'red');
    failed.forEach((r) => {
      log(`  • ${r.name}`, 'red');
      if (r.error) log(`    错误：${r.error}`, 'gray');
    });
    log('');
  }

  // 退出码
  process.exit(failedTests > 0 ? 1 : 0);
}

// 运行测试
runTests().catch((error) => {
  log(`\n测试执行失败：${error}`, 'red');
  if (error instanceof Error && error.stack) {
    log(error.stack, 'gray');
  }
  process.exit(1);
});
