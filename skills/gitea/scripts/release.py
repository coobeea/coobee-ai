#!/usr/bin/env python3
"""
Release 发布管理 — 列出、创建、上传附件

用法:
    python release.py list <owner> <repo>
    python release.py create <owner> <repo> --tag "v1.0.0" --name "版本标题" [--body "发布说明"] [--target main] [--prerelease] [--draft]
    python release.py upload <owner> <repo> <release_id> --file "path/to/file" [--name "文件名"]
"""

import argparse
import os
import sys
import urllib.request

from gitea_api import api_request, extract_error, fail, load_config, ok


def list_releases(args):
    code, body = api_request("GET", f"/repos/{args.owner}/{args.repo}/releases?limit={args.limit}")
    if not body or (isinstance(body, dict) and "message" in body):
        print("暂无 Release")
        return 0
    for r in body:
        pre = "⚠️预发布" if r["prerelease"] else "✅正式版"
        print(f"  ID:{r['id']:<6d} {r['tag_name']:<15s} {r['name']:<30s} {pre}  {r['published_at'][:10]}")
    return 0


def create_release(args):
    data = {
        "tag_name": args.tag,
        "target_commitish": args.target,
        "name": args.name,
        "body": args.body or "",
        "draft": args.draft,
        "prerelease": args.prerelease,
    }
    code, body = api_request("POST", f"/repos/{args.owner}/{args.repo}/releases", data=data)
    if code in (200, 201) and isinstance(body, dict) and "id" in body:
        ok(f"Release 已创建: {body['tag_name']} - {body['name']} (ID: {body['id']})")
        print(f"  链接: {body['html_url']}")
        return 0
    fail(f"创建失败: {extract_error(body)}")
    return 1


def upload_asset(args):
    filepath = args.file
    if not os.path.isfile(filepath):
        fail(f"文件不存在: {filepath}")
        return 1

    filename = args.name or os.path.basename(filepath)
    cfg = load_config()
    token = cfg["token"]
    base_url = cfg["url"]

    url = f"{base_url}/api/v1/repos/{args.owner}/{args.repo}/releases/{args.release_id}/assets?name={urllib.parse.quote(filename)}"
    with open(filepath, "rb") as f:
        file_data = f.read()

    req = urllib.request.Request(url, data=file_data, method="POST")
    req.add_header("Authorization", f"token {token}")
    req.add_header("Content-Type", "application/octet-stream")

    try:
        import json
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(req, timeout=120) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            ok(f"附件已上传: {result['name']} ({result['size']} bytes)")
            print(f"  下载: {result['browser_download_url']}")
            return 0
    except urllib.error.HTTPError as e:
        import json
        raw = e.read().decode("utf-8")
        try:
            err = json.loads(raw)
            fail(f"上传失败: {err.get('message', raw)}")
        except json.JSONDecodeError:
            fail(f"上传失败: {raw}")
        return 1


def main():
    parser = argparse.ArgumentParser(description="Gitea Release 管理")
    sub = parser.add_subparsers(dest="action", required=True)

    p_list = sub.add_parser("list", help="列出 Release")
    p_list.add_argument("owner")
    p_list.add_argument("repo")
    p_list.add_argument("--limit", type=int, default=10)

    p_create = sub.add_parser("create", help="创建 Release")
    p_create.add_argument("owner")
    p_create.add_argument("repo")
    p_create.add_argument("--tag", required=True, help="Tag 名称, 如 v1.0.0")
    p_create.add_argument("--name", required=True, help="发布标题")
    p_create.add_argument("--body", default="", help="发布说明 (Markdown)")
    p_create.add_argument("--target", default="main", help="基于哪个分支")
    p_create.add_argument("--prerelease", action="store_true")
    p_create.add_argument("--draft", action="store_true")

    p_upload = sub.add_parser("upload", help="上传 Release 附件")
    p_upload.add_argument("owner")
    p_upload.add_argument("repo")
    p_upload.add_argument("release_id", type=int)
    p_upload.add_argument("--file", required=True, help="本地文件路径")
    p_upload.add_argument("--name", default="", help="上传后的文件名")

    args = parser.parse_args()
    actions = {"list": list_releases, "create": create_release, "upload": upload_asset}
    sys.exit(actions[args.action](args))


if __name__ == "__main__":
    main()
