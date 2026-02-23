#!/usr/bin/env node
/**
 * Agent 工具配置分析脚本
 *
 * 扫描所有 Agent 配置文件，检查工具配置问题：
 *   1. 配置了 skills 但缺 skill_list
 *   2. 缺少基础工具（search, glob, memory 等）
 *   3. 统计工具使用频率
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.dirname(__dirname);

// Agent 目录
const agentDirs = [path.join(projectRoot, 'agents'), path.join(projectRoot, '.home', 'agents')];

// 基础工具建议
const BASIC_TOOLS = {
  search: '内容搜索（几乎所有 Agent 都需要）',
  glob: '文件名搜索（几乎所有 Agent 都需要）',
  memory: '记忆管理（需要长期记忆的 Agent）',
  todo_write: '任务管理（Agent 模式推荐）',
  task_plan: '任务规划（Agent 模式推荐）'
};

function analyzeAgents() {
  const results = {
    total: 0,
    withSkills: 0,
    missingSkillList: [],
    missingBasicTools: [],
    toolUsageStats: {},
    byDirectory: {}
  };

  for (const dir of agentDirs) {
    if (!fs.existsSync(dir)) {
      console.log(`[Skip] Directory not found: ${dir}`);
      continue;
    }

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    const dirName = path.basename(path.dirname(dir)) + '/' + path.basename(dir);
    results.byDirectory[dirName] = {
      total: files.length,
      issues: []
    };

    for (const file of files) {
      const filePath = path.join(dir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const agent = JSON.parse(content);
        results.total++;

        const agentInfo = {
          id: agent.id,
          name: agent.name,
          file: path.relative(projectRoot, filePath),
          tools: agent.tools || [],
          skills: agent.skills || []
        };

        // 检查 1：配置了 skills 但缺 skill_list
        if (agent.skills && agent.skills.length > 0) {
          results.withSkills++;
          if (!agent.tools || !agent.tools.includes('skill_list')) {
            results.missingSkillList.push(agentInfo);
            results.byDirectory[dirName].issues.push({
              type: 'missing-skill-list',
              agent: agent.id
            });
          }
        }

        // 检查 2：缺少基础工具
        if (agent.tools && Array.isArray(agent.tools)) {
          const missing = [];
          for (const [tool, desc] of Object.entries(BASIC_TOOLS)) {
            if (!agent.tools.includes(tool)) {
              missing.push({ tool, reason: desc });
            }
          }
          if (missing.length > 0) {
            results.missingBasicTools.push({ ...agentInfo, missing });
          }

          // 统计工具使用频率
          for (const tool of agent.tools) {
            results.toolUsageStats[tool] = (results.toolUsageStats[tool] || 0) + 1;
          }
        }
      } catch (err) {
        console.error(`[Error] Failed to parse ${file}:`, err.message);
      }
    }
  }

  return results;
}

function printReport(results) {
  console.log('\n========================================');
  console.log('Agent 工具配置分析报告');
  console.log('========================================\n');

  console.log(`总计 Agent 数量: ${results.total}`);
  console.log(`配置了 Skills 的 Agent: ${results.withSkills}\n`);

  // 问题 1: 缺 skill_list
  console.log('---\n## 问题 1: 配置了 Skills 但缺 skill_list 工具 ⚠️\n');
  if (results.missingSkillList.length > 0) {
    console.log(`发现 ${results.missingSkillList.length} 个 Agent 存在此问题：\n`);
    for (const agent of results.missingSkillList) {
      console.log(`- **${agent.name}** (\`${agent.id}\`)`);
      console.log(`  文件: ${agent.file}`);
      console.log(`  Skills: [${agent.skills.join(', ')}]`);
      console.log(`  Tools: [${agent.tools.join(', ')}]`);
      console.log(`  ❌ 缺少 skill_list，Agent 无法发现和使用 Skill\n`);
    }
  } else {
    console.log('✅ 所有配置了 Skills 的 Agent 都包含 skill_list\n');
  }

  // 问题 2: 缺基础工具
  console.log('---\n## 问题 2: 缺少建议的基础工具\n');
  if (results.missingBasicTools.length > 0) {
    console.log(`${results.missingBasicTools.length} 个 Agent 可能需要补充基础工具：\n`);

    // 只显示缺少 3 个以上基础工具的 Agent
    const criticalCases = results.missingBasicTools.filter((a) => a.missing.length >= 3);
    if (criticalCases.length > 0) {
      console.log(`其中 ${criticalCases.length} 个 Agent 缺少 3+ 基础工具：\n`);
      for (const agent of criticalCases) {
        console.log(`- **${agent.name}** (\`${agent.id}\`)`);
        console.log(`  文件: ${agent.file}`);
        console.log(`  当前工具: [${agent.tools.join(', ')}]`);
        console.log(`  建议补充:`);
        for (const { tool, reason } of agent.missing) {
          console.log(`    - ${tool} — ${reason}`);
        }
        console.log();
      }
    } else {
      console.log('（大部分 Agent 的基础工具配置较为完善）\n');
    }
  } else {
    console.log('✅ 所有 Agent 的基础工具配置完善\n');
  }

  // 工具使用统计
  console.log('---\n## 工具使用频率统计\n');
  const sorted = Object.entries(results.toolUsageStats).sort((a, b) => b[1] - a[1]);
  console.log('| 工具 | 使用次数 | 占比 |');
  console.log('| --- | --- | --- |');
  for (const [tool, count] of sorted) {
    const percentage = ((count / results.total) * 100).toFixed(1);
    console.log(`| ${tool} | ${count} | ${percentage}% |`);
  }
  console.log();

  // 按目录统计
  console.log('---\n## 按目录统计\n');
  for (const [dir, stats] of Object.entries(results.byDirectory)) {
    console.log(`**${dir}**: ${stats.total} 个 Agent`);
    if (stats.issues.length > 0) {
      const missingSkillListCount = stats.issues.filter((i) => i.type === 'missing-skill-list').length;
      if (missingSkillListCount > 0) {
        console.log(`  - ⚠️ ${missingSkillListCount} 个 Agent 缺 skill_list`);
      }
    }
  }
  console.log();
}

// 主函数
function main() {
  console.log('开始分析 Agent 工具配置...\n');
  const results = analyzeAgents();
  printReport(results);

  console.log('---\n## 建议操作\n');
  if (results.missingSkillList.length > 0) {
    console.log('1. ⚠️ 立即修复缺 skill_list 的 Agent（P0）');
    console.log('   - 手动编辑 JSON 文件，添加 "skill_list" 到 tools 数组');
    console.log('   - 或运行修复脚本（待开发）\n');
  }
  console.log('2. 📋 查看完整优化计划：docs/optimization-plan-tools-and-agent.md');
  console.log('3. 🚀 实施代码优化，防止未来再出现此问题\n');
}

main();
