#!/usr/bin/env python3
"""
文件操作 — 通过 API 读写仓库文件

用法:
    python file_ops.py get <owner> <repo> <path> [--ref main]
    python file_ops.py put <owner> <repo> <path> --content "文件内容" --message "提交信息" [--branch main]
"""

import argparse
import base64
import sys

from gitea_api import api_request, extract_error, fail, ok


def get_file(args):
    ref_param = f"?ref={args.ref}" if args.ref else ""
    code, body = api_request("GET", f"/repos/{args.owner}/{args.repo}/contents/{args.path}{ref_param}")
    if code != 200 or not isinstance(body, dict) or "content" not in body:
        fail(f"获取失败: {extract_error(body)}")
        return 1
    content = base64.b64decode(body["content"]).decode("utf-8")
    print(content)
    return 0


def put_file(args):
    content = args.content.replace("\\n", "\n").replace("\\t", "\t")
    encoded = base64.b64encode(content.encode("utf-8")).decode("ascii")
    data = {
        "content": encoded,
        "message": args.message,
    }
    if args.branch:
        data["branch"] = args.branch

    # 先尝试获取文件的 sha（如果是更新已有文件）
    ref_param = f"?ref={args.branch}" if args.branch else ""
    code_check, body_check = api_request("GET", f"/repos/{args.owner}/{args.repo}/contents/{args.path}{ref_param}")
    if code_check == 200 and isinstance(body_check, dict) and "sha" in body_check:
        data["sha"] = body_check["sha"]
        method = "PUT"
    else:
        method = "POST"

    code, body = api_request(method, f"/repos/{args.owner}/{args.repo}/contents/{args.path}", data=data)
    if code in (200, 201) and isinstance(body, dict) and "content" in body:
        ok(f"文件已{'更新' if method == 'PUT' else '创建'}: {body['content']['path']}")
        return 0
    fail(f"操作失败: {extract_error(body)}")
    return 1


def main():
    parser = argparse.ArgumentParser(description="Gitea 文件操作")
    sub = parser.add_subparsers(dest="action", required=True)

    p_get = sub.add_parser("get", help="获取文件内容")
    p_get.add_argument("owner")
    p_get.add_argument("repo")
    p_get.add_argument("path", help="文件路径，如 README.md")
    p_get.add_argument("--ref", default="main", help="分支或 commit")

    p_put = sub.add_parser("put", help="创建或更新文件")
    p_put.add_argument("owner")
    p_put.add_argument("repo")
    p_put.add_argument("path", help="文件路径")
    p_put.add_argument("--content", required=True, help="文件内容")
    p_put.add_argument("--message", required=True, help="提交信息")
    p_put.add_argument("--branch", default="main")

    args = parser.parse_args()
    actions = {"get": get_file, "put": put_file}
    sys.exit(actions[args.action](args))


if __name__ == "__main__":
    main()
