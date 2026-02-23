#!/bin/bash

# 验证 Brain Skill 自动集成机制
# 用法：bash scripts/verify-brain-integration.sh

echo "🔍 验证 Brain Skill 自动集成机制"
echo "================================"
echo ""

# 1. 检查已有 Agent 是否包含 brain skill
echo "✓ 检查已有 Agent..."
AGENTS_DIR=".home/agents"

if [ ! -d "$AGENTS_DIR" ]; then
  echo "  ❌ Agent 目录不存在: $AGENTS_DIR"
  exit 1
fi

AGENT_COUNT=$(ls -1 "$AGENTS_DIR"/*.json 2>/dev/null | wc -l)
if [ "$AGENT_COUNT" -eq 0 ]; then
  echo "  ⚠️  未找到 Agent 配置文件"
else
  echo "  找到 $AGENT_COUNT 个 Agent"
  echo ""
  
  WITH_BRAIN=0
  WITHOUT_BRAIN=0
  
  for file in "$AGENTS_DIR"/*.json; do
    NAME=$(jq -r '.name // "Unknown"' "$file")
    HAS_BRAIN=$(jq '.skills // [] | contains(["brain"])' "$file")
    
    if [ "$HAS_BRAIN" = "true" ]; then
      echo "  ✅ $NAME - 包含 brain skill"
      WITH_BRAIN=$((WITH_BRAIN + 1))
    else
      echo "  ❌ $NAME - 缺少 brain skill"
      WITHOUT_BRAIN=$((WITHOUT_BRAIN + 1))
    fi
  done
  
  echo ""
  echo "  统计: $WITH_BRAIN 个包含 brain, $WITHOUT_BRAIN 个缺失"
fi

echo ""

# 2. 检查 AgentStore 是否有自动添加逻辑
echo "✓ 检查 AgentStore 自动添加逻辑..."
if grep -q 'skills.unshift.*brain' src/main/ai/agents/AgentStore.ts; then
  echo "  ✅ AgentStore.create() 包含自动添加逻辑"
else
  echo "  ❌ AgentStore.create() 缺少自动添加逻辑"
fi

echo ""

# 3. 检查运行时提示是否包含智库指导
echo "✓ 检查运行时提示..."
if grep -q 'Brain Knowledge Base Integration' src/main/ai/AgentEnvInjector.ts; then
  echo "  ✅ AgentEnvInjector 包含智库使用提示"
else
  echo "  ❌ AgentEnvInjector 缺少智库使用提示"
fi

echo ""

# 4. 检查 Brain Skill 文档是否存在
echo "✓ 检查 Brain Skill 文档..."
if [ -f "skills/brain/SKILL.md" ]; then
  echo "  ✅ Brain Skill 文档存在"
else
  echo "  ❌ Brain Skill 文档不存在"
fi

echo ""

# 5. 检查辅助脚本是否可执行
echo "✓ 检查 Brain 辅助脚本..."
if [ -f "skills/brain/scripts/search.py" ] && [ -f "skills/brain/scripts/publish.py" ]; then
  echo "  ✅ search.py 和 publish.py 存在"
else
  echo "  ❌ Brain 脚本缺失"
fi

echo ""
echo "================================"
echo "✨ 验证完成！"
echo ""
echo "📖 下一步："
echo "   1. 重启应用使配置生效"
echo "   2. 启动 Brain Worker（通过底部状态栏）"
echo "   3. 创建一个测试 Agent，验证 brain skill 自动添加"
echo "   4. 在对话中观察 Agent 是否主动搜索/发布智库"
echo ""
