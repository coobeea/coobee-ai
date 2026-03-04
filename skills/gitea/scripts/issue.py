#!/usr/bin/env python3
"""
Issue（工单）管理 — 列出、创建、更新、评论、关闭

用法:
    python issue.py list <owner> <repo> [--state open|closed|all] [--limit 20]
    python issue.py create <owner> <repo> --title "标题" [--body "内容"] [--labels 1,2] [--assignees user1,user2] [--milestone 1]
    python issue.py update <owner> <repo> <index> [--title "新标题"] [--body "新内容"] [--state open|closed]
    python issue.py comment <owner> <repo> <index> --body "评论内容"
    python issue.py close <owner> <repo> <index>
    python issue.py view <owner> <repo> <index>
"""

import argparse
import sys

from gitea_api import api_request, extract_error, fail, ok


def list_issues(args):
    params = f"state={args.state}&limit={args.limit}&type=issues"
    code, body = api_request("GET", f"/repos/{args.owner}/{args.repo}/issues?{params}")
    if isinstance(body, dict) and "message" in body:
        fail(f"查询失败: {extract_error(body)}")
        return 1
    if not body:
        print("暂无 Issue")
        return 0
    for i in body:
        labels = ",".join(l["name"] for l in i.get("labels", []))
        assignee = i.get("assignee")
        who = assignee.get("login", "未分配") if assignee else "未分配"
        print(f"#{i['number']:4d} [{i['state']:6s}] {i['title']:<40s} 👤{who} 🏷️{labels}")
    return 0


def create_issue(args):
    data = {"title": args.title}
    if args.body:
        data["body"] = args.body
    if args.labels:
        data["labels"] = [int(x) for x in args.labels.split(",")]
    if args.assignees:
        data["assignees"] = args.assignees.split(",")
    if args.milestone:
        data["milestone"] = args.milestone

    code, body = api_request("POST", f"/repos/{args.owner}/{args.repo}/issues", data=data)
    if code in (200, 201) and isinstance(body, dict) and "number" in body:
        ok(f"Issue 已创建: #{body['number']} {body['title']}")
        print(f"  链接: {body['html_url']}")
        return 0
    fail(f"创建失败: {extract_error(body)}")
    return 1


def update_issue(args):
    data = {}
    if args.title is not None:
        data["title"] = args.title
    if args.body is not None:
        data["body"] = args.body
    if args.state is not None:
        data["state"] = args.state
    if not data:
        fail("未指定任何更新字段")
        return 1

    code, body = api_request("PATCH", f"/repos/{args.owner}/{args.repo}/issues/{args.index}", data=data)
    if isinstance(body, dict) and "number" in body:
        ok(f"Issue #{body['number']} 已更新: {body['title']} [{body['state']}]")
        return 0
    fail(f"更新失败: {extract_error(body)}")
    return 1


def comment_issue(args):
    data = {"body": args.body}
    code, body = api_request("POST", f"/repos/{args.owner}/{args.repo}/issues/{args.index}/comments", data=data)
    if code in (200, 201) and isinstance(body, dict) and "id" in body:
        ok(f"评论已添加 (ID: {body['id']})")
        return 0
    fail(f"评论失败: {extract_error(body)}")
    return 1


def close_issue(args):
    data = {"state": "closed"}
    code, body = api_request("PATCH", f"/repos/{args.owner}/{args.repo}/issues/{args.index}", data=data)
    if code == 200 and isinstance(body, dict) and body.get("state") == "closed":
        ok(f"Issue #{body['number']} 已关闭")
        return 0
    fail(f"关闭失败: {extract_error(body)}")
    return 1


def view_issue(args):
    code, body = api_request("GET", f"/repos/{args.owner}/{args.repo}/issues/{args.index}")
    if code != 200 or not isinstance(body, dict) or "number" not in body:
        fail(f"获取失败: {extract_error(body)}")
        return 1
    i = body
    labels = ", ".join(l["name"] for l in i.get("labels", []))
    assignee = i.get("assignee")
    who = assignee.get("login", "未分配") if assignee else "未分配"
    print(f"Issue #{i['number']}: {i['title']}")
    print(f"状态: {i['state']}  指派: {who}")
    print(f"标签: {labels or '无'}")
    print(f"链接: {i['html_url']}")
    if i.get("body"):
        print(f"\n{i['body']}")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Gitea Issue 管理")
    sub = parser.add_subparsers(dest="action", required=True)

    p_list = sub.add_parser("list", help="列出 Issue")
    p_list.add_argument("owner")
    p_list.add_argument("repo")
    p_list.add_argument("--state", default="open", choices=["open", "closed", "all"])
    p_list.add_argument("--limit", type=int, default=20)

    p_create = sub.add_parser("create", help="创建 Issue")
    p_create.add_argument("owner")
    p_create.add_argument("repo")
    p_create.add_argument("--title", required=True)
    p_create.add_argument("--body", default="")
    p_create.add_argument("--labels", default="", help="标签 ID 逗号分隔, 如 1,2,3")
    p_create.add_argument("--assignees", default="", help="指派人逗号分隔")
    p_create.add_argument("--milestone", type=int, default=0)

    p_update = sub.add_parser("update", help="更新 Issue")
    p_update.add_argument("owner")
    p_update.add_argument("repo")
    p_update.add_argument("index", type=int)
    p_update.add_argument("--title", default=None)
    p_update.add_argument("--body", default=None)
    p_update.add_argument("--state", default=None, choices=["open", "closed"])

    p_comment = sub.add_parser("comment", help="添加评论")
    p_comment.add_argument("owner")
    p_comment.add_argument("repo")
    p_comment.add_argument("index", type=int)
    p_comment.add_argument("--body", required=True)

    p_close = sub.add_parser("close", help="关闭 Issue")
    p_close.add_argument("owner")
    p_close.add_argument("repo")
    p_close.add_argument("index", type=int)

    p_view = sub.add_parser("view", help="查看 Issue 详情")
    p_view.add_argument("owner")
    p_view.add_argument("repo")
    p_view.add_argument("index", type=int)

    args = parser.parse_args()
    actions = {
        "list": list_issues, "create": create_issue, "update": update_issue,
        "comment": comment_issue, "close": close_issue, "view": view_issue,
    }
    sys.exit(actions[args.action](args))


if __name__ == "__main__":
    main()
