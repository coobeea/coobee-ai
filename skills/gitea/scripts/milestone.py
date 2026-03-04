#!/usr/bin/env python3
"""
里程碑管理 — 列出、创建

用法:
    python milestone.py list <owner> <repo> [--state open|closed|all]
    python milestone.py create <owner> <repo> --title "v1.0" [--desc "描述"] [--due "2026-04-01"]
"""

import argparse
import sys

from gitea_api import api_request, extract_error, fail, ok


def list_milestones(args):
    code, body = api_request("GET", f"/repos/{args.owner}/{args.repo}/milestones?state={args.state}")
    if not body or (isinstance(body, dict) and "message" in body):
        print("暂无里程碑")
        return 0
    for m in body:
        due = m.get("due_on", "")
        due_str = due[:10] if due else "无截止日期"
        print(f"  ID:{m['id']:4d}  {m['title']:<20s}  截止:{due_str}  open:{m['open_issues']}/closed:{m['closed_issues']}")
    return 0


def create_milestone(args):
    data = {"title": args.title}
    if args.desc:
        data["description"] = args.desc
    if args.due:
        data["due_on"] = f"{args.due}T00:00:00Z"

    code, body = api_request("POST", f"/repos/{args.owner}/{args.repo}/milestones", data=data)
    if code in (200, 201) and isinstance(body, dict) and "id" in body:
        ok(f"里程碑已创建: {body['title']} (ID: {body['id']})")
        return 0
    fail(f"创建失败: {extract_error(body)}")
    return 1


def main():
    parser = argparse.ArgumentParser(description="Gitea 里程碑管理")
    sub = parser.add_subparsers(dest="action", required=True)

    p_list = sub.add_parser("list", help="列出里程碑")
    p_list.add_argument("owner")
    p_list.add_argument("repo")
    p_list.add_argument("--state", default="open", choices=["open", "closed", "all"])

    p_create = sub.add_parser("create", help="创建里程碑")
    p_create.add_argument("owner")
    p_create.add_argument("repo")
    p_create.add_argument("--title", required=True)
    p_create.add_argument("--desc", default="")
    p_create.add_argument("--due", default="", help="截止日期, 如 2026-04-01")

    args = parser.parse_args()
    actions = {"list": list_milestones, "create": create_milestone}
    sys.exit(actions[args.action](args))


if __name__ == "__main__":
    main()
