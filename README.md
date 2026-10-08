# My GitHub — Hermes Dashboard Plugin

A dashboard plugin for [Hermes Agent](https://hermes-agent.nousresearch.com/) that lists and opens your GitHub repositories (public + private) via the `gh` CLI.

## Features

- **Full repo list** — paginates up to 500 repos owned by your account
- **Summary stats** — total repos, stars, open issues, forks
- **Search & filter** — fuzzy search by name/description/language; filter by visibility (all/public/private)
- **Sort** — by last pushed (default), stars, forks, creation date, or name
- **Theme-aware** — uses CSS variables, reskins with your active dashboard theme
- **60-second cache** — avoids hammering the `gh` API on every render

## Prerequisites

- [Hermes Agent](https://hermes-agent.nousresearch.com/) installed and running
- [GitHub CLI](https://cli.github.com/) (`gh`) authenticated (`gh auth login`)

## Installation

Install the complete package from the repository (catalog submission is pending):

```sh
hermes plugins install tomekdot/hermes-my-github-plugin --enable
```

For a reproducible install, append `--ref <full-40-character-commit-SHA>`.
Restart the dashboard/gateway if it is already running. Enable the desktop half in
Settings → Plugins to show the statusbar chip and the **GitHub: View repositories**
palette command. The dashboard also provides a **My GitHub** tab.

Package layout:

```text
plugin.yaml
desktop/
└── plugin.js
dashboard/
├── dist/
│   ├── index.js
│   └── style.css
├── manifest.json
└── plugin_api.py
tests/
└── test_utf8_decoding.py
```

Keep both `desktop/` and `dashboard/`: the desktop UI uses the dashboard backend.
No self-updater is included. Catalog updates require a reviewed SHA-bump PR.

Validate a checkout with `hermes plugins validate .`.

## How it works

The backend shells out to `gh api` (reusing your existing OAuth token) — no personal access token to manage. Two endpoints:

- `/api/plugins/my-github/repos` — list of all repos
- `/api/plugins/my-github/summary` — aggregated stats

The frontend renders a searchable, filterable table using React primitives from the Hermes plugin SDK.

## Encoding

Hermes Desktop launches the backend with `python -I`, which ignores
`PYTHONUTF8` and `PYTHONIOENCODING`. Inside that process
`locale.getpreferredencoding()` is the Windows ANSI code page — cp1250 on a
Polish install, cp1252 on a Western one. Every `subprocess.run` that reads a
UTF-8 stream therefore passes `encoding="utf-8"` (plus `errors="replace"`)
explicitly. Without it, `gh`'s UTF-8 JSON is decoded through the code page and
repo descriptions come out as mojibake: `Koło` → `KoĹ‚o`, `—` → `â€`.

Run the regression test the way the backend runs:

```sh
python -I tests/test_utf8_decoding.py
```

Section 1 is offline. Section 2 exercises the live HTTP response and is skipped
when `gh` is not authenticated or `fastapi` is unavailable.

## License

MIT
