#!/usr/bin/env python3
"""
仓库管理 — 列出、查看、创建、删除仓库

用法:
    python repo.py list                              # 列出所有仓库
    python repo.py info <owner> <repo>               # 查看仓库详情
    python repo.py create <name> [--desc "描述"] [--private]  # 创建仓库
    python repo.py delete <owner> <repo>             # 删除仓库（⚠️ 不可逆）
"""

import argparse
import sys

from gitea_api import api_request, extract_error, fail, ok


def list_repos(args):
    code, body = api_request("GET", f"/repos/search?limit={args.limit}")
    if code != 200 or not isinstance(body, dict):
        fail(f"获取仓库列表失败: {extract_error(body)}")
        return 1
    repos = body.get("data", [])
    if not repos:
        print("暂无仓库")
        return 0
    for r in repos:
        icon = "🔒" if r["private"] else "🌐"
        print(f"{icon} {r['full_name']:<30s} {r.get('description', '')}")
    return 0


def info_repo(args):
    code, body = api_request("GET", f"/repos/{args.owner}/{args.repo}")
    if code != 200 or not isinstance(body, dict) or "full_name" not in body:
        fail(f"获取仓库详情失败: {extract_error(body)}")
        return 1
    r = body
    print(f"仓库: {r['full_name']}")
    print(f"描述: {r.get('description', '无')}")
    print(f"默认分支: {r['default_branch']}")
    print(f"Star: {r['stars_count']}  Fork: {r['forks_count']}  Issue: {r['open_issues_count']}")
    print(f"创建时间: {r['created_at']}")
    print(f"地址: {r['html_url']}")
    print(f"Clone: {r['clone_url']}")
    return 0


def create_repo(args):
    data = {
        "name": args.name,
        "description": args.desc or "",
        "private": args.private,
        "auto_init": True,
        "default_branch": "main",
        "readme": "Default",
    }
    code, body = api_request("POST", "/user/repos", data=data)
    if code in (200, 201) and isinstance(body, dict) and "full_name" in body:
        ok(f"仓库已创建: {body['full_name']}")
        print(f"  地址: {body['html_url']}")
        print(f"  Clone: {body['clone_url']}")
        return 0
    fail(f"创建仓库失败: {extract_error(body)}")
    return 1


def delete_repo(args):
    code, body = api_request("DELETE", f"/repos/{args.owner}/{args.repo}")
    if code == 204:
        ok(f"仓库已删除: {args.owner}/{args.repo}")
        return 0
    fail(f"删除仓库失败: {extract_error(body)}")
    return 1


def main():
    parser = argparse.ArgumentParser(description="Gitea 仓库管理")
    sub = parser.add_subparsers(dest="action", required=True)

    p_list = sub.add_parser("list", help="列出仓库")
    p_list.add_argument("--limit", type=int, default=50)

    p_info = sub.add_parser("info", help="查看仓库详情")
    p_info.add_argument("owner")
    p_info.add_argument("repo")

    p_create = sub.add_parser("create", help="创建仓库")
    p_create.add_argument("name", help="仓库名称")
    p_create.add_argument("--desc", default="", help="仓库描述")
    p_create.add_argument("--private", action="store_true", help="私有仓库")

    p_delete = sub.add_parser("delete", help="删除仓库（⚠️ 不可逆）")
    p_delete.add_argument("owner")
    p_delete.add_argument("repo")

    args = parser.parse_args()
    actions = {"list": list_repos, "info": info_repo, "create": create_repo, "delete": delete_repo}
    sys.exit(actions[args.action](args))


if __name__ == "__main__":
    main()
