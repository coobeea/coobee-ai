#!/usr/bin/env node
/**
 * 查询 Agent 的所有 sessions
 *
 * 用法：
 *   node scripts/query-agent-sessions.js <agent-id>
 *   node scripts/query-agent-sessions.js app-copilot
 */

const fs = require('fs');
const path = require('path');

const agentId = process.argv[2];

if (!agentId) {
  console.error('用法: node scripts/query-agent-sessions.js <agent-id>');
  console.error('\n示例:');
  console.error('  node scripts/query-agent-sessions.js app-copilot');
  console.error('  node scripts/query-agent-sessions.js task-analyzer');
  process.exit(1);
}

const homeDir = path.join(__dirname, '../.home');
const sessionsPath = path.join(homeDir, 'homes', agentId, 'sessions.jsonl');

if (!fs.existsSync(sessionsPath)) {
  console.error(`❌ Agent "${agentId}" 的 sessions.jsonl 不存在`);
  console.error(`   路径: ${sessionsPath}`);
  process.exit(1);
}

try {
  const content = fs.readFileSync(sessionsPath, 'utf-8');
  const lines = content
    .trim()
    .split('\n')
    .filter((line) => line.trim());
  const sessions = lines.map((line) => JSON.parse(line));

  console.log(`=== Agent: ${agentId} ===\n`);
  console.log(`总计: ${sessions.length} 个 sessions\n`);

  console.log('最近 10 个 sessions:');
  const recent = sessions.slice(-10);
  for (const s of recent) {
    const date = new Date(s.createdAt);
    console.log(`  ${s.id} - ${date.toLocaleString('zh-CN')}`);
  }

  console.log('\n最早的 session:');
  if (sessions.length > 0) {
    const first = sessions[0];
    const date = new Date(first.createdAt);
    console.log(`  ${first.id} - ${date.toLocaleString('zh-CN')}`);
  }

  console.log('\n最新的 session:');
  if (sessions.length > 0) {
    const last = sessions[sessions.length - 1];
    const date = new Date(last.createdAt);
    console.log(`  ${last.id} - ${date.toLocaleString('zh-CN')}`);
  }
} catch (err) {
  console.error('❌ 读取失败:', err.message);
  process.exit(1);
}
