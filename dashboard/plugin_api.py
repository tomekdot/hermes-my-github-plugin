"""My GitHub desktop plugin — backend API routes.

Mounted at /api/plugins/my-github/ by the dashboard plugin system.

Thin wrapper around the `gh` CLI: it is already authenticated as the user
(the logged-in user), and `gh api` returns both public and private repos owned by the
logged-in account. We shell out to `gh` rather than calling the GitHub REST
API directly so we reuse the existing OAuth token and avoid shipping a secret.

v1.1: paginates past 100 repos, returns richer per-repo fields
(stars/forks/issues/language/pushed_at/visibility/fork), caches responses for
60 s, and adds a /summary endpoint.
"""

from __future__ import annotations

import json
import logging
import subprocess
import time

from fastapi import APIRouter, HTTPException, Query

log = logging.getLogger(__name__)

router = APIRouter()

_CACHE_TTL = 60.0
_cache: dict[str, tuple[float, object]] = {}


def _run_gh(args: list[str]) -> str:
    """Run a `gh` subcommand, returning stdout. Raises on non-zero exit."""
    try:
        proc = subprocess.run(
            ["gh", *args],
            capture_output=True,
            text=True,
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


def _cached(key: str, fn):
    hit = _cache.get(key)
    if hit and (time.monotonic() - hit[0]) < _CACHE_TTL:
        return hit[1]
    value = fn()
    _cache[key] = (time.monotonic(), value)
    return value


_REPO_JQ = (
    "[.[] | {"
    "name, full_name, private, fork, html_url, description, "
    "language, stargazers_count, forks_count, open_issues_count, "
    "watchers_count, archived, pushed_at, created_at, updated_at"
    "}]"
)


def _fetch_all_repos() -> list[dict]:
    """Fetch every repo owned by the account, following pagination."""
    repos: list[dict] = []
    for page in range(1, 6):  # up to 500 repos; plenty
        out = _run_gh([
            "api",
            f"user/repos?per_page=100&page={page}&sort=pushed&affiliation=owner",
            "--jq",
            _REPO_JQ,
        ]).strip()
        batch = json.loads(out) if out else []
        repos.extend(batch)
        if len(batch) < 100:
            break
    return repos


@router.get("/repos")
def get_repos(
    sort: str = Query("pushed", description="pushed | stars | name | created"),
):
    """Return repositories owned by the logged-in account."""
    def build():
        login = _login()
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
            "login": _login(),
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


def _login() -> str:
    try:
        return _run_gh(["api", "user", "--jq", ".login"]).strip()
    except Exception:
        return ""
