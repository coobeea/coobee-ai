/**
 * 修复卡住的线程
 *
 * 将长时间处于 running/tool-pending 状态的线程标记为 idle
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5分钟

async function main() {
  // 开发模式：项目根目录/.home/threads
  const threadsDir = path.join(__dirname, '../.home/threads');

  if (!fs.existsSync(threadsDir)) {
    console.log(`❌ 线程目录不存在: ${threadsDir}\n`);
    return;
  }

  console.log(`\n🔍 扫描线程目录: ${threadsDir}\n`);

  const files = fs.readdirSync(threadsDir).filter((f) => f.endsWith('.json'));
  const now = Date.now();
  const stuckThreads = [];

  for (const file of files) {
    try {
      const filePath = path.join(threadsDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const thread = JSON.parse(content);

      // 只检查 running/tool-pending 状态的线程
      if (thread.runStatus === 'running' || thread.runStatus === 'tool-pending') {
        const updatedAt = new Date(thread.updatedAt).getTime();
        const stuckMs = now - updatedAt;

        if (stuckMs > STUCK_THRESHOLD_MS) {
          stuckThreads.push({ file, thread, stuckMs });
        }
      }
    } catch (err) {
      console.error(`❌ 读取失败: ${file}`, err);
    }
  }

  if (stuckThreads.length === 0) {
    console.log('✅ 没有发现卡住的线程\n');
    return;
  }

  console.log(`⚠️  发现 ${stuckThreads.length} 个卡住的线程:\n`);

  for (const { file, thread, stuckMs } of stuckThreads) {
    const stuckHours = (stuckMs / (1000 * 60 * 60)).toFixed(1);
    console.log(`📌 线程 ID: ${thread.id}`);
    console.log(`   标题: ${thread.title || '(无标题)'}`);
    console.log(`   状态: ${thread.runStatus}`);
    console.log(`   类型: ${thread.agentType || 'agent'}`);
    console.log(`   卡住时长: ${stuckHours} 小时`);
    console.log(`   最后更新: ${thread.updatedAt}`);
    console.log(`   文件: ${file}`);

    // 修复：将 runStatus 改为 idle
    thread.runStatus = 'idle';
    thread.updatedAt = new Date().toISOString();

    const filePath = path.join(threadsDir, file);
    fs.writeFileSync(filePath, JSON.stringify(thread, null, 2), 'utf-8');

    console.log(`   ✅ 已修复: runStatus -> idle\n`);
  }

  console.log(`\n✨ 修复完成！共处理 ${stuckThreads.length} 个线程\n`);
  console.log(`💡 提示：建议重启应用以确保状态同步\n`);
}

main().catch(console.error);
