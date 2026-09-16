/**
 * My GitHub — desktop plugin (UI half).
 *
 * Backend half lives in plugins/my-github/dashboard/plugin_api.py (gh CLI).
 * This is v1.1: richer rows (language, stars, forks, issues, pushed time),
 * visibility filter, sort control, summary header, manual refresh.
 *
 * NOTE: `ctx` is passed into `register(ctx)` by the host — NOT imported from
 * '@hermes/plugin-sdk'. We deliberately avoid useQuery (tanstack) because the
 * plugin renders outside the app's QueryClientProvider; a plain effect is safe.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import {
  haptic,
  PALETTE_AREA,
  STATUSBAR_AREAS,
  Dialog,
  DialogContent,
  DialogTitle,
} from '@hermes/plugin-sdk'

const fmtDate = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return d.toISOString().slice(0, 10)
}

function useGithub(ctx) {
  const [data, setData] = useState({ repos: [], login: '', count: 0 })
  const [summary, setSummary] = useState(null)
  const [sort, setSort] = useState('pushed')
  const [isLoading, setIsLoading] = useState(true)
  const [isError, setIsError] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback((sortKey = 'pushed') => {
    setIsLoading(true)
    setIsError(false)
    setError(null)
    Promise.all([
      ctx.rest('/repos', { query: { sort: sortKey, t: Date.now() } }),
      ctx.rest('/summary').catch(() => null),
    ])
      .then(([repos, sum]) => {
        setData(repos ?? { repos: [] })
        setSummary(sum)
      })
      .catch((e) => {
        setIsError(true)
        setError(e)
        console.error('[my-github] rest failed:', e)
      })
      .finally(() => setIsLoading(false))
  }, [ctx])

  useEffect(() => {
    load(sort)
  }, [load, sort])

  return { ...data, summary, sort, setSort, isLoading, isError, error, refetch: load }
}

function Stat({ label, value }) {
  return jsxs('div', {
    className: 'flex flex-col items-center px-3',
    children: [
      jsx('span', {
        className: 'text-sm font-semibold text-(--ui-text)',
        children: String(value),
      }),
      jsx('span', {
        className: 'text-[10px] uppercase tracking-wide text-(--ui-text-tertiary)',
        children: label,
      }),
    ],
  })
}

function RepoRow({ repo, onOpen }) {
  return jsx(
    'button',
    {
      type: 'button',
      onClick: () => onOpen(repo.html_url),
      className:
        'w-full min-w-0 text-left px-2 py-2 flex items-center gap-2 hover:bg-(--ui-hover) border-b border-(--ui-border-subtle)',
      children: jsxs('div', {
        className: 'min-w-0 flex-1',
        children: [
          jsxs('div', {
            className: 'flex items-center gap-2 min-w-0 flex-wrap',
            children: [
              jsx('span', {
                className: 'font-medium text-(--ui-text) break-words',
                children: repo.name,
              }),
              repo.private
                ? jsx('span', {
                    className:
                      'text-[10px] uppercase tracking-wide text-(--ui-warning) shrink-0',
                    children: 'private',
                  })
                : jsx('span', {
                    className:
                      'text-[10px] uppercase tracking-wide text-(--ui-text-tertiary) shrink-0',
                    children: 'public',
                  }),
              repo.fork
                ? jsx('span', {
                    className:
                      'text-[10px] uppercase tracking-wide text-(--ui-text-tertiary) shrink-0',
                    children: 'fork',
                  })
                : null,
              repo.archived
                ? jsx('span', {
                    className:
                      'text-[10px] uppercase tracking-wide text-(--ui-text-tertiary) shrink-0',
                    children: 'archived',
                  })
                : null,
          jsxs('span', {
            className: 'flex items-center gap-1.5 shrink-0',
            children: [
              jsx('span', {
                className: 'text-[10px] uppercase tracking-wide text-(--ui-text-tertiary)',
                children: `★ ${repo.stargazers_count || 0}`,
              }),
              jsx('span', {
                className: 'text-[10px] uppercase tracking-wide text-(--ui-text-tertiary)',
                children: `⑂ ${repo.forks_count || 0}`,
              }),
            ],
          })
        ],
      }),
      repo.description
        ? jsx('div', {
            className:
              'text-xs text-(--ui-text-tertiary) break-words whitespace-normal mt-0.5 leading-snug',
            children: repo.description,
          })
        : null,
    },
    repo.full_name || repo.name,
  )
}

const SORTS = [
  ['pushed', 'Last pushed'],
  ['stars', 'Most stars'],
  ['forks', 'Most forks'],
  ['created', 'Newest'],
  ['name', 'Name A–Z'],
]

function RepoList({ repos, onOpen, onClose, refetch, sort, setSort }) {
  const [q, setQ] = useState('')
  const [vis, setVis] = useState('all') // all | public | private

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    const rows = repos.filter((r) => {
      if (vis !== 'all' && Boolean(r.private) !== (vis === 'private')) return false
      if (!s) return true
      return (
        r.name.toLowerCase().includes(s) ||
        (r.description && r.description.toLowerCase().includes(s)) ||
        (r.language && r.language.toLowerCase().includes(s))
      )
    })
    const cmp = {
      pushed: (a, b) => String(b.pushed_at || '').localeCompare(String(a.pushed_at || '')),
      stars: (a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0),
      forks: (a, b) => (b.forks_count || 0) - (a.forks_count || 0),
      created: (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')),
      name: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
    }
    rows.sort(cmp[sort] || cmp.pushed)
    return rows
  }, [repos, q, vis, sort])

  const visBtn = (v, label) =>
    jsx(
      'button',
      {
        type: 'button',
        onClick: () => setVis(v),
        className:
          'rounded px-2 py-0.5 text-xs ' +
          (vis === v
            ? 'bg-(--ui-accent) text-(--ui-accent-foreground)'
            : 'text-(--ui-text-tertiary) hover:bg-(--ui-hover)'),
        children: label,
      },
      v,
    )

  return jsxs(Fragment, {
    children: [
      jsxs('div', {
        className: 'flex items-center gap-2 px-2 py-1.5 border-b border-(--ui-border)',
        children: [
          jsx('span', {
            className: 'text-[10px] uppercase tracking-wide text-(--ui-text-tertiary) shrink-0',
            children: '★',
          }),
          jsx('input', {
            type: 'text',
            value: q,
            placeholder: 'Search repositories…',
            onChange: (e) => setQ(e.target.value),
            className:
              'flex-1 min-w-0 bg-(--ui-input) text-(--ui-text) rounded px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-(--ui-ring)',
          }),
          jsxs('div', {
            className: 'flex items-center rounded border border-(--ui-border) p-0.5 shrink-0',
            children: [visBtn('all', 'all'), visBtn('public', 'pub'), visBtn('private', 'priv')],
          }),
          jsx('select', {
            value: sort,
            onChange: (e) => setSort(e.target.value),
            className:
              'rounded px-1.5 py-0.5 text-xs bg-(--ui-input) text-(--ui-text) border border-(--ui-border) outline-none',
            children: SORTS.map(([v, label]) =>
              jsx('option', { value: v, children: label }, v),
            ),
          }),
          jsx('button', {
            type: 'button',
            title: 'Refresh',
            onClick: refetch,
            'aria-label': 'Refresh',
            className:
              'rounded px-2 py-1 text-(--ui-text-tertiary) hover:bg-(--ui-hover) hover:text-(--ui-text) shrink-0',
            children: '↻',
          }),
        ],
      }),
      jsx('div', {
        className: 'overflow-y-auto overflow-x-hidden max-h-[65vh]',
        children:
          filtered.length === 0
            ? jsx('div', {
                className: 'px-3 py-6 text-center text-(--ui-text-tertiary) text-sm',
                children: 'No repositories match.',
              })
            : filtered.map((repo) => jsx(RepoRow, { repo, onOpen }, repo.full_name || repo.name)),
      }),
      jsx('div', {
        className: 'px-2 py-1 text-[11px] text-(--ui-text-tertiary) border-t border-(--ui-border)',
        children: `${filtered.length} of ${repos.length} repositories`,
      }),
    ],
  })
}

function Chip({ ctx }) {
  const [open, setOpen] = useState(false)
  const { repos, summary, isLoading, isError, error, refetch } = useGithub(ctx)

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener('my-github:open', onOpen)
    return () => window.removeEventListener('my-github:open', onOpen)
  }, [])

  const openRepo = useCallback(
    (url) => {
      const done = ctx?.os?.openExternal?.(url)
      if (done && typeof done.then === 'function') {
        done.then((ok) => {
          if (!ok) haptic.warn('Failed to open browser')
          else setOpen(false)
        })
      } else {
        setOpen(false)
      }
    },
    [ctx],
  )

  return jsxs(Fragment, {
    children: [
      jsx('button', {
        type: 'button',
        title: 'View repositories',
        onClick: () => setOpen((o) => !o),
        className:
          'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs text-(--ui-text-tertiary) hover:bg-(--ui-hover) hover:text-(--ui-text)',
        children: jsxs(Fragment, {
     children: [
       jsx('span', {
         className: 'text-sm',
         children: '★',
       }),
       jsx('span', {
         children: summary ? `${summary.login} · ${summary.total}` : 'GitHub',
       }),
     ],
   }),
      }),
      jsx(Dialog, {
        open,
        onOpenChange: setOpen,
        children: jsx(DialogContent, {
          style: { width: '48vw', maxWidth: '90vw' },
          className:
            'overflow-x-hidden border border-(--ui-border) rounded-lg shadow-lg bg-(--ui-bg) p-3',
          children: jsxs('div', {
            className: 'min-w-0 flex flex-col gap-2',
            children: [
              jsx(DialogTitle, {
                className: 'text-base font-semibold mb-1 flex items-center gap-2',
                children: jsxs(Fragment, {
                  children: [
                    'GitHub Repositories',
                    summary
                      ? jsx('span', {
                          className: 'text-xs font-normal text-(--ui-text-tertiary)',
                          children: `@${summary.login} — ${summary.public} public, ${summary.private} private`,
                        })
                      : null,
                  ],
                }),
              }),
              summary
                ? jsxs('div', {
                    className: 'flex items-center justify-center divide-x divide-(--ui-border) rounded border border-(--ui-border) py-1.5',
                    children: [
                      jsx(Stat, { label: 'repos', value: summary.total }),
                      jsx(Stat, { label: 'stars', value: summary.total_stars }),
                      jsx(Stat, { label: 'issues', value: summary.open_issues }),
                      jsx(Stat, { label: 'forks of mine', value: summary.forks }),
                    ],
                  })
                : null,
              isLoading
                ? jsx('div', {
                    className: 'px-1 py-6 text-center text-(--ui-text-tertiary) text-sm',
                    children: 'Loading…',
                  })
                : isError
                  ? jsxs('div', {
                      className: 'px-1 py-6 text-center text-sm',
                      children: [
                        jsx('div', {
                          className: 'text-(--ui-error)',
                          children: 'Failed to load repositories.',
                        }),
                        jsx('pre', {
                          className:
                            'mt-2 text-left text-xs text-(--ui-text-tertiary) whitespace-pre-wrap break-words max-h-40 overflow-auto',
                          children: (() => {
                            if (!error) return 'Unknown error'
                            const status = error?.status || error?.statusCode
                            const detail = error?.detail || error?.message || String(error)
                            return `status: ${status ?? 'n/a'}\n${detail}`
                          })(),
                        }),
                        jsx('button', {
                          type: 'button',
                          onClick: () => refetch(),
                          className: 'mt-2 underline',
                          children: 'Try again',
                        }),
                      ],
                    })
                  : jsx(RepoList, {
                      repos,
                      onOpen: openRepo,
                      onClose: () => setOpen(false),
                      refetch,
                    }),
            ],
          }),
        }),
      }),
    ],
  })
}

const plugin = {
  id: 'my-github',
  name: 'My GitHub',
  description: 'A "View repositories" button that opens a modal listing your GitHub repos.',
  register(ctx) {
    ctx.register({
      id: 'chip',
      area: STATUSBAR_AREAS.right,
      data: { order: 120, align: 'right' },
      render: () => jsx(Chip, { ctx }),
    })

    ctx.register({
      id: 'open',
      area: PALETTE_AREA,
      data: {
        title: 'GitHub: View repositories',
        description: 'Open a window with all your GitHub repositories',
        run: () => window.dispatchEvent(new CustomEvent('my-github:open')),
      },
    })
  },
}

export default plugin
