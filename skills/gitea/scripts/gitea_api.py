"""
Gitea REST API 客户端 — 零依赖跨平台实现

仅使用 Python 标准库（urllib），适用于 macOS / Linux / Windows。
配置自动从 skills.json5 读取，无需手动设置环境变量。
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# ---------------------------------------------------------------------------
# 配置加载
# ---------------------------------------------------------------------------

def _find_secrets_dir() -> Path | None:
    """向上查找 .home/secrets 目录（开发环境），回退到 ~/.coobee-ai/secrets"""
    current = Path(__file__).resolve()
    for parent in [current] + list(current.parents):
        secrets = parent / ".home" / "secrets"
        if secrets.is_dir():
            return secrets
    home_secrets = Path.home() / ".coobee-ai" / "secrets"
    if home_secrets.is_dir():
        return home_secrets
    return None


def _load_json5_simple(filepath: Path) -> dict:
    """
    简易 JSON5 解析：去除注释后当 JSON 解析。
    支持 // 行注释和尾逗号，覆盖 skills.json5 的实际写法。
    """
    text = filepath.read_text(encoding="utf-8")
    lines = []
    for line in text.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("//"):
            continue
        idx = line.find("//")
        if idx > 0:
            prefix = line[:idx]
            if prefix.count('"') % 2 == 0:
                line = prefix
        lines.append(line)
    cleaned = "\n".join(lines)
    import re
    # 处理 key 没有引号的情况: word: → "word":
    cleaned = re.sub(r'(?m)^(\s*)(\w+)\s*:', r'\1"\2":', cleaned)
    # 移除尾逗号（对象和数组末尾的逗号），支持中间有空白行
    cleaned = re.sub(r",\s*([}\]])", r"\1", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return {}


def load_config() -> dict:
    """
    加载 gitea 配置，优先级：
      1. skills.json5 中的 "gitea" 配置
      2. 环境变量 GITEA_URL / GITEA_TOKEN
      3. 默认值
    """
    config = {
        "url": "http://localhost:13000",
        "token": "",
        "owner": "",
    }

    secrets_dir = _find_secrets_dir()
    if secrets_dir:
        skills_file = secrets_dir / "skills.json5"
        if skills_file.exists():
            all_config = _load_json5_simple(skills_file)
            gitea_conf = all_config.get("gitea", {})
            if gitea_conf.get("url"):
                config["url"] = gitea_conf["url"].rstrip("/")
            if gitea_conf.get("token"):
                config["token"] = gitea_conf["token"]
            if gitea_conf.get("owner"):
                config["owner"] = gitea_conf["owner"]

    if os.environ.get("GITEA_URL"):
        config["url"] = os.environ["GITEA_URL"].rstrip("/")
    if os.environ.get("GITEA_TOKEN"):
        config["token"] = os.environ["GITEA_TOKEN"]
    if os.environ.get("GITEA_OWNER"):
        config["owner"] = os.environ["GITEA_OWNER"]

    return config


# ---------------------------------------------------------------------------
# HTTP 请求
# ---------------------------------------------------------------------------

_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def api_request(
    method: str,
    path: str,
    data: dict | None = None,
    token: str = "",
    base_url: str = "",
) -> tuple[int, dict | list | None]:
    """
    发送 Gitea API 请求（绕过系统代理直连）。

    Returns:
        (status_code, response_body)
        status_code 为 HTTP 状态码（成功时 200/201/204 等）
        response_body 为解析后的 JSON 或 None（204 无内容时）
    """
    if not base_url:
        cfg = load_config()
        base_url = cfg["url"]
        if not token:
            token = cfg["token"]

    url = f"{base_url}/api/v1{path}"
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if token:
        headers["Authorization"] = f"token {token}"

    body = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)

    try:
        with _opener.open(req, timeout=30) as resp:
            status = resp.status
            raw = resp.read().decode("utf-8")
            if not raw:
                return status, None
            return status, json.loads(raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, {"message": raw}
    except urllib.error.URLError as e:
        return 0, {"message": f"连接失败: {e.reason}"}


# ---------------------------------------------------------------------------
# 输出格式化
# ---------------------------------------------------------------------------

def ok(msg: str) -> None:
    print(f"✓ {msg}")


def fail(msg: str) -> None:
    print(f"✗ {msg}", file=sys.stderr)


def print_json(data) -> None:
    print(json.dumps(data, indent=2, ensure_ascii=False))


def extract_error(body) -> str:
    if isinstance(body, dict):
        return body.get("message", str(body))
    return str(body)
