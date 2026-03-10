#!/usr/bin/env python3
"""
分支管理 — 列出、创建、删除

用法:
    python branch.py list <owner> <repo>
    python branch.py create <owner> <repo> --name "feature/xxx" [--from main]
    python branch.py delete <owner> <repo> <branch_name>
"""

import argparse
import sys

from gitea_api import api_request, extract_error, fail, ok


def list_branches(args):
    code, body = api_request("GET", f"/repos/{args.owner}/{args.repo}/branches")
    if not body or not isinstance(body, list):
        msg = ""
        if isinstance(body, dict):
            msg = body.get("message", "")
        print(f"暂无分支（仓库可能为空）{msg}")
        return 0
    for b in body:
        protected = "🔒" if b.get("protected") else "  "
        commit = b.get("commit", {})
        msg = commit.get("message", "").split("\n")[0][:50] if commit else ""
        print(f"  {protected} {b['name']:<30s} {msg}")
    return 0


def create_branch(args):
    data = {
        "new_branch_name": args.name,
        "old_branch_name": args.source,
    }
    code, body = api_request("POST", f"/repos/{args.owner}/{args.repo}/branches", data=data)
    if code in (200, 201) and isinstance(body, dict) and "name" in body:
        ok(f"分支已创建: {body['name']}")
        return 0
    fail(f"创建失败: {extract_error(body)}")
    return 1


def delete_branch(args):
    code, body = api_request("DELETE", f"/repos/{args.owner}/{args.repo}/branches/{args.branch_name}")
    if code == 204:
        ok(f"分支已删除: {args.branch_name}")
        return 0
    fail(f"删除失败: {extract_error(body)}")
    return 1


def main():
    parser = argparse.ArgumentParser(description="Gitea 分支管理")
    sub = parser.add_subparsers(dest="action", required=True)

    p_list = sub.add_parser("list", help="列出分支")
    p_list.add_argument("owner")
    p_list.add_argument("repo")

    p_create = sub.add_parser("create", help="创建分支")
    p_create.add_argument("owner")
    p_create.add_argument("repo")
    p_create.add_argument("--name", required=True, help="新分支名")
    p_create.add_argument("--from", dest="source", default="main", help="基于哪个分支")

    p_delete = sub.add_parser("delete", help="删除分支")
    p_delete.add_argument("owner")
    p_delete.add_argument("repo")
    p_delete.add_argument("branch_name")

    args = parser.parse_args()
    actions = {"list": list_branches, "create": create_branch, "delete": delete_branch}
    sys.exit(actions[args.action](args))


if __name__ == "__main__":
    main()
