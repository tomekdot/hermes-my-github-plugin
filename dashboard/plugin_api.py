"""My GitHub desktop plugin — backend API routes.

Mounted at /api/plugins/my-github/ by the dashboard plugin system.

Uses the GitHub REST API via the `gh` CLI (reusing the user's existing OAuth
token from `gh auth login`) as the primary method. Falls back to GITHUB_TOKEN
env var if gh is not available or fails.

v1.2: paginates past 100 repos, returns richer per-repo fields
(stars/forks/issues/language/pushed_at/visibility/fork), caches responses for
60 s, and adds a /summary endpoint.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Query

log = logging.getLogger(__name__)

router = APIRouter()

_CACHE_TTL = 60.0
_cache: dict[str, tuple[float, object]] = {}

GITHUB_API = "https://api.github.com"


def _run_gh(args: list[str]) -> str:
    """Run a `gh` subcommand, returning stdout. Raises on non-zero exit.

    `encoding="utf-8"` is mandatory, not cosmetic. The desktop app launches the
    backend with `python -I`, which ignores PYTHONUTF8/PYTHONIOENCODING, so
    `locale.getpreferredencoding()` inside this process is the Windows ANSI code
    page (cp1250 on a Polish install). With `text=True` and no explicit
    encoding, subprocess decodes gh's UTF-8 JSON through that code page and
    every non-ASCII character in a repo description is corrupted
    ("Koło" -> "KoĹ‚o", "—" -> "â€"). The GitHub REST API is always UTF-8, so
    pin it here.
    """
    try:
        proc = subprocess.run(
            ["gh", *args],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
            check=True,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail="gh CLI not found on PATH") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "gh command failed").strip().splitlines()
        detail = detail[0] if detail else "gh command failed"
        raise HTTPException(status_code=502, detail=detail) from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="gh api timed out") from exc
    return proc.stdout


def _get_gh_token() -> str | None:
    """Get token from gh CLI."""
    try:
        proc = subprocess.run(
            ["gh", "auth", "token"],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
            check=True,
        )
        token = proc.stdout.strip()
        if token:
            return token
    except Exception:
        pass
    return None


def _get_token() -> str | None:
    """Get a GitHub token: gh CLI first (primary), then env var fallback."""
    # Primary: gh CLI (reuses existing OAuth token from gh auth login)
    token = _get_gh_token()
    if token:
        return token
    # Fallback: GITHUB_TOKEN env var
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if token:
        return token
    return None


def _api_get_gh(path: str, params: dict[str, Any] | None = None) -> Any:
    """Make an authenticated GET request via gh api, returning parsed JSON."""
    token = _get_token()
    if not token:
        raise HTTPException(status_code=502, detail="No GitHub token available")

    # Build query string
    if params:
        query = "&".join(f"{k}={v}" for k, v in params.items())
        full_path = f"{path}?{query}"
    else:
        full_path = path

    out = _run_gh(["api", full_path, "--jq", "."])
    return json.loads(out)


def _cached(key: str, fn):
    hit = _cache.get(key)
    if hit and (time.monotonic() - hit[0]) < _CACHE_TTL:
        return hit[1]
    value = fn()
    _cache[key] = (time.monotonic(), value)
    return value


def _fetch_all_repos() -> list[dict]:
    """Fetch every repo owned by the account, following pagination via gh API."""
    repos: list[dict] = []
    page = 1
    while True:
        batch = _api_get_gh("/user/repos", params={
            "per_page": 100,
            "page": page,
            "sort": "pushed",
            "affiliation": "owner",
        })
        if not batch:
            break
        repos.extend(batch)
        if len(batch) < 100:
            break
        page += 1
        if page > 5:
            break
    return repos


@router.get("/repos")
def get_repos(
    sort: str = Query("pushed", description="pushed | stars | name | created"),
):
    """Return repositories owned by the logged-in account."""
    def build():
        login = _get_login()
        repos = _fetch_all_repos()

        keymap = {
            "stars": lambda r: r.get("stargazers_count", 0),
            "created": lambda r: r.get("created_at") or "",
            "name": lambda r: r.get("name", "").lower(),
        }
        if sort in keymap:
            repos.sort(key=keymap[sort], reverse=(sort == "stars"))

        return {"repos": repos, "login": login, "sort": sort, "count": len(repos)}

    return _cached(f"repos:{sort}", build)


@router.get("/summary")
def get_summary():
    """Small aggregate: totals by visibility, top languages, recent pushes."""
    def build():
        repos = _fetch_all_repos()
        langs: dict[str, int] = {}
        for r in repos:
            lang = r.get("language")
            if lang:
                langs[lang] = langs.get(lang, 0) + 1
        return {
            "login": _get_login(),
            "total": len(repos),
            "private": sum(1 for r in repos if r.get("private")),
            "public": sum(1 for r in repos if not r.get("private")),
            "forks": sum(1 for r in repos if r.get("fork")),
            "archived": sum(1 for r in repos if r.get("archived")),
            "total_stars": sum(r.get("stargazers_count", 0) for r in repos),
            "open_issues": sum(r.get("open_issues_count", 0) for r in repos),
            "top_languages": sorted(langs.items(), key=lambda kv: -kv[1])[:8],
        }

    return _cached("summary", build)


def _get_login() -> str:
    """Get the GitHub login username."""
    try:
        data = _api_get_gh("/user")
        return data.get("login", "")
    except Exception:
        return ""
