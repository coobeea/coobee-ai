/**
 * 诊断脚本：检查酒馆任务和 lifecycle 状态
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

async function main() {
  console.log('=== 酒馆任务诊断 ===\n');

  // 1. 检查 Tavern 存储目录
  const homeDir =
    process.env.NODE_ENV === 'production'
      ? path.join(require('os').homedir(), '.coobee-ai')
      : path.join(process.cwd(), '.home');

  const tavernDir = path.join(homeDir, 'tavern');
  console.log(`1. Tavern 目录: ${tavernDir}`);
  console.log(`   存在: ${fs.existsSync(tavernDir)}`);

  if (!fs.existsSync(tavernDir)) {
    console.log('   ❌ Tavern 目录不存在，没有任务数据');
    return;
  }

  // 2. 列出所有任务
  const tasksDir = path.join(tavernDir, 'tasks');
  console.log(`\n2. 任务目录: ${tasksDir}`);
  console.log(`   存在: ${fs.existsSync(tasksDir)}`);

  if (!fs.existsSync(tasksDir)) {
    console.log('   ❌ 任务目录不存在');
    return;
  }

  const taskDirs = fs
    .readdirSync(tasksDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  console.log(`   任务数量: ${taskDirs.length}`);

  // 3. 检查每个任务的详情
  for (const taskId of taskDirs) {
    const taskDir = path.join(tasksDir, taskId);
    const metaFile = path.join(taskDir, 'meta.json');

    if (!fs.existsSync(metaFile)) {
      console.log(`\n   ⚠️  任务 ${taskId}: meta.json 不存在`);
      continue;
    }

    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
    console.log(`\n   📋 任务: ${meta.title} (${taskId})`);
    console.log(`      状态: ${meta.status}`);
    console.log(`      创建时间: ${meta.createdAt}`);
    console.log(`      线程 ID: ${meta.threadId || '未分配'}`);
    console.log(`      useLifecycle: ${meta.config?.useLifecycle ?? false}`);

    if (meta.lifecycleStage) {
      console.log(`      lifecycle 阶段: ${meta.lifecycleStage}`);
    }

    // 4. 检查对应的工作空间
    if (meta.threadId) {
      const workspaceDir = path.join(homeDir, 'workspaces', meta.threadId);
      console.log(`\n      工作空间: ${workspaceDir}`);
      console.log(`      存在: ${fs.existsSync(workspaceDir)}`);

      if (fs.existsSync(workspaceDir)) {
        // 检查 lifecycle 目录
        const lifecycleDir = path.join(workspaceDir, 'lifecycle');
        console.log(`      lifecycle/ 目录: ${fs.existsSync(lifecycleDir)}`);

        if (fs.existsSync(lifecycleDir)) {
          const lifecycleFiles = fs.readdirSync(lifecycleDir);
          console.log(`      lifecycle/ 文件数: ${lifecycleFiles.length}`);
          lifecycleFiles.forEach((f) => {
            console.log(`         - ${f}`);
          });
        } else {
          console.log(`         ❌ lifecycle/ 目录不存在`);
        }

        // 检查 GOAL.md
        const goalFile = path.join(workspaceDir, 'GOAL.md');
        console.log(`      GOAL.md: ${fs.existsSync(goalFile)}`);
      }
    }
  }

  console.log('\n=== 诊断完成 ===');
}

main().catch(console.error);
