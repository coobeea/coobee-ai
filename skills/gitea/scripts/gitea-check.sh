#!/bin/bash
# Gitea 环境检查脚本
# 用法: bash skills/gitea/scripts/gitea-check.sh

GITEA_URL="${GITEA_URL:-http://localhost:13000}"
API_BASE="$GITEA_URL/api/v1"

echo "=== Gitea 环境检查 ==="
echo ""

# 1. 检查服务连通性
echo "1. 服务连通性..."
VERSION=$(curl -s --connect-timeout 5 "$API_BASE/version" 2>/dev/null)
if echo "$VERSION" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['version'])" 2>/dev/null; then
  echo "   ✓ Gitea 运行中，版本: $(echo "$VERSION" | python3 -c "import sys,json; print(json.load(sys.stdin)['version'])")"
else
  echo "   ✗ 无法连接 Gitea ($GITEA_URL)"
  echo "   请确认 Gitea 服务已启动"
  exit 1
fi

echo ""

# 2. 检查 Token 配置
echo "2. Token 认证..."
if [ -z "$GITEA_TOKEN" ]; then
  echo "   ⚠ GITEA_TOKEN 环境变量未设置"
  echo "   读操作可用，写操作（创建仓库/Issue/PR等）需要配置 Token"
  echo ""
  echo "   配置方法:"
  echo "   1) 打开 $GITEA_URL/user/settings/applications"
  echo "   2) 创建 Access Token（权限选全部）"
  echo "   3) export GITEA_TOKEN=\"你的token\""
  AUTH_OK=false
else
  USER_INFO=$(curl -s -H "Authorization: token $GITEA_TOKEN" "$API_BASE/user" 2>/dev/null)
  LOGIN=$(echo "$USER_INFO" | python3 -c "import sys,json; print(json.load(sys.stdin).get('login',''))" 2>/dev/null)
  if [ -n "$LOGIN" ] && [ "$LOGIN" != "" ]; then
    echo "   ✓ Token 有效，当前用户: $LOGIN"
    AUTH_OK=true
  else
    echo "   ✗ Token 无效或已过期"
    echo "   请重新生成 Token: $GITEA_URL/user/settings/applications"
    AUTH_OK=false
  fi
fi

echo ""

# 3. 列出可访问的仓库
echo "3. 可访问仓库..."
REPOS=$(curl -s "$API_BASE/repos/search?limit=20" 2>/dev/null)
echo "$REPOS" | python3 -c "
import sys,json
data = json.load(sys.stdin)
repos = data.get('data', [])
if not repos:
    print('   暂无仓库')
else:
    for r in repos:
        private = '🔒' if r['private'] else '🌐'
        print(f\"   {private} {r['full_name']:30s} {r.get('description','')}\")
" 2>/dev/null

echo ""
echo "=== 检查完毕 ==="
if [ "$AUTH_OK" = true ]; then
  echo "所有功能可用 ✓"
else
  echo "只读功能可用，写操作需配置 GITEA_TOKEN"
fi
