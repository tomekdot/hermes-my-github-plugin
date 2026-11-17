# AGENTS.md — My GitHub plugin

Instructions for AI assistants working in this repository.

## What this is

A standalone Hermes Agent plugin with two halves:

- `desktop/plugin.js` — statusbar chip, palette command, modal repo browser.
- `dashboard/` — FastAPI-style backend (`plugin_api.py`) + bundled UI (`dist/`), registered as a dashboard tab.

Both halves ship together. Do not delete either one: the desktop UI uses the
dashboard backend for repository data. There is no self-updater and no extra
environment variables — authentication comes from `gh auth login`.

## Package rules

- `plugin.yaml` is the root manifest; `dashboard/manifest.json` is the inner one.
  **Bump both in the same commit** — they drift silently otherwise.
- Keep `desktop/plugin.js` self-contained. It renders outside the app's
  `QueryClientProvider`, so do not use `useQuery`; a plain `useEffect` + `ctx.rest`
  is the supported pattern. `ctx` is passed into `register(ctx)` — never import
  it from `@hermes/plugin-sdk`.
- The catalog entry lives in `NousResearch/hermes-agent` at
  `plugin-catalog/my-github.yaml`. Publishing is a reviewed SHA-bump PR against
  that repo, using the exact 40-character commit SHA on this repo's `main`.
  Tag the release (`vX.Y.Z`) and pin the peeled commit SHA, not the tag object.
- `version:` in the catalog is a human label only; update detection compares
  `sha:`. Keep the label accurate anyway.

## Known traps

- **Statusbar chips:** the bar is a 20px flex row with `overflow-x-clip`. A label
  without `shrink-0` + `whitespace-nowrap` wraps to two lines and the second line
  is clipped, making the text look truncated. Core statusbar items use
  `truncate` on their labels — follow that pattern.
- **Encoding:** Hermes Desktop launches the backend with `python -I`, which
  ignores `PYTHONUTF8` / `PYTHONIOENCODING`. Every `subprocess.run` that reads a
  UTF-8 stream must pass `encoding="utf-8"` (and `errors="replace"`). Without it
  `gh`'s JSON is decoded through the Windows ANSI code page and non-ASCII repo
  descriptions become mojibake.
- The Polish characters in `dashboard/plugin_api.py`, `README.md` and
  `tests/test_utf8_decoding.py` are deliberate encoding fixtures. Do not
  "translate" them away.

## Verification (run before publishing)

```sh
hermes plugins validate .
python -I tests/test_utf8_decoding.py
```

The test runs the way the backend runs: section 1 is offline, section 2 uses a
live authenticated `gh` and skips when unavailable. Check a JSX edit with a real
parser (`typescript.transpileModule` with `jsx: ReactJSX`) — `node --check` cannot
parse JSX and reports false errors.

## Style

English only in code, comments, docs, commit messages and PRs. Polish stays in
chat. Commit subjects are lowercase conventional (`fix:`, `chore:`, `docs:`,
`feat:`) with a descriptive body. One clean commit per fix or PR; amend rather
than stacking. Author is always `tomekdot <73403480+tomekdot@users.noreply.github.com>`.
Verify every push by re-reading the remote SHA — a silent exit 0 is not proof.
