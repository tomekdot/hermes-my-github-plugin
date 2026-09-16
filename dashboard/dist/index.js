/**
 * My GitHub — Dashboard Plugin Bundle
 */
(function () {
  "use strict";

  const SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK) return;

  const { React } = SDK;
  const h = React.createElement;
  const { useState, useEffect, useCallback, useMemo, useRef } = React;

  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 30) return `${days}d ago`;
    return d.toISOString().slice(0, 10);
  }

  function Stat({ label, value }) {
    return h("div", { className: "flex flex-col items-center px-4 py-2 bg-(--ui-bg-secondary) rounded border border-(--ui-border)" },
      h("span", { className: "text-lg font-bold text-(--ui-text)" }, String(value)),
      h("span", { className: "text-[11px] uppercase tracking-wide text-(--ui-text-tertiary)" }, label)
    );
  }

  function RepoRow({ repo, onOpen }) {
    return h("tr", { className: "border-b border-(--ui-border) hover:bg-(--ui-hover) transition-colors text-sm" },
      h("td", { className: "p-3 font-semibold text-(--ui-text)" }, repo.name),
      h("td", { className: "p-3 text-(--ui-text-tertiary) my-github-desc" }, repo.description || "—"),
      h("td", { className: "p-3" },
        repo.private ? h("span", { className: "px-2 py-0.5 text-xs rounded bg-(--ui-warning)/20 text-(--ui-warning)" }, "private") :
        repo.fork ? h("span", { className: "px-2 py-0.5 text-xs rounded bg-(--ui-border) text-(--ui-text-tertiary)" }, "fork") :
        h("span", { className: "px-2 py-0.5 text-xs rounded bg-(--ui-success)/20 text-(--ui-success)" }, "public")
      ),
      h("td", { className: "p-3 text-(--ui-text-tertiary)" }, repo.language || "—"),
      h("td", { className: "p-3 text-(--ui-text)" }, `★ ${repo.stargazers_count || 0}`),
      h("td", { className: "p-3 text-(--ui-text)" }, `⑂ ${repo.forks_count || 0}`),
      h("td", { className: "p-3 text-(--ui-text-tertiary)" }, fmtDate(repo.pushed_at)),
      h("td", { className: "p-3 text-right" },
        h("button", {
          type: "button",
          className: "px-3 py-1 text-xs rounded bg-(--ui-accent) text-(--ui-accent-foreground) hover:opacity-90 transition",
          onClick: () => onOpen(repo.html_url)
        }, "Open ↗")
      )
    );
  }

  function MyGitHubView() {
    const [repos, setRepos] = useState([]);
    const [summary, setSummary] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [vis, setVis] = useState("all");
    const [q, setQ] = useState("");
    const [sort, setSort] = useState("pushed");
    const scrollRef = useRef(null);

    const getAuthHeaders = () => {
      const token = window.__HERMES_SESSION_TOKEN__ || window.__HERMES_AUTH_TOKEN__;
      const headers = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      return headers;
    };

    const load = useCallback(() => {
      setIsLoading(true);
      setError(null);
      const headers = getAuthHeaders();

      Promise.all([
        fetch("/api/plugins/my-github/repos", { headers, credentials: "same-origin" }).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        }),
        fetch("/api/plugins/my-github/summary", { headers, credentials: "same-origin" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ])
        .then(([data, sum]) => {
          setRepos(data.repos || []);
          setSummary(sum);
        })
        .catch((e) => setError(e.message || "Failed to load repositories"))
        .finally(() => setIsLoading(false));
    }, []);

    useEffect(() => {
      load();
    }, [load]);

    // Grab-to-scroll + wheel-to-scroll (bez Shift)
    useEffect(() => {
      const el = scrollRef.current;
      if (!el) return;

      let isDown = false;
      let startX, scrollLeft;

      const onWheel = (e) => {
        if (el.scrollWidth > el.clientWidth) {
          e.preventDefault();
          el.scrollLeft += e.deltaY;
        }
      };

      const onMouseDown = (e) => {
        isDown = true;
        el.classList.add("cursor-grabbing");
        startX = e.pageX - el.offsetLeft;
        scrollLeft = el.scrollLeft;
      };

      const onMouseMove = (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - el.offsetLeft;
        el.scrollLeft = scrollLeft - (x - startX);
      };

      const onMouseUp = () => {
        isDown = false;
        el.classList.remove("cursor-grabbing");
      };

      el.addEventListener("wheel", onWheel, { passive: false });
      el.addEventListener("mousedown", onMouseDown);
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);

      return () => {
        el.removeEventListener("wheel", onWheel);
        el.removeEventListener("mousedown", onMouseDown);
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };
    }, []);

    const filtered = useMemo(() => {
      const s = q.trim().toLowerCase();
      const rows = repos.filter((r) => {
        if (vis === "public" && r.private) return false;
        if (vis === "private" && !r.private) return false;
        if (!s) return true;
        return (
          (r.name && r.name.toLowerCase().includes(s)) ||
          (r.description && r.description.toLowerCase().includes(s)) ||
          (r.language && r.language.toLowerCase().includes(s))
        );
      });
      const by = {
        pushed: (a, b) => String(b.pushed_at || "").localeCompare(String(a.pushed_at || "")),
        stars: (a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0),
        forks: (a, b) => (b.forks_count || 0) - (a.forks_count || 0),
        name: (a, b) => String(a.name || "").localeCompare(String(b.name || "")),
        created: (a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")),
      };
      rows.sort(by[sort] || by.pushed);
      return rows;
    }, [repos, q, vis, sort]);

    const openRepo = (url) => {
      if (url && typeof window !== "undefined") {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    };

    return h("div", { className: "p-6 max-w-6xl mx-auto flex flex-col gap-6" },
      h("div", { className: "flex items-center justify-between border-b border-(--ui-border) pb-4" },
        h("div", {},
          h("h1", { className: "text-2xl font-bold text-(--ui-text)" }, "GitHub Repositories"),
          summary && h("p", { className: "text-sm text-(--ui-text-tertiary) mt-1" }, `@${summary.login} • ${summary.total} repositories total`)
        ),
        h("button", {
          type: "button",
          onClick: load,
          className: "px-3 py-1.5 text-sm rounded border border-(--ui-border) text-(--ui-text) hover:bg-(--ui-hover)"
        }, "↻ Refresh")
      ),

      summary && h("div", { className: "grid grid-cols-2 sm:grid-cols-4 gap-4" },
        h(Stat, { label: "Repositories", value: summary.total }),
        h(Stat, { label: "Total Stars", value: summary.total_stars || 0 }),
        h(Stat, { label: "Open Issues", value: summary.open_issues || 0 }),
        h(Stat, { label: "Forks", value: summary.forks || 0 })
      ),

      h("div", { className: "flex items-center gap-3 flex-wrap" },
        h("input", {
          type: "text",
          placeholder: "Search repositories...",
          value: q,
          onChange: (e) => setQ(e.target.value),
          className: "flex-1 min-w-[240px] px-3 py-1.5 rounded border border-(--ui-border) bg-(--ui-bg-input) text-(--ui-text) text-sm"
        }),
        h("div", { className: "flex rounded border border-(--ui-border) overflow-hidden text-xs" },
          ["all", "public", "private"].map((v) =>
            h("button", {
              key: v,
              type: "button",
              onClick: () => setVis(v),
              className: `px-3 py-1.5 capitalize transition ${vis === v ? "bg-(--ui-accent) text-(--ui-accent-foreground)" : "text-(--ui-text-tertiary) hover:bg-(--ui-hover)"}`
            }, v)
          )
        ),
        h("select", {
          value: sort,
          onChange: (e) => setSort(e.target.value),
          className: "px-3 py-1.5 rounded border border-(--ui-border) bg-(--ui-bg-input) text-(--ui-text) text-sm"
        },
          h("option", { value: "pushed" }, "Last pushed"),
          h("option", { value: "stars" }, "Most stars"),
          h("option", { value: "forks" }, "Most forks"),
          h("option", { value: "created" }, "Newest"),
          h("option", { value: "name" }, "Name A–Z")
        )
      ),

      isLoading ? h("div", { className: "py-12 text-center text-(--ui-text-tertiary)" }, "Loading repositories from GitHub...") :
      error ? h("div", { className: "py-12 text-center text-(--ui-error)" }, `Error: ${error}`) :
      filtered.length === 0 ? h("div", { className: "py-12 text-center text-(--ui-text-tertiary)" }, "No repositories found.") :
      h("div", { ref: scrollRef, className: "my-github-scroll" },
        h("table", { className: "my-github-table w-full text-left" },
          h("thead", { className: "bg-(--ui-bg-secondary) border-b border-(--ui-border) text-xs uppercase tracking-wider text-(--ui-text-tertiary)" },
            h("tr", {},
              h("th", { className: "p-3" }, "Name"),
              h("th", { className: "p-3" }, "Description"),
              h("th", { className: "p-3" }, "Visibility"),
              h("th", { className: "p-3" }, "Language"),
              h("th", { className: "p-3" }, "Stars"),
              h("th", { className: "p-3" }, "Forks"),
              h("th", { className: "p-3" }, "Pushed"),
              h("th", { className: "p-3 text-right" }, "Action")
            )
          ),
          h("tbody", {},
            filtered.map((repo) => h(RepoRow, { key: repo.full_name || repo.name, repo, onOpen: openRepo }))
          )
        )
      )
    );
  }

  if (window.__HERMES_PLUGINS__ && typeof window.__HERMES_PLUGINS__.register === "function") {
    window.__HERMES_PLUGINS__.register("my-github", MyGitHubView);
  }
})();
