#!/bin/bash
# 代码质量门禁检查脚本

set -e

echo "======================================"
echo "🔍 运行代码质量门禁检查"
echo "======================================"
echo ""

# 1. 类型检查
echo "📝 Step 1/4: TypeScript 类型检查..."
pnpm run typecheck
echo "✅ 类型检查通过"
echo ""

# 2. 代码规范
echo "✨ Step 2/4: ESLint 检查..."
pnpm run lint
echo "✅ ESLint 检查通过"
echo ""

# 3. 架构 Lint
echo "🏗️  Step 3/4: 架构检查..."
pnpm run lint:architecture
echo "✅ 架构检查通过"
echo ""

# 4. 格式检查
echo "💅 Step 4/4: 格式检查..."
pnpm run format:check
echo "✅ 格式检查通过"
echo ""

echo "======================================"
echo "✅ 所有检查通过！代码质量达标"
echo "======================================"
