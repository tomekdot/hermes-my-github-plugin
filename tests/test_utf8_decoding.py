"""Regression test: the plugin's gh output must survive as UTF-8.

Hermes Desktop launches the backend with `python -I`, which ignores
PYTHONUTF8 / PYTHONIOENCODING, so locale.getpreferredencoding() inside the
serving process is the Windows ANSI code page (cp1250 on a Polish install).
With `subprocess.run(..., text=True)` and no explicit encoding, gh's UTF-8 JSON
was decoded through that code page and every non-ASCII character in a repo
description was corrupted ("Koło" -> "KoĹ‚o", "—" -> "â€").

Run:

  python -I tests/test_utf8_decoding.py

Exit code 0 = pass. Section 1 is a unit test: no network, no GitHub account.
Section 2 runs only when `gh auth status` succeeds and fastapi is importable,
and is skipped otherwise.

Every value is printed as unicode_escape so the console codepage cannot corrupt
the diagnostic itself.
"""

from __future__ import annotations

import json
import locale
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard"))

import plugin_api  # noqa: E402

# The characters GitHub's REST API emits that the old text=True path corrupted,
# plus the marker proving UTF-8 bytes were read through a Windows code page.
UTF8_POLISH = "Koło — Matematyczne"
UTF8_BYTES = UTF8_POLISH.encode("utf-8")
MOJIBAKE = "â€"  # what "—" became when UTF-8 was read as cp1250/cp1252


def esc(value: str) -> str:
    """Print-safe rendering: the console codepage must not corrupt the report."""
    return value.encode("unicode_escape").decode("ascii")


failures: list[str] = []

print("=" * 70)
print("ENVIRONMENT")
print("=" * 70)
print("python           :", sys.version.split()[0])
print("isolated (-I)    :", sys.flags.isolated)
print("utf8_mode        :", sys.flags.utf8_mode)
print("locale preferred :", locale.getpreferredencoding(False))
print("stdout encoding  :", getattr(sys.stdout, "encoding", None))
print()

# --- 1. unit: _run_gh must decode gh's UTF-8 bytes as UTF-8 ---------------
print("=" * 70)
print("1. _run_gh decodes UTF-8 bytes correctly (no network)")
print("=" * 70)


class _FakeCompleted:
    def __init__(self, stdout: str) -> None:
        self.stdout = stdout
        self.stderr = ""
        self.returncode = 0


_real_run = plugin_api.subprocess.run


def _fake_run(cmd, **kwargs):
    """Stand in for subprocess.run, echoing the UTF-8 fixture back.

    Decoding the fixture the way the CALLER asked (its explicit encoding kwarg,
    or the locale default under a bare text=True) is exactly what the real gh
    path does, so this assertion exercises the fix itself.
    """
    if kwargs.get("capture_output") and "gh" in cmd[0]:
        if kwargs.get("encoding"):
            encoding = kwargs["encoding"]
            errors = kwargs.get("errors") or "strict"
        else:
            encoding = locale.getpreferredencoding(False)
            errors = "strict"
        return _FakeCompleted(UTF8_BYTES.decode(encoding, errors))
    return _real_run(cmd, **kwargs)


plugin_api.subprocess.run = _fake_run
try:
    decoded = plugin_api._run_gh(["api", "user"])
finally:
    plugin_api.subprocess.run = _real_run

print("expected         :", esc(UTF8_POLISH))
print("decoded          :", esc(decoded))
if decoded != UTF8_POLISH:
    failures.append(f"_run_gh mangled the fixture: {esc(decoded)}")
elif MOJIBAKE in decoded:
    failures.append("_run_gh returned mojibake")
else:
    print("result           : OK")
print()

# --- 2. live: the HTTP response the renderer decodes -----------------------
print("=" * 70)
print("2. live backend response")
print("=" * 70)

fastapi_missing = False
try:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
except ImportError as exc:
    fastapi_missing = True
    print("SKIP HTTP check: fastapi unavailable:", exc)

gh_ready = True
try:
    _real_run(["gh", "auth", "status"], capture_output=True, timeout=15, check=True)
except Exception as exc:
    gh_ready = False
    print("SKIP live check: gh not authenticated:", type(exc).__name__)

if fastapi_missing or not gh_ready:
    print()
else:
    plugin_api._cache.clear()  # bypass the 60 s cache so this really hits gh
    app = FastAPI()
    app.include_router(plugin_api.router, prefix="/api/plugins/my-github")
    client = TestClient(app)

    resp = client.get("/api/plugins/my-github/repos")
    body = resp.content
    print("status            :", resp.status_code)
    print("content-type      :", resp.headers.get("content-type"))
    print("body bytes        :", len(body))
    if resp.status_code != 200:
        failures.append(f"repos endpoint returned {resp.status_code}")

    if MOJIBAKE.encode("utf-8") in body:
        failures.append("response body still contains UTF-8-as-cp1250 mojibake")

    try:
        payload = json.loads(body.decode("utf-8"))
    except UnicodeDecodeError as exc:
        failures.append(f"response body is not valid UTF-8: {exc}")
    else:
        total = len(payload["repos"])
        mangled = [r["name"] for r in payload["repos"] if MOJIBAKE in (r.get("description") or "")]
        print("repos             :", total)
        print("mangled           :", len(mangled), mangled[:5])
        if mangled:
            failures.append(f"{len(mangled)}/{total} descriptions still mangled")

        # Every non-ASCII description must survive the round trip byte-exact.
        expected = json.loads(
            _real_run(
                ["gh", "api", "/user/repos?per_page=100&affiliation=owner"],
                capture_output=True,
                check=True,
            ).stdout.decode("utf-8")
        )
        checked = 0
        for row in payload["repos"]:
            desc = row.get("description") or ""
            if not any(ord(ch) > 127 for ch in desc):
                continue
            checked += 1
            want = next(r for r in expected if r["name"] == row["name"])["description"]
            ok = desc == want
            print(f"  {row['name'][:26]:<26} {'OK  ' if ok else 'FAIL'} {esc(desc)[:80]}")
            if not ok:
                failures.append(f"{row['name']}: description mangled in HTTP response")
        print(f"non-ascii descriptions checked: {checked}")

    summary = client.get("/api/plugins/my-github/summary")
    print("summary status    :", summary.status_code)
    if summary.status_code != 200:
        failures.append(f"summary returned {summary.status_code}")
    print()

print("=" * 70)
if failures:
    print("FAIL")
    for line in failures:
        print("  -", line)
    sys.exit(1)
print("PASS: non-ASCII characters survive backend -> HTTP -> JSON")