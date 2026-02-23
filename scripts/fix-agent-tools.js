#!/usr/bin/env node
/**
 * Agent 工具配置自动修复脚本
 *
 * 自动修复以下问题：
 *   1. 配置了 skills 但缺 skill_list 工具
 *   2. 有文件操作但缺 search/glob 工具
 *   3. （可选）补充建议的基础工具
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.dirname(__dirname);

// Agent 目录
const agentDirs = [path.join(projectRoot, 'agents'), path.join(projectRoot, '.home', 'agents')];

// 修复选项
const FIX_OPTIONS = {
  autoAddSkillList: true, // 有 skills 自动添加 skill_list
  autoAddSearchTools: true, // 有文件操作自动添加 search/glob
  autoAddBasicTools: false // 自动添加基础工具（memory, todo_write 等）- 默认关闭，避免过度干预
};

function fixAgent(filePath, dryRun = false) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const agent = JSON.parse(content);
  const changes = [];

  // 确保有 tools 数组
  if (!agent.tools) {
    agent.tools = [];
  }

  // 修复 1：配置了 skills 但缺 skill_list
  if (FIX_OPTIONS.autoAddSkillList) {
    if (agent.skills && agent.skills.length > 0 && !agent.tools.includes('skill_list')) {
      agent.tools.push('skill_list');
      changes.push('Added skill_list (required for skills)');
    }
  }

  // 修复 2：有文件操作但缺搜索工具
  if (FIX_OPTIONS.autoAddSearchTools) {
    const hasFileOps = agent.tools.some((t) => ['read', 'write', 'edit'].includes(t));

    if (hasFileOps && !agent.tools.includes('search')) {
      agent.tools.push('search');
      changes.push('Added search (recommended for file operations)');
    }

    if (hasFileOps && !agent.tools.includes('glob')) {
      agent.tools.push('glob');
      changes.push('Added glob (recommended for file operations)');
    }
  }

  // 修复 3：补充基础工具（可选）
  if (FIX_OPTIONS.autoAddBasicTools) {
    const basicTools = [
      { name: 'memory', condition: () => true },
      { name: 'todo_write', condition: () => agent.tools.length > 0 }, // 非纯对话 Agent
      { name: 'task_plan', condition: () => agent.tools.length > 0 }
    ];

    for (const { name, condition } of basicTools) {
      if (condition() && !agent.tools.includes(name)) {
        agent.tools.push(name);
        changes.push(`Added ${name} (basic tool)`);
      }
    }
  }

  // 应用修复
  if (changes.length > 0) {
    if (!dryRun) {
      // 更新 updatedAt
      agent.updatedAt = new Date().toISOString();
      // 递增 version
      agent.version = (agent.version || 1) + 1;

      // 写回文件（保持 JSON 格式）
      const updated = JSON.stringify(agent, null, 2) + '\n';
      fs.writeFileSync(filePath, updated, 'utf-8');
    }
    return { fixed: true, changes };
  }

  return { fixed: false, changes: [] };
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-d');
  const autoBasic = args.includes('--basic') || args.includes('-b');

  if (autoBasic) {
    FIX_OPTIONS.autoAddBasicTools = true;
  }

  console.log('========================================');
  console.log('Agent 工具配置自动修复脚本');
  console.log('========================================\n');

  if (dryRun) {
    console.log('🔍 Dry-run 模式：只检查，不修改文件\n');
  } else {
    console.log('✏️  修复模式：将自动修改文件\n');
  }

  console.log('修复规则：');
  console.log(`  - 有 skills 自动添加 skill_list: ${FIX_OPTIONS.autoAddSkillList ? '✅' : '❌'}`);
  console.log(`  - 有文件操作自动添加 search/glob: ${FIX_OPTIONS.autoAddSearchTools ? '✅' : '❌'}`);
  console.log(`  - 自动添加基础工具: ${FIX_OPTIONS.autoAddBasicTools ? '✅' : '❌'}`);
  console.log();

  let totalAgents = 0;
  let fixedAgents = 0;
  const fixedList = [];

  for (const dir of agentDirs) {
    if (!fs.existsSync(dir)) continue;

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

    for (const file of files) {
      const filePath = path.join(dir, file);
      totalAgents++;

      try {
        const result = fixAgent(filePath, dryRun);

        if (result.fixed) {
          fixedAgents++;
          const agent = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          fixedList.push({
            file: path.relative(projectRoot, filePath),
            name: agent.name,
            id: agent.id,
            changes: result.changes
          });
        }
      } catch (err) {
        console.error(`❌ Failed to process ${file}:`, err.message);
      }
    }
  }

  console.log('---\n## 修复结果\n');
  console.log(`总计扫描: ${totalAgents} 个 Agent`);
  console.log(`需要修复: ${fixedAgents} 个 Agent\n`);

  if (fixedList.length > 0) {
    for (const item of fixedList) {
      console.log(`${dryRun ? '🔍' : '✅'} **${item.name}** (\`${item.id}\`)`);
      console.log(`   文件: ${item.file}`);
      for (const change of item.changes) {
        console.log(`   - ${change}`);
      }
      console.log();
    }
  } else {
    console.log('✅ 所有 Agent 配置正常，无需修复\n');
  }

  if (dryRun && fixedAgents > 0) {
    console.log('---\n💡 要应用修复，请运行：');
    console.log('   node scripts/fix-agent-tools.js\n');
  }

  if (!dryRun && fixedAgents > 0) {
    console.log('---\n✅ 修复完成！建议：');
    console.log('   1. 检查修改的文件：git diff');
    console.log('   2. 测试 Agent 功能是否正常');
    console.log('   3. 提交更改：git add -A && git commit -m "fix(agents): auto-add missing essential tools"\n');
  }
}

main();
