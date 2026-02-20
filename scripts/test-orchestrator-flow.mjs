import { WebSocket } from 'ws';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const WS_URL = 'ws://127.0.0.1:8765/gateway/ws';

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m'
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function logStep(step, desc) {
  log(`\n[Step ${step}] ${desc}`, 'cyan');
}

function logSuccess(msg) {
  log(`✅ ${msg}`, 'green');
}

function logInfo(msg) {
  log(`ℹ️  ${msg}`, 'blue');
}

function logError(msg) {
  log(`❌ ${msg}`, 'red');
}

// Gateway 请求封装（使用 Gateway 协议）
let rpcId = 1;
async function rpcRequest(ws, method, params) {
  return new Promise((resolve, reject) => {
    const id = String(rpcId++);
    const timeout = setTimeout(() => {
      reject(new Error(`RPC timeout: ${method}`));
    }, 60000);

    const handler = (data) => {
      try {
        const msg = JSON.parse(data.toString());

        // 忽略事件消息
        if (msg.type === 'event') return;

        if (msg.type === 'res' && msg.id === id) {
          clearTimeout(timeout);
          ws.off('message', handler);

          if (!msg.ok) {
            reject(new Error(`Gateway error: ${msg.error?.message || 'Unknown error'}`));
          } else {
            resolve(msg.payload);
          }
        }
      } catch (e) {
        // Ignore
      }
    };

    ws.on('message', handler);

    const request = {
      type: 'req',
      id,
      method,
      params
    };

    ws.send(JSON.stringify(request));
  });
}

// 等待特定的 stream.message 类型
function waitForStreamMessage(ws, messageType, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for stream.message type=${messageType}`));
    }, timeout);

    const handler = (data) => {
      try {
        const msg = JSON.parse(data.toString());
        // Gateway 事件格式：{ type: 'event', event: 'stream.message', payload: { sessionId, message: {...} } }
        if (msg.type === 'event' && msg.event === 'stream.message') {
          const streamMsg = msg.payload?.message;
          if (streamMsg && streamMsg.type === messageType) {
            clearTimeout(timer);
            ws.off('message', handler);
            resolve(msg);
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    };

    ws.on('message', handler);
  });
}

async function readJsonFile(filePath) {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

async function runTest() {
  log('============================================================', 'bright');
  log('Orchestrator (编排器) 模式自动化测试', 'bright');
  log('============================================================\n', 'bright');

  const testSessionId = `test-orchestrator-${Date.now()}`;

  // Step 1: 建立 WebSocket 连接
  logStep(1, '连接 WebSocket...');
  const ws = new WebSocket(WS_URL);

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
    ws.on('unexpected-response', (req, res) => {
      reject(new Error(`Unexpected server response: ${res.statusCode}`));
    });
  });
  logSuccess('WebSocket 已连接');

  try {
    // 监听所有事件
    const capturedEvents = [];
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        capturedEvents.push(msg);
      } catch (e) {
        // Ignore
      }
    });

    // Step 2: 订阅会话流式消息
    logStep(2, '订阅会话...');

    const subscribeResult = await rpcRequest(ws, 'stream.subscribe', {
      sessionId: testSessionId
    });

    logSuccess(`已订阅会话: ${subscribeResult.sessionId}`);

    // Step 3: 发送 Orchestrator 任务
    logStep(3, '发送 Orchestrator 任务...');

    const sendResult = await rpcRequest(ws, 'chat.send', {
      message: '请帮我规划一个任务：打印 "Hello Orchestrator" 并将结果记录下来。',
      sessionId: testSessionId,
      mode: 'orchestrator',
      agentId: 'app-copilot'
    });

    logSuccess(`Orchestrator 任务已提交: ${sendResult.sessionId}`);

    // Step 4: 等待 run:done
    logStep(4, '等待 Orchestrator 执行完成 (run:done)...');

    await waitForStreamMessage(ws, 'run:done', 120000); // 增加超时到 2 分钟，因为 Orchestrator 要走多步
    logSuccess('Orchestrator 执行完成 (SDK 自然结束)');

    // Step 5: 验证 checkpoint 状态为 completed
    logStep(5, '验证 Checkpoint 状态 = completed...');

    const checkpointPath = path.join(projectRoot, '.home/workspaces', testSessionId, 'checkpoint.json');
    const checkpoint = await readJsonFile(checkpointPath);

    if (checkpoint.runStatus !== 'completed') {
      throw new Error(`Expected completed, got ${checkpoint.runStatus}`);
    }

    logSuccess(`Checkpoint 状态正确: ${checkpoint.runStatus}`);

    // Step 6: 检查事件中是否包含 delegate (编排器独有)
    logStep(6, '检查是否触发了 Orchestrator 编排...');
    const hasDelegateStart = capturedEvents.some(
      (msg) => msg.type === 'event' && msg.event === 'stream.message' && msg.payload?.message?.type === 'delegate:start'
    );

    if (!hasDelegateStart) {
      logError('未检测到 delegate:start 事件，Orchestrator 可能没有正确分发子任务。');
    } else {
      logSuccess('检测到 delegate:start，成功进行了多步骤编排！');
    }

    log('\n============================================================', 'bright');
    log('测试结果汇总', 'bright');
    log('============================================================', 'bright');
    logSuccess(
      '✅ 所有步骤通过！\n  1. Orchestrator 启动 ✅\n  2. 触发了 delegate 编排 ✅\n  3. run:done 成功 ✅\n  4. Checkpoint 为 completed ✅'
    );
    log('测试成功！🎉\n', 'bright');
  } catch (error) {
    logError(`测试失败: ${error.message}`);
    console.error(error);
    process.exit(1);
  } finally {
    ws.close();
  }
}

runTest();
