#!/usr/bin/env python3
"""
Gitea 环境检查 — 验证连通性、认证、仓库列表

用法:
    python check.py
"""

import argparse

from gitea_api import api_request, load_config


def main():
    argparse.ArgumentParser(description="Gitea 环境检查").parse_args()
    cfg = load_config()
    base = cfg["url"]
    token = cfg["token"]

    print("=== Gitea 环境检查 ===\n")

    # 1. 连通性
    print("1. 服务连通性...")
    code, body = api_request("GET", "/version", base_url=base)
    if code == 200 and isinstance(body, dict):
        print(f"   ✓ Gitea 运行中，版本: {body.get('version')}")
        print(f"   地址: {base}")
    else:
        print(f"   ✗ 无法连接 Gitea ({base})")
        print("   请确认 Gitea 服务已启动")
        return

    # 2. Token 认证
    print("\n2. Token 认证...")
    if not token:
        print("   ⚠ 未配置 Token")
        print("   读操作可用，写操作需要配置 Token")
        print(f"\n   配置方法:")
        print(f"   1) 打开 {base}/user/settings/applications")
        print(f"   2) 创建 Access Token（权限选全部）")
        print(f"   3) 将 Token 写入 skills.json5:")
        print(f'      "gitea": {{ "url": "{base}", "token": "你的token", "owner": "用户名" }}')
    else:
        code, body = api_request("GET", "/user", token=token, base_url=base)
        if code == 200 and isinstance(body, dict) and "login" in body:
            print(f"   ✓ Token 有效，当前用户: {body['login']}")
            print(f"     邮箱: {body.get('email', '未设置')}")
            print(f"     管理员: {'是' if body.get('is_admin') else '否'}")
        else:
            print("   ✗ Token 无效或已过期")
            print(f"   请重新生成: {base}/user/settings/applications")

    # 3. 仓库列表
    print("\n3. 可访问仓库...")
    code, body = api_request("GET", "/repos/search?limit=20", base_url=base)
    if code == 200 and isinstance(body, dict):
        repos = body.get("data", [])
        if not repos:
            print("   暂无仓库")
        else:
            for r in repos:
                icon = "🔒" if r["private"] else "🌐"
                print(f"   {icon} {r['full_name']:<30s} {r.get('description', '')}")
    else:
        print("   无法获取仓库列表")

    # 4. 配置摘要
    print(f"\n4. 当前配置...")
    print(f"   服务地址: {base}")
    print(f"   默认 Owner: {cfg.get('owner') or '(未设置)'}")
    print(f"   Token: {'已配置' if token else '未配置'}")

    print("\n=== 检查完毕 ===")


if __name__ == "__main__":
    main()
