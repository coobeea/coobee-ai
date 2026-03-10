#!/usr/bin/env node
/**
 * 测试创建 thread 时是否自动追加到 sessions.jsonl
 *
 * 用法：node scripts/test-create-thread.js
 */

const http = require('http');

const API_BASE = 'http://localhost:3789';

async function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${json.error || data}`));
          } else {
            resolve(json);
          }
        } catch {
          resolve(data);
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

async function testCreateThread() {
  console.log('=== 测试 sessions.jsonl 自动追加功能 ===\n');

  try {
    // 1. 查询当前 sessions 数量
    console.log('1. 查询当前 app-copilot 的 sessions 数量...');
    const beforeData = await request('GET', '/gateway/agents/app-copilot/home/sessions');
    const beforeCount = beforeData.count || 0;
    console.log(`   ✓ 当前数量: ${beforeCount}\n`);

    // 2. 创建新 thread
    console.log('2. 创建新 thread...');
    const threadData = await request('POST', '/gateway/threads', {
      title: '测试 sessions.jsonl 自动追加',
      agentId: 'app-copilot'
    });
    console.log(`   ✓ Thread 创建成功: ${threadData.thread.id}`);
    console.log(`   ✓ Agent: ${threadData.thread.agentId}`);
    console.log(`   ✓ Created At: ${threadData.thread.createdAt}\n`);

    // 3. 等待索引更新（理论上是同步的，但为了保险等待 100ms）
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 4. 查询更新后的 sessions
    console.log('3. 查询更新后的 sessions...');
    const afterData = await request('GET', '/gateway/agents/app-copilot/home/sessions');
    const afterCount = afterData.count || 0;
    console.log(`   ✓ 更新后数量: ${afterCount}`);

    // 5. 验证
    if (afterCount === beforeCount + 1) {
      console.log(`   ✓ 验证成功：数量增加 1\n`);

      // 查找新创建的 session
      const newSession = afterData.sessions.find((s) => s.id === threadData.thread.id);
      if (newSession) {
        console.log('4. 验证新 session 在索引中:');
        console.log(`   ✓ ID: ${newSession.id}`);
        console.log(`   ✓ Created At: ${newSession.createdAt}`);
        console.log(`   ✓ 时间匹配: ${newSession.createdAt === threadData.thread.createdAt}\n`);
      } else {
        console.log('   ✗ 未在索引中找到新 session\n');
      }

      console.log('✅ 测试通过！sessions.jsonl 自动追加功能正常工作。');
    } else {
      console.log(`   ✗ 验证失败：期望 ${beforeCount + 1}，实际 ${afterCount}\n`);
      console.log('❌ 测试失败！');
      process.exit(1);
    }
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      console.error('❌ 无法连接到服务器');
      console.error('   请先启动应用: pnpm dev');
    } else {
      console.error('❌ 测试失败:', err.message);
    }
    process.exit(1);
  }
}

testCreateThread();
