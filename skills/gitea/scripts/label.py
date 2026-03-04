#!/usr/bin/env python3
"""
标签管理 — 列出、创建、批量初始化

用法:
    python label.py list <owner> <repo>
    python label.py create <owner> <repo> --name "bug" --color "#ee0701" [--desc "描述"]
    python label.py init <owner> <repo>    # 批量创建常用标签
"""

import argparse
import sys

from gitea_api import api_request, extract_error, fail, ok

DEFAULT_LABELS = [
    {"name": "bug", "color": "#ee0701", "description": "Something is broken"},
    {"name": "feature", "color": "#0075ca", "description": "New feature request"},
    {"name": "enhancement", "color": "#a2eeef", "description": "Improvement to existing feature"},
    {"name": "documentation", "color": "#0075ca", "description": "Documentation update"},
    {"name": "priority:high", "color": "#d93f0b", "description": "High priority"},
    {"name": "priority:low", "color": "#c5def5", "description": "Low priority"},
    {"name": "wontfix", "color": "#ffffff", "description": "Will not be fixed"},
]


def list_labels(args):
    code, body = api_request("GET", f"/repos/{args.owner}/{args.repo}/labels")
    if not body or (isinstance(body, dict) and "message" in body):
        print("暂无标签")
        return 0
    for l in body:
        print(f"  ID:{l['id']:4d}  {l['name']:<20s}  色值:{l['color']}  {l.get('description', '')}")
    return 0


def create_label(args):
    color = args.color if args.color.startswith("#") else f"#{args.color}"
    data = {"name": args.name, "color": color, "description": args.desc or ""}
    code, body = api_request("POST", f"/repos/{args.owner}/{args.repo}/labels", data=data)
    if code in (200, 201) and isinstance(body, dict) and "id" in body:
        ok(f"标签已创建: {body['name']} (ID: {body['id']})")
        return 0
    fail(f"创建失败: {extract_error(body)}")
    return 1


def init_labels(args):
    print(f"为 {args.owner}/{args.repo} 初始化常用标签...")
    for lbl in DEFAULT_LABELS:
        code, body = api_request("POST", f"/repos/{args.owner}/{args.repo}/labels", data=lbl)
        if code in (200, 201) and isinstance(body, dict) and "id" in body:
            print(f"  ✓ {body['name']}")
        else:
            msg = extract_error(body)
            print(f"  ✗ {lbl['name']}: {msg}")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Gitea 标签管理")
    sub = parser.add_subparsers(dest="action", required=True)

    p_list = sub.add_parser("list", help="列出标签")
    p_list.add_argument("owner")
    p_list.add_argument("repo")

    p_create = sub.add_parser("create", help="创建标签")
    p_create.add_argument("owner")
    p_create.add_argument("repo")
    p_create.add_argument("--name", required=True)
    p_create.add_argument("--color", required=True, help="如 #ee0701")
    p_create.add_argument("--desc", default="")

    p_init = sub.add_parser("init", help="批量创建常用标签")
    p_init.add_argument("owner")
    p_init.add_argument("repo")

    args = parser.parse_args()
    actions = {"list": list_labels, "create": create_label, "init": init_labels}
    sys.exit(actions[args.action](args))


if __name__ == "__main__":
    main()
