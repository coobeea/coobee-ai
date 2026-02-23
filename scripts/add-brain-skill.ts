/**
 * 为所有 Agent 自动添加 brain Skill
 *
 * 用法：npx jiti scripts/add-brain-skill.ts
 */

import fs from 'fs';
import path from 'path';

const AGENTS_DIR = path.join(process.cwd(), '.home', 'agents');
const BRAIN_SKILL = 'brain';

async function addBrainSkill() {
  console.log('🔍 扫描 Agent 配置...\n');

  if (!fs.existsSync(AGENTS_DIR)) {
    console.error(`❌ Agent 目录不存在: ${AGENTS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.json'));

  if (files.length === 0) {
    console.warn('⚠️  未找到 Agent 配置文件');
    process.exit(0);
  }

  console.log(`找到 ${files.length} 个 Agent 配置文件\n`);

  let updated = 0;
  let skipped = 0;

  for (const file of files) {
    const filePath = path.join(AGENTS_DIR, file);

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const agent = JSON.parse(content);

      // 初始化 skills 数组（如果不存在）
      if (!agent.skills) {
        agent.skills = [];
      }

      // 检查是否已包含 brain skill
      if (agent.skills.includes(BRAIN_SKILL)) {
        console.log(`⏭️  跳过 ${agent.name || file} (已包含 brain skill)`);
        skipped++;
        continue;
      }

      // 添加 brain skill 到数组开头（最高优先级）
      agent.skills.unshift(BRAIN_SKILL);

      // 写回文件（保持格式化）
      fs.writeFileSync(filePath, JSON.stringify(agent, null, 2) + '\n', 'utf-8');

      console.log(`✅ 更新 ${agent.name || file}`);
      updated++;
    } catch (err) {
      console.error(`❌ 处理失败 ${file}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`✨ 完成！`);
  console.log(`   更新: ${updated} 个`);
  console.log(`   跳过: ${skipped} 个`);
  console.log(`\n💡 重启应用后，所有 Agent 都将能够使用智库`);
  console.log(`   - 发布经验到智库`);
  console.log(`   - 搜索已有解决方案`);
  console.log(`   - 实现知识复用和持续优化`);
}

addBrainSkill().catch((err) => {
  console.error('执行失败:', err);
  process.exit(1);
});
