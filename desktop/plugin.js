/**
 * My GitHub — desktop plugin (UI half).
 *
 * Modern minimalist UI: borderless clean stats grid, borderless inputs,
 * smooth rounded highlights, and fast filters: all | pub | priv | fork.
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
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
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

function Stat({ label, value, icon }) {
  return jsxs('div', {
    className:
      'flex flex-col items-center justify-center py-2 px-3 rounded-lg bg-(--ui-input)/40 hover:bg-(--ui-input)/70 transition-colors',
    children: [
      jsxs('span', {
        className: 'text-base font-bold text-(--ui-text) flex items-center gap-1',
        children: [
          icon ? jsx('span', { className: 'text-xs text-(--ui-text-tertiary)', children: icon }) : null,
          String(value ?? 0),
        ],
      }),
      jsx('span', {
        className: 'text-[10px] font-medium uppercase tracking-wider text-(--ui-text-tertiary) mt-0.5',
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
        'w-full min-w-0 text-left px-3 py-2.5 rounded-lg flex items-start gap-3 transition-colors duration-150 hover:bg-(--ui-hover) group cursor-pointer',
      children: jsxs('div', {
        className: 'min-w-0 flex-1',
        children: [
          jsxs('div', {
            className: 'flex items-center gap-2 min-w-0 flex-wrap',
            children: [
              jsx('span', {
                className:
                  'font-medium text-[13px] text-(--ui-text) group-hover:text-(--ui-accent) transition-colors break-words',
                children: repo.name,
              }),
              repo.private
                ? jsx('span', {
                    className:
                      'text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400/90 border border-amber-500/20 shrink-0 leading-none',
                    children: 'private',
                  })
                : jsx('span', {
                    className:
                      'text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-400 border border-zinc-700/50 shrink-0 leading-none',
                    children: 'public',
                  }),
              repo.fork
                ? jsx('span', {
                    className:
                      'text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400/90 border border-purple-500/20 shrink-0 leading-none',
                    children: 'fork',
                  })
                : null,
              repo.archived
                ? jsx('span', {
                    className:
                      'text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 shrink-0 leading-none',
                    children: 'archived',
                  })
                : null,
              jsxs('div', {
                className: 'flex items-center gap-2.5 shrink-0 ml-auto text-xs text-(--ui-text-tertiary)',
                children: [
                  repo.language
                    ? jsx('span', {
                        className: 'text-[11px] font-normal text-(--ui-text-tertiary) flex items-center gap-1',
                        children: repo.language,
                      })
                    : null,
                  jsx('span', {
                    className: 'text-[11px] text-(--ui-text-tertiary)',
                    children: `★ ${repo.stargazers_count || 0}`,
                  }),
                  jsx('span', {
                    className: 'text-[11px] text-(--ui-text-tertiary)',
                    children: `⑂ ${repo.forks_count || 0}`,
                  }),
                  repo.pushed_at
                    ? jsx('span', {
                        className: 'text-[10px] text-(--ui-text-tertiary) min-w-[50px] text-right',
                        children: fmtDate(repo.pushed_at),
                      })
                    : null,
                ],
              }),
            ],
          }),
          repo.description
            ? jsx('div', {
                className:
                  'text-xs text-(--ui-text-tertiary) break-words whitespace-normal mt-0.5 leading-snug line-clamp-2',
                children: repo.description,
              })
            : null,
        ],
      }),
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
  const [vis, setVis] = useState('all') // all | public | private | fork

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    const rows = (repos || []).filter((r) => {
      // Filtr widoczności oraz forków
      if (vis === 'public' && r.private) return false
      if (vis === 'private' && !r.private) return false
      if (vis === 'fork' && !r.fork) return false

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
          'rounded px-2 h-full flex items-center text-xs font-medium transition-all ' +
          (vis === v
            ? 'bg-(--ui-accent) text-(--ui-accent-foreground) shadow-sm'
            : 'text-(--ui-text-tertiary) hover:text-(--ui-text) hover:bg-(--ui-hover)'),
        children: label,
      },
      v,
    )

  return jsxs(Fragment, {
    children: [
      jsxs('div', {
        className: 'flex items-center gap-2 py-2',
        children: [
          jsx('span', {
            className: 'text-[11px] text-(--ui-text-tertiary) shrink-0 pl-1',
            children: '★',
          }),
          jsx('input', {
            type: 'text',
            value: q,
            placeholder: 'Search repositories…',
            onChange: (e) => setQ(e.target.value),
            className:
              'flex-1 min-w-0 h-[28px] bg-(--ui-input)/60 text-(--ui-text) rounded-md px-2.5 text-xs outline-none focus:ring-1 focus:ring-(--ui-ring) transition-all',
          }),
          // Pigułka wyboru z nową opcją 'fork'
          jsxs('div', {
            className: 'flex items-center h-[28px] rounded-md p-0.5 shrink-0 bg-(--ui-input)/60',
            children: [
              visBtn('all', 'all'),
              visBtn('public', 'pub'),
              visBtn('private', 'priv'),
              visBtn('fork', 'fork'),
            ],
          }),
          jsx('select', {
            value: sort,
            onChange: (e) => setSort?.(e.target.value),
            className:
              'h-[28px] rounded-md px-2 text-xs bg-(--ui-input)/60 text-(--ui-text) outline-none cursor-pointer hover:bg-(--ui-hover) focus:ring-1 focus:ring-(--ui-ring) transition-all',
            children: SORTS.map(([v, label]) =>
              jsx(
                'option',
                {
                  value: v,
                  style: { backgroundColor: '#18181b', color: '#ffffff' },
                  children: label,
                },
                v,
              ),
            ),
          }),
          jsx('button', {
            type: 'button',
            title: 'Refresh',
            onClick: refetch,
            'aria-label': 'Refresh',
            className:
              'h-[28px] w-[28px] flex items-center justify-center rounded-md text-xs text-(--ui-text-tertiary) hover:bg-(--ui-hover) hover:text-(--ui-text) bg-(--ui-input)/60 shrink-0 transition-colors',
            children: '↻',
          }),
        ],
      }),
      jsx('div', {
        className: 'overflow-y-auto overflow-x-hidden max-h-[62vh] py-1 flex flex-col gap-0.5',
        children:
          filtered.length === 0
            ? jsx('div', {
                className: 'px-3 py-10 text-center text-(--ui-text-tertiary) text-sm',
                children: 'No repositories match.',
              })
            : filtered.map((repo) => jsx(RepoRow, { repo, onOpen }, repo.full_name || repo.name)),
      }),
      jsx('div', {
        className: 'px-2 pt-2 text-[11px] text-(--ui-text-tertiary) border-t border-(--ui-border-subtle)/40',
        children: `${filtered.length} of ${(repos || []).length} repositories`,
      }),
    ],
  })
}

function Chip({ ctx }) {
  const [open, setOpen] = useState(false)
  const { repos, summary, sort, setSort, isLoading, isError, error, refetch } = useGithub(ctx)

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

  const isForbidden = error?.status === 403 || error?.statusCode === 403

  return jsxs(Fragment, {
    children: [
      jsx('button', {
        type: 'button',
        title: 'View repositories',
        onClick: () => setOpen((o) => !o),
        className:
          'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs text-(--ui-text-tertiary) hover:bg-(--ui-hover) hover:text-(--ui-text) transition-colors',
        children: jsxs(Fragment, {
          children: [
            jsx('span', { className: 'text-sm', children: '★' }),
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
          style: { width: '52vw', maxWidth: '92vw' },
          className:
            'overflow-x-hidden border border-(--ui-border-subtle) rounded-xl shadow-2xl bg-(--ui-bg) p-4',
          children: jsxs('div', {
            className: 'min-w-0 flex flex-col gap-2.5',
            children: [
              jsx(DialogTitle, {
                className: 'text-base font-semibold flex items-center gap-2',
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
                    className: 'grid grid-cols-4 gap-2 w-full my-1',
                    children: [
                      jsx(Stat, { label: 'repos', value: summary.total }),
                      jsx(Stat, { label: 'stars', value: summary.total_stars, icon: '★' }),
                      jsx(Stat, { label: 'issues', value: summary.open_issues }),
                      jsx(Stat, { label: 'forks', value: summary.forks, icon: '⑂' }),
                    ],
                  })
                : null,
              isLoading
                ? jsx('div', {
                    className: 'px-1 py-12 text-center text-(--ui-text-tertiary) text-sm',
                    children: 'Loading repositories…',
                  })
                : isError
                  ? jsxs('div', {
                      className: 'px-1 py-8 text-center text-sm',
                      children: [
                        jsx('div', {
                          className: 'text-(--ui-error) font-medium',
                          children: isForbidden
                            ? 'GitHub API 403 Forbidden (Rate Limit / Missing Token)'
                            : 'Failed to load repositories.',
                        }),
                        jsx('div', {
                          className: 'mt-2 text-xs text-(--ui-text-tertiary) max-w-md mx-auto',
                          children: isForbidden
                            ? 'Please configure GITHUB_TOKEN in ~/.hermes/.env or authenticate with `gh auth login`.'
                            : String(error?.detail || error?.message || 'Check terminal / gateway logs.'),
                        }),
                        jsx('button', {
                          type: 'button',
                          onClick: () => refetch(),
                          className: 'mt-3 text-xs underline text-(--ui-accent) hover:opacity-80',
                          children: 'Try again',
                        }),
                      ],
                    })
                  : jsx(RepoList, {
                      repos,
                      sort,
                      setSort,
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