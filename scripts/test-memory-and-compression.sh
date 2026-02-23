#!/bin/bash
# 系统功能测试脚本：长期记忆 & 对话压缩
# 用法：bash scripts/test-memory-and-compression.sh

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}====== 系统功能验证测试 ======${NC}\n"

# 1. 检查 Memory 工具注册
echo -e "${YELLOW}1. 检查 Memory 工具注册...${NC}"
if grep -q "memoryTool" src/main/ai/tools/builtin/index.ts; then
  echo -e "${GREEN}✓ Memory 工具已注册${NC}"
else
  echo -e "${RED}✗ Memory 工具未注册${NC}"
  exit 1
fi

# 2. 检查记忆目录
echo -e "\n${YELLOW}2. 检查记忆目录...${NC}"
USER_MEMORY_DIR="$HOME/.coobee-ai/memory"
if [ ! -d "$USER_MEMORY_DIR" ]; then
  echo -e "${YELLOW}⚠ 用户记忆目录不存在，创建中...${NC}"
  mkdir -p "$USER_MEMORY_DIR"
fi
echo -e "${GREEN}✓ 记忆目录: $USER_MEMORY_DIR${NC}"

# 列出现有记忆文件
if [ -n "$(ls -A $USER_MEMORY_DIR 2>/dev/null)" ]; then
  echo -e "  现有文件:"
  ls -lh "$USER_MEMORY_DIR"
else
  echo -e "  ${YELLOW}(目录为空)${NC}"
fi

# 3. 检查 SessionCompressor 实现
echo -e "\n${YELLOW}3. 检查对话压缩功能...${NC}"
if [ -f "src/main/ai/runtime/openai/SessionCompressor.ts" ]; then
  echo -e "${GREEN}✓ SessionCompressor 已实现${NC}"
  
  # 检查关键方法
  if grep -q "compressIfNeeded" src/main/ai/runtime/openai/SessionCompressor.ts; then
    echo -e "${GREEN}  ✓ compressIfNeeded 方法存在${NC}"
  fi
  
  if grep -q "generateSummary" src/main/ai/runtime/openai/SessionCompressor.ts; then
    echo -e "${GREEN}  ✓ generateSummary 方法存在${NC}"
  fi
else
  echo -e "${RED}✗ SessionCompressor 未找到${NC}"
  exit 1
fi

# 4. 检查 Agent 配置中的压缩设置
echo -e "\n${YELLOW}4. 检查 Agent 压缩配置...${NC}"
AGENTS_DIR=".home/agents"
if [ -d "$AGENTS_DIR" ]; then
  COMPRESSION_ENABLED=false
  for agent_file in "$AGENTS_DIR"/*.json; do
    if [ -f "$agent_file" ]; then
      if grep -q '"compression"' "$agent_file" 2>/dev/null; then
        echo -e "${GREEN}  ✓ $(basename $agent_file) 已配置压缩${NC}"
        COMPRESSION_ENABLED=true
      fi
    fi
  done
  
  if [ "$COMPRESSION_ENABLED" = false ]; then
    echo -e "${YELLOW}  ⚠ 未找到启用压缩的 Agent 配置${NC}"
    echo -e "${YELLOW}  建议：在 Agent 配置中添加以下内容：${NC}"
    echo -e '  {
    "runtime": {
      "compression": {
        "enabled": true,
        "debug": true,
        "minMessageCount": 10
      }
    }
  }'
  fi
else
  echo -e "${YELLOW}  ⚠ Agent 目录不存在${NC}"
fi

# 5. 检查日志文件
echo -e "\n${YELLOW}5. 检查日志文件...${NC}"
if [ -d ".home/logs" ]; then
  LATEST_LOG=$(ls -t .home/logs/*.log 2>/dev/null | head -1)
  if [ -n "$LATEST_LOG" ]; then
    echo -e "${GREEN}✓ 最新日志: $LATEST_LOG${NC}"
    
    # 检查是否有 memory 相关日志
    MEMORY_LOGS=$(grep -c "\[memory\]" "$LATEST_LOG" 2>/dev/null || echo "0")
    echo -e "  Memory 工具调用次数: $MEMORY_LOGS"
    
    # 检查是否有压缩相关日志
    COMPRESSION_LOGS=$(grep -c "Compressor" "$LATEST_LOG" 2>/dev/null || echo "0")
    echo -e "  压缩事件次数: $COMPRESSION_LOGS"
  else
    echo -e "${YELLOW}  ⚠ 未找到日志文件${NC}"
  fi
fi

# 6. 模拟测试建议
echo -e "\n${GREEN}====== 测试建议 ======${NC}"
echo -e "\n${YELLOW}测试 1: 验证 Memory 功能${NC}"
echo -e "  1. 启动应用并创建新任务"
echo -e "  2. 在对话中输入: '请记住我的名字是测试用户'"
echo -e "  3. 查看日志确认 memory write 调用"
echo -e "  4. 检查文件: ls -la {workspace}/MEMORY.md"
echo -e "  5. 再次询问: '我的名字是什么？'"

echo -e "\n${YELLOW}测试 2: 验证压缩功能${NC}"
echo -e "  1. 启用 Agent 的 compression 配置（见上方示例）"
echo -e "  2. 重启应用"
echo -e "  3. 创建长对话（20+ 条消息）"
echo -e "  4. 观察日志: tail -f .home/logs/*.log | grep Compressor"
echo -e "  5. 检查 Session 文件: grep summary {session-file}.jsonl"

echo -e "\n${GREEN}====== 完成 ======${NC}"
