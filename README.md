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
```

Keep both `desktop/` and `dashboard/`: the desktop UI uses the dashboard backend.
No self-updater is included. Catalog updates require a reviewed SHA-bump PR.

Validate a checkout with `hermes plugins validate .`.

## How it works

The backend shells out to `gh api` (reusing your existing OAuth token) — no personal access token to manage. Two endpoints:

- `/api/plugins/my-github/repos` — list of all repos
- `/api/plugins/my-github/summary` — aggregated stats

The frontend renders a searchable, filterable table using React primitives from the Hermes plugin SDK.

## License

MIT
