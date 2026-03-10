#!/usr/bin/env node
/**
 * 列出所有 agent 及其 session 数量
 */

const fs = require('fs');
const path = require('path');

const homeDir = path.join(__dirname, '../.home');
const homesDir = path.join(homeDir, 'homes');

function listAgentHomes() {
  console.log('=== Agent Homes 统计 ===\n');

  if (!fs.existsSync(homesDir)) {
    console.error('❌ homes 目录不存在');
    return;
  }

  const agents = fs
    .readdirSync(homesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name);

  console.log(`总计: ${agents.length} 个 agents\n`);

  const results = [];

  for (const agentId of agents) {
    const sessionsPath = path.join(homesDir, agentId, 'sessions.jsonl');

    let count = 0;
    let hasIndex = false;

    if (fs.existsSync(sessionsPath)) {
      hasIndex = true;
      const content = fs.readFileSync(sessionsPath, 'utf-8');
      const lines = content
        .trim()
        .split('\n')
        .filter((line) => line.trim());
      count = lines.length;
    }

    results.push({ agentId, count, hasIndex });
  }

  // 按 session 数量降序排序
  results.sort((a, b) => b.count - a.count);

  console.log('Agent                          Sessions  Index');
  console.log('─────────────────────────────  ────────  ─────');
  for (const r of results) {
    const paddedName = r.agentId.padEnd(29);
    const paddedCount = String(r.count).padStart(8);
    const status = r.hasIndex ? '✓' : '✗';
    console.log(`${paddedName}  ${paddedCount}  ${status}`);
  }

  console.log('\n提示: 使用 query-agent-sessions.js <agent-id> 查看详细列表');
}

listAgentHomes();
