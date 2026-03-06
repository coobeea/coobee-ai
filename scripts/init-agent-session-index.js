/**
 * 初始化 Agent Home sessions.jsonl 索引
 *
 * 从现有的 threads 目录扫描，为每个 agent 生成 sessions.jsonl 文件
 * 只需运行一次（首次部署时）
 */

const fs = require('fs');
const path = require('path');

const homeDir = path.join(__dirname, '../.home');
const threadsDir = path.join(homeDir, 'threads');
const homesDir = path.join(homeDir, 'homes');

async function initSessionIndexes() {
  console.log('=== 初始化 Agent Home sessions.jsonl 索引 ===\n');

  // 1. 读取所有 threads
  console.log('1. 扫描 threads 目录...');
  const threadFiles = fs.readdirSync(threadsDir).filter((f) => f.endsWith('.json'));
  console.log(`   ✓ 找到 ${threadFiles.length} 个 thread 文件\n`);

  // 2. 按 agentId 分组
  console.log('2. 按 agent 分组...');
  const groupedByAgent = new Map();

  for (const file of threadFiles) {
    try {
      const filePath = path.join(threadsDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const thread = JSON.parse(content);

      if (thread.status === 'deleted') continue;

      const agentId = thread.agentId;
      if (!agentId) continue;

      if (!groupedByAgent.has(agentId)) {
        groupedByAgent.set(agentId, []);
      }

      groupedByAgent.get(agentId).push({
        id: thread.id,
        createdAt: thread.createdAt
      });
    } catch (err) {
      console.warn(`   ⚠ 跳过文件 ${file}: ${err.message}`);
    }
  }

  console.log(`   ✓ 找到 ${groupedByAgent.size} 个 agent\n`);

  // 3. 为每个 agent 生成 sessions.jsonl
  console.log('3. 生成 sessions.jsonl 文件...');
  for (const [agentId, sessions] of groupedByAgent) {
    const agentHomeDir = path.join(homesDir, agentId);

    // 确保 agent home 目录存在
    if (!fs.existsSync(agentHomeDir)) {
      fs.mkdirSync(agentHomeDir, { recursive: true });
    }

    const sessionsPath = path.join(agentHomeDir, 'sessions.jsonl');

    // 按创建时间排序（早的在前）
    sessions.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    // 写入 JSONL 格式
    const content = sessions.map((s) => JSON.stringify(s)).join('\n') + '\n';
    fs.writeFileSync(sessionsPath, content, 'utf-8');

    console.log(`   ✓ ${agentId}: ${sessions.length} 条记录`);
  }

  console.log('\n✅ 初始化完成！');
  console.log(`\n可以通过以下命令查看任一 agent 的索引：`);
  console.log(`   cat .home/homes/<agent-id>/sessions.jsonl\n`);
}

initSessionIndexes().catch((err) => {
  console.error('❌ 执行失败:', err);
  process.exit(1);
});
