/**
 * 批量启用所有 Agent 的对话压缩功能
 *
 * 用法：tsx scripts/enable-compression.ts
 */

import fs from 'fs';
import path from 'path';

const AGENTS_DIR = path.join(process.cwd(), '.home', 'agents');

const compressionConfig = {
  enabled: true,
  debug: true,
  minMessageCount: 10,
  thresholdRatio: 0.7,
  keepRatio: 0.3,
  contextWindowSize: 128000
};

async function enableCompression() {
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

      // 检查是否已配置
      if (agent.runtime?.compression?.enabled) {
        console.log(`⏭️  跳过 ${agent.name || file} (已启用压缩)`);
        skipped++;
        continue;
      }

      // 添加 compression 配置
      if (!agent.runtime) agent.runtime = {};
      agent.runtime.compression = compressionConfig;

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
  console.log(`\n💡 重启应用后生效`);
}

enableCompression().catch((err) => {
  console.error('执行失败:', err);
  process.exit(1);
});
