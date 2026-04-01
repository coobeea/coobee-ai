/**
 * 修复 lifecycle 任务的错误状态
 * 将状态从 completed 改为 awaiting-input（如果只完成了需求分析）
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

async function main() {
  console.log('=== 修复 Lifecycle 任务状态 ===\n');

  const homeDir =
    process.env.NODE_ENV === 'production'
      ? path.join(require('os').homedir(), '.coobee-ai')
      : path.join(process.cwd(), '.home');

  const tasksDir = path.join(homeDir, 'tavern', 'tasks');

  if (!fs.existsSync(tasksDir)) {
    console.log('❌ 任务目录不存在');
    return;
  }

  const taskDirs = fs
    .readdirSync(tasksDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  let fixed = 0;

  for (const taskId of taskDirs) {
    const metaFile = path.join(tasksDir, taskId, 'meta.json');

    if (!fs.existsSync(metaFile)) continue;

    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));

    // 只处理 lifecycle 任务
    if (!meta.config?.useLifecycle) continue;

    // 只处理状态为 completed 但 lifecycleStage 不是 acceptance 的任务
    if (meta.status === 'completed' && meta.lifecycleStage !== 'acceptance') {
      console.log(`📋 任务: ${meta.title} (${taskId})`);
      console.log(`   当前状态: ${meta.status}`);
      console.log(`   lifecycle 阶段: ${meta.lifecycleStage || '未知'}`);

      // 修改状态为 awaiting-input（等待用户决定下一步）
      meta.status = 'awaiting-input';
      meta.updatedAt = new Date().toISOString();

      // 写回文件
      fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), 'utf-8');

      console.log(`   ✅ 已修改为: awaiting-input\n`);
      fixed++;
    }
  }

  if (fixed === 0) {
    console.log('✅ 没有需要修复的任务');
  } else {
    console.log(`✅ 已修复 ${fixed} 个任务`);
  }
}

main().catch(console.error);
