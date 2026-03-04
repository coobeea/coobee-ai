#!/usr/bin/env python3
"""
Pull Request 管理 — 列出、创建、查看、合并

用法:
    python pr.py list <owner> <repo> [--state open|closed|all]
    python pr.py create <owner> <repo> --title "标题" --head "源分支" [--base main] [--body "描述"]
    python pr.py view <owner> <repo> <index>
    python pr.py merge <owner> <repo> <index> [--method merge|rebase|squash] [--message "合并信息"] [--delete-branch]
"""

import argparse
import sys

from gitea_api import api_request, extract_error, fail, ok


def list_prs(args):
    code, body = api_request("GET", f"/repos/{args.owner}/{args.repo}/pulls?state={args.state}&limit={args.limit}")
    if isinstance(body, dict) and "message" in body:
        print(f"暂无 Pull Request（{body['message']}）")
        return 0
    if not body:
        print("暂无 Pull Request")
        return 0
    for p in body:
        print(f"#{p['number']:4d} [{p['state']:6s}] {p['title']:<40s} {p['head']['label']} → {p['base']['label']}")
    return 0


def create_pr(args):
    data = {
        "title": args.title,
        "head": args.head,
        "base": args.base,
    }
    if args.body:
        data["body"] = args.body
    if args.assignees:
        data["assignees"] = args.assignees.split(",")
    if args.labels:
        data["labels"] = [int(x) for x in args.labels.split(",")]

    code, body = api_request("POST", f"/repos/{args.owner}/{args.repo}/pulls", data=data)
    if code in (200, 201) and isinstance(body, dict) and "number" in body:
        ok(f"PR 已创建: #{body['number']} {body['title']}")
        print(f"  {body['head']['label']} → {body['base']['label']}")
        print(f"  链接: {body['html_url']}")
        return 0
    fail(f"创建失败: {extract_error(body)}")
    return 1


def view_pr(args):
    code, body = api_request("GET", f"/repos/{args.owner}/{args.repo}/pulls/{args.index}")
    if code != 200 or not isinstance(body, dict) or "number" not in body:
        fail(f"获取失败: {extract_error(body)}")
        return 1
    p = body
    print(f"PR #{p['number']}: {p['title']}")
    print(f"状态: {p['state']}  可合并: {p.get('mergeable', '未知')}")
    print(f"分支: {p['head']['label']} → {p['base']['label']}")
    print(f"链接: {p['html_url']}")
    if p.get("body"):
        print(f"\n{p['body'][:500]}")
    return 0


def merge_pr(args):
    data = {
        "Do": args.method,
        "delete_branch_after_merge": args.delete_branch,
    }
    if args.message:
        data["merge_message_field"] = args.message

    code, body = api_request("POST", f"/repos/{args.owner}/{args.repo}/pulls/{args.index}/merge", data=data)
    if code == 200:
        ok("PR 已合并")
        return 0
    if code == 405:
        fail("PR 无法合并（可能存在冲突或未通过检查）")
        return 1
    fail(f"合并失败: {extract_error(body)}")
    return 1


def main():
    parser = argparse.ArgumentParser(description="Gitea PR 管理")
    sub = parser.add_subparsers(dest="action", required=True)

    p_list = sub.add_parser("list", help="列出 PR")
    p_list.add_argument("owner")
    p_list.add_argument("repo")
    p_list.add_argument("--state", default="open", choices=["open", "closed", "all"])
    p_list.add_argument("--limit", type=int, default=20)

    p_create = sub.add_parser("create", help="创建 PR")
    p_create.add_argument("owner")
    p_create.add_argument("repo")
    p_create.add_argument("--title", required=True)
    p_create.add_argument("--head", required=True, help="源分支")
    p_create.add_argument("--base", default="main", help="目标分支")
    p_create.add_argument("--body", default="")
    p_create.add_argument("--assignees", default="", help="审阅人逗号分隔")
    p_create.add_argument("--labels", default="", help="标签 ID 逗号分隔")

    p_view = sub.add_parser("view", help="查看 PR 详情")
    p_view.add_argument("owner")
    p_view.add_argument("repo")
    p_view.add_argument("index", type=int)

    p_merge = sub.add_parser("merge", help="合并 PR")
    p_merge.add_argument("owner")
    p_merge.add_argument("repo")
    p_merge.add_argument("index", type=int)
    p_merge.add_argument("--method", default="merge", choices=["merge", "rebase", "squash"])
    p_merge.add_argument("--message", default="")
    p_merge.add_argument("--delete-branch", action="store_true", help="合并后删除源分支")

    args = parser.parse_args()
    actions = {"list": list_prs, "create": create_pr, "view": view_pr, "merge": merge_pr}
    sys.exit(actions[args.action](args))


if __name__ == "__main__":
    main()
