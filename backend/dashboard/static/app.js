/* Coco Trust Layer — dashboard application.
 *
 * Single-file, no-build vanilla JS. Organised by region; see headers
 * below. Talks to the existing FastAPI gateway via /api/* endpoints and
 * adds light client-side state in the URL hash so refresh + share work.
 *
 * Regions:
 *   1. utils         escape, format, fetchJson, debounce, time
 *   2. glyphs        inline SVG sprite (no icon CDN)
 *   3. toast         transient notifications
 *   4. drawer        verdict / pack detail drawer (shared)
 *   5. palette       cmd-k jump-to
 *   6. api           thin wrapper around fetch + small in-memory cache
 *   7. router        hash-based router with query state
 *   8. views         live, escalations, packs, audit, integrations,
 *                    settings, onboarding (one render function each)
 *   9. bootstrap     init, sidebar binding, global keyboard, polling
 */
(function () {
  "use strict";

  /* =================================================================
   * 1. UTILS
   * ================================================================= */

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const h  = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class")        node.className = v;
      else if (k === "html")    node.innerHTML = v;
      else if (k === "text")    node.textContent = v;
      else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "dataset" && typeof v === "object")      Object.entries(v).forEach(([dk, dv]) => { node.dataset[dk] = dv; });
      else node.setAttribute(k, v);
    }
    for (const c of children) {
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  };

  function escapeHtml(v) {
    if (v === null || v === undefined) return "";
    return String(v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function fmtRelTime(iso) {
    if (!iso) return "—";
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return iso;
    const delta = (Date.now() - t) / 1000;
    if (delta < 5) return "just now";
    if (delta < 60) return `${Math.floor(delta)}s ago`;
    if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
    if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
    if (delta < 86400 * 7) return `${Math.floor(delta / 86400)}d ago`;
    return new Date(iso).toISOString().slice(0, 10);
  }

  function fmtAbsTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
  }

  function fmtNum(n, opts = {}) {
    if (n === null || n === undefined || Number.isNaN(n)) return "—";
    const { unit = "", digits = 0 } = opts;
    const num = Number(n);
    const formatted = digits ? num.toFixed(digits) : Math.round(num).toLocaleString();
    return unit ? `${formatted}${unit}` : formatted;
  }

  function fmtPct(n, digits = 0) {
    if (n === null || n === undefined || Number.isNaN(n)) return "—";
    return `${(Number(n) * 100).toFixed(digits)}%`;
  }

  function debounce(fn, ms) {
    let t;
    return function () {
      clearTimeout(t);
      const args = arguments;
      const self = this;
      t = setTimeout(() => fn.apply(self, args), ms);
    };
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        resolve();
      } catch (e) { reject(e); }
    });
  }

  /* =================================================================
   * 2. GLYPHS — inline SVG sprite (no CDN)
   * ================================================================= */

  const GLYPHS = {
    activity:    '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>',
    bell:        '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10 21a2 2 0 0 0 4 0"></path>',
    file:        '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline>',
    layers:      '<polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline>',
    plug:        '<path d="M9 2v6"></path><path d="M15 2v6"></path><path d="M6 8h12v4a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8z"></path><path d="M12 18v4"></path>',
    cog:         '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"></path>',
    search:      '<circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>',
    play:        '<polygon points="5 3 19 12 5 21 5 3"></polygon>',
    download:    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>',
    refresh:     '<polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>',
    check:       '<polyline points="20 6 9 17 4 12"></polyline>',
    x:           '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>',
    arrow_right: '<line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline>',
    arrow_up:    '<line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline>',
    arrow_down:  '<line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline>',
    edit:        '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>',
    save:        '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline>',
    revert:      '<polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>',
    eye:         '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>',
    copy:        '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
    bank:        '<line x1="3" y1="21" x2="21" y2="21"></line><line x1="3" y1="10" x2="21" y2="10"></line><polyline points="5 6 12 3 19 6"></polyline><line x1="4" y1="10" x2="4" y2="21"></line><line x1="20" y1="10" x2="20" y2="21"></line><line x1="9" y1="10" x2="9" y2="21"></line><line x1="15" y1="10" x2="15" y2="21"></line>',
    trending:    '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline>',
  };

  function mountGlyphs() {
    $$(".nav-glyph[data-glyph], .search-box .nav-glyph").forEach((el) => {
      const name = el.dataset.glyph || "search";
      el.innerHTML = svgIcon(name);
    });
  }

  function svgIcon(name, size = 16) {
    const body = GLYPHS[name] || GLYPHS.search;
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  function inlineSvg(name) {
    const tmp = document.createElement("span");
    tmp.innerHTML = svgIcon(name);
    return tmp.firstChild;
  }

  /* =================================================================
   * 3. TOAST
   * ================================================================= */

  function toast(message, kind = "info", ttl = 3000) {
    const stack = $("#toast-stack");
    if (!stack) return;
    const node = h("div", { class: "toast", dataset: { kind } }, message);
    stack.appendChild(node);
    setTimeout(() => {
      node.style.transition = "opacity 0.25s ease, transform 0.25s ease";
      node.style.opacity = "0";
      node.style.transform = "translateX(8px)";
      setTimeout(() => node.remove(), 280);
    }, ttl);
  }

  /* =================================================================
   * 4. DRAWER
   * ================================================================= */

  const drawer = {
    el: null,
    scrim: null,
    onClose: null,
    init() {
      this.el = $("#drawer");
      this.scrim = $("#drawer-scrim");
      $("#drawer-close").addEventListener("click", () => this.close());
      this.scrim.addEventListener("click", () => this.close());
    },
    open(opts) {
      const { verdict, title, body, foot, onClose } = opts;
      $("#drawer-verdict").textContent = verdict || "—";
      $("#drawer-verdict").setAttribute("data-v", verdict || "—");
      $("#drawer-title").textContent = title || "";
      const bodyEl = $("#drawer-body"); bodyEl.innerHTML = ""; if (body) bodyEl.appendChild(body);
      const footEl = $("#drawer-foot"); footEl.innerHTML = ""; if (foot) footEl.appendChild(foot);
      this.el.dataset.open = "true";
      this.scrim.dataset.open = "true";
      this.el.setAttribute("aria-hidden", "false");
      this.onClose = onClose || null;
    },
    close() {
      this.el.dataset.open = "false";
      this.scrim.dataset.open = "false";
      this.el.setAttribute("aria-hidden", "true");
      const cb = this.onClose; this.onClose = null;
      if (typeof cb === "function") cb();
    },
    isOpen() { return this.el && this.el.dataset.open === "true"; },
  };

  /* =================================================================
   * 5. COMMAND PALETTE
   * ================================================================= */

  const palette = {
    el: null,
    scrim: null,
    input: null,
    list: null,
    items: [],
    filtered: [],
    selected: 0,
    init() {
      this.el = $("#palette");
      this.scrim = $("#palette-scrim");
      this.input = $("#palette-input");
      this.list = $("#palette-list");
      $("#palette-open").addEventListener("click", () => this.open());
      this.scrim.addEventListener("click", () => this.close());
      this.input.addEventListener("input", () => this.filter());
      this.input.addEventListener("keydown", (e) => this.onKey(e));
    },
    open() {
      this.items = api.paletteItems();
      this.input.value = "";
      this.selected = 0;
      this.filter();
      this.el.dataset.open = "true";
      this.scrim.dataset.open = "true";
      setTimeout(() => this.input.focus(), 40);
    },
    close() {
      this.el.dataset.open = "false";
      this.scrim.dataset.open = "false";
    },
    isOpen() { return this.el && this.el.dataset.open === "true"; },
    filter() {
      const q = this.input.value.trim().toLowerCase();
      this.filtered = q
        ? this.items.filter((it) => (it.label + " " + (it.kind || "")).toLowerCase().includes(q))
        : this.items;
      this.selected = 0;
      this.render();
    },
    render() {
      this.list.innerHTML = "";
      if (!this.filtered.length) {
        this.list.appendChild(h("li", { class: "palette-item" }, h("span", { style: { color: "var(--ink-4)" } }, "No matches.")));
        return;
      }
      this.filtered.slice(0, 20).forEach((it, i) => {
        const node = h("li", {
          class: "palette-item",
          role: "option",
          "aria-selected": i === this.selected ? "true" : "false",
          onClick: () => { this.choose(it); },
        }, it.label, h("span", { class: "palette-kind" }, it.kind));
        this.list.appendChild(node);
      });
    },
    move(delta) {
      if (!this.filtered.length) return;
      this.selected = (this.selected + delta + this.filtered.length) % this.filtered.length;
      this.render();
      const target = this.list.children[this.selected];
      if (target && target.scrollIntoView) target.scrollIntoView({ block: "nearest" });
    },
    choose(item) {
      this.close();
      if (item && item.href) location.hash = item.href;
    },
    onKey(e) {
      if (e.key === "ArrowDown")    { e.preventDefault(); this.move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); this.move(-1); }
      else if (e.key === "Enter")   { e.preventDefault(); this.choose(this.filtered[this.selected]); }
      else if (e.key === "Escape")  { this.close(); }
    },
  };

  /* =================================================================
   * 6. API
   * ================================================================= */

  const api = {
    _cache: {},

    async fetchJson(url, init) {
      const resp = await fetch(url, init);
      if (!resp.ok) {
        let detail = "";
        try {
          const body = await resp.json();
          if (body && body.detail) detail = ` — ${body.detail}`;
        } catch (_) { /* noop */ }
        throw new Error(`${resp.status} ${resp.statusText}${detail}`);
      }
      const ct = resp.headers.get("content-type") || "";
      if (ct.includes("application/json")) return resp.json();
      return resp.text();
    },

    health()      { return this.fetchJson("/health"); },
    packs()       { return this.fetchJson("/api/packs"); },
    pack(id)      { return this.fetchJson(`/api/packs/${encodeURIComponent(id)}`); },
    packYaml(id)  { return this.fetchJson(`/api/packs/${encodeURIComponent(id)}/yaml`); },
    savePack(id, yamlText) {
      return this.fetchJson(`/api/packs/${encodeURIComponent(id)}/yaml`, {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: yamlText,
      });
    },
    packVersions(id) { return this.fetchJson(`/api/packs/${encodeURIComponent(id)}/versions`); },
    revertPack(id, version) {
      return this.fetchJson(`/api/packs/${encodeURIComponent(id)}/revert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
    },
    scenarios()   { return this.fetchJson("/api/scenarios"); },
    scenario(id)  { return this.fetchJson(`/api/scenarios/${encodeURIComponent(id)}`); },
    runScenario(id, driver = "engine") {
      return this.fetchJson(`/api/scenarios/${encodeURIComponent(id)}/run?driver=${driver}`, { method: "POST" });
    },
    audit(limit = 100) { return this.fetchJson(`/api/audit?limit=${limit}`); },
    auditSearch(params) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== "") qs.set(k, v);
      const q = qs.toString();
      return this.fetchJson(`/api/audit/search${q ? "?" + q : ""}`);
    },
    auditExportUrl(params) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== "") qs.set(k, v);
      const q = qs.toString();
      return `/api/audit/export.csv${q ? "?" + q : ""}`;
    },
    metricsLive() { return this.fetchJson("/api/metrics/live"); },
    escalations() { return this.fetchJson("/api/escalations"); },
    approveEscalation(id, comment) {
      return this.fetchJson(`/api/escalations/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: comment || "" }),
      });
    },
    denyEscalation(id, comment) {
      return this.fetchJson(`/api/escalations/${id}/deny`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: comment || "" }),
      });
    },

    paletteItems() {
      const items = [
        { label: "Live", href: "#/live", kind: "view" },
        { label: "Escalations", href: "#/escalations", kind: "view" },
        { label: "Action Packs", href: "#/packs", kind: "view" },
        { label: "Audit Ledger", href: "#/audit", kind: "view" },
        { label: "Integrations", href: "#/integrations", kind: "view" },
        { label: "Settings", href: "#/settings", kind: "view" },
        { label: "Agent Banking", href: "#/banking", kind: "view" },
        { label: "Agent actions", href: "#/actions", kind: "view" },
        { label: "Securities Lending", href: "#/seclend", kind: "view" },
        { label: "Lifecycle actions", href: "#/seclend_actions", kind: "view" },
      ];
      (state.packs || []).forEach((p) => items.push({ label: p.id, href: `#/packs/${encodeURIComponent(p.id)}`, kind: "pack" }));
      (state.scenarios || []).forEach((s) => items.push({ label: s.id, href: `#/packs/${encodeURIComponent(s.pack_id)}?run=${encodeURIComponent(s.id)}`, kind: "scenario" }));
      return items;
    },
  };

  /* =================================================================
   * 7. ROUTER + STATE
   * ================================================================= */

  const state = {
    packs: [],
    scenarios: [],
    health: null,
    audit: [],          // last 100 from /api/audit
    metrics: null,
    escalations: [],
    driver: "engine",
    lastView: null,
    workspace: (() => { try { return localStorage.getItem("coco.workspace") || "twenty"; } catch (_) { return "twenty"; } })(),
  };

  // Workspaces let one gateway present more than one governed workflow.
  // Each maps to a company and the pack-id prefix that scopes its views.
  const WORKSPACES = [
    { id: "twenty", label: "Twenty CRM", prefix: "twenty.", home: "live" },
    { id: "banking", label: "Agent Bank", prefix: "banking.", home: "banking" },
    { id: "securities_lending", label: "Securities Lending", prefix: "securities_lending.", home: "seclend" },
  ];
  function currentWorkspace() {
    return WORKSPACES.find((w) => w.id === state.workspace) || WORKSPACES[0];
  }
  function inWorkspace(packId) {
    return typeof packId === "string" && packId.startsWith(currentWorkspace().prefix);
  }

  function parseHash() {
    const raw = (location.hash || "#/live").replace(/^#\/?/, "");
    const [pathPart, queryPart] = raw.split("?");
    const segs = pathPart.split("/").filter(Boolean);
    const route = segs[0] || "live";
    const params = {};
    if (queryPart) {
      for (const pair of queryPart.split("&")) {
        const [k, v] = pair.split("=");
        if (k) params[decodeURIComponent(k)] = v ? decodeURIComponent(v) : "";
      }
    }
    return { route, segs, params };
  }

  function setQuery(updates, opts = {}) {
    const { route, segs, params } = parseHash();
    const next = { ...params };
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === undefined || v === "") delete next[k];
      else next[k] = v;
    }
    const path = "#/" + segs.join("/");
    const qs = Object.entries(next).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    const target = qs ? `${path}?${qs}` : path;
    if (opts.replace) history.replaceState(null, "", target);
    else location.hash = target;
  }

  const routes = {}; // route name -> render function

  async function dispatch() {
    const { route, segs, params } = parseHash();
    const root = $("#view-root");
    if (!root) return;
    state.lastView = route;
    syncWorkspaceToRoute(route);
    $$(".nav-item").forEach((el) => {
      el.toggleAttribute("aria-current", el.dataset.route === route);
      if (el.dataset.route === route) el.setAttribute("aria-current", "page");
      else el.removeAttribute("aria-current");
    });
    root.innerHTML = "";
    const fn = routes[route] || routes.live;
    try {
      await fn(root, segs, params);
    } catch (err) {
      console.error("[route]", route, err);
      root.appendChild(renderError(err));
    }
  }

  function renderError(err) {
    return h("div", { class: "view" },
      h("div", { class: "empty" },
        h("h3", {}, "Something went wrong"),
        h("p", {}, err && err.message ? err.message : String(err)),
        h("button", { class: "btn", onClick: dispatch }, "Retry")
      )
    );
  }

  /* =================================================================
   * 8. VIEWS
   * ================================================================= */

  /* ---- 8.1 LIVE -------------------------------------------------- */

  routes.live = async function (root, _segs, params) {
    const view = h("div", { class: "view" });
    root.appendChild(view);

    view.appendChild(h("div", { class: "view-head" },
      h("div", {},
        h("h1", { class: "view-title" }, "Live"),
        h("p", { class: "view-sub" }, "Verdicts streaming in from the gateway. Click any row to see the policy that fired and the full decision JSON.")
      ),
      h("div", { class: "view-actions" },
        h("button", { class: "btn btn-ghost", id: "live-refresh", onClick: () => loadLive() },
          inlineSvg("refresh"), " Refresh")
      )
    ));

    const tileRow = h("div", { class: "tile-row", id: "tile-row" });
    tileRow.appendChild(tileSkeleton("Verdicts · last hour"));
    tileRow.appendChild(tileSkeleton("Block rate"));
    tileRow.appendChild(tileSkeleton("p95 latency"));
    tileRow.appendChild(tileSkeleton("Escalations pending"));
    view.appendChild(tileRow);

    const filterBar = h("div", { class: "filterbar" });
    const searchInput = h("input", {
      class: "input", type: "search", placeholder: "Search reason text…", value: params.q || "",
      oninput: debounce((e) => { setQuery({ q: e.target.value }, { replace: true }); renderFeed(); }, 200),
    });
    const verdictChips = h("div", { class: "chips" });
    ["ALLOW", "BLOCK", "ESCALATE"].forEach((v) => {
      const pressed = (params.v || "").split(",").includes(v);
      verdictChips.appendChild(h("button", {
        class: "chip", "aria-pressed": pressed ? "true" : "false", dataset: { v },
        onClick: () => {
          const cur = (params.v || "").split(",").filter(Boolean);
          const i = cur.indexOf(v);
          if (i >= 0) cur.splice(i, 1); else cur.push(v);
          setQuery({ v: cur.join(",") }, { replace: true });
          renderFeed();
        },
      }, v));
    });
    const packSelect = h("select", { class: "select", style: { width: "auto", maxWidth: 220 } });
    packSelect.appendChild(h("option", { value: "" }, "All packs"));
    (state.packs || []).filter((p) => inWorkspace(p.id)).forEach((p) => packSelect.appendChild(h("option", { value: p.id }, p.id)));
    packSelect.value = params.pack || "";
    packSelect.addEventListener("change", (e) => { setQuery({ pack: e.target.value }, { replace: true }); renderFeed(); });

    filterBar.appendChild(searchInput);
    filterBar.appendChild(packSelect);
    filterBar.appendChild(verdictChips);
    view.appendChild(filterBar);

    const feed = h("div", { class: "feed", id: "feed" });
    feed.appendChild(feedSkeleton());
    view.appendChild(feed);

    async function loadLive() {
      try {
        const [audit, metrics] = await Promise.all([api.audit(100), api.metricsLive().catch(() => null)]);
        state.audit = audit;
        state.metrics = metrics;
        renderTiles();
        renderFeed();
      } catch (err) {
        feed.innerHTML = "";
        feed.appendChild(h("div", { class: "empty" },
          h("h3", {}, "Couldn't load verdicts"),
          h("p", {}, err.message),
          h("button", { class: "btn", onClick: loadLive }, "Retry"),
        ));
      }
    }

    function renderTiles() {
      // Tiles are scoped to the active workspace so each company's numbers
      // match its own feed. Latency stays a platform metric.
      const m = state.metrics || {};
      const rows = (state.audit || []).filter((r) => inWorkspace(r.pack_id));
      const total = rows.length;
      const blocks = rows.filter((r) => r.verdict === "BLOCK").length;
      const escPending = (state.escalations || []).filter((e) => inWorkspace(e.pack_id)).length;
      tileRow.innerHTML = "";
      tileRow.appendChild(tile({ label: "Verdicts · recent", value: fmtNum(total) }));
      tileRow.appendChild(tile({ label: "Block rate", value: fmtPct(total ? blocks / total : 0, 0) }));
      tileRow.appendChild(tile({ label: "p95 latency", value: fmtNum(m.latency_p95_ms), unit: "ms" }));
      tileRow.appendChild(tile({
        label: "Escalations pending",
        value: fmtNum(escPending),
        link: "#/escalations",
        emphasis: escPending > 0,
      }));
    }

    function renderFeed() {
      const params2 = parseHash().params;
      const verdictFilter = (params2.v || "").split(",").filter(Boolean);
      const packFilter = params2.pack || "";
      const q = (params2.q || "").trim().toLowerCase();

      const rows = (state.audit || []).filter((r) => {
        if (!inWorkspace(r.pack_id)) return false;
        if (verdictFilter.length && !verdictFilter.includes(r.verdict)) return false;
        if (packFilter && r.pack_id !== packFilter) return false;
        if (q && !(r.primary_reason || "").toLowerCase().includes(q) && !(r.pack_id || "").toLowerCase().includes(q)) return false;
        return true;
      });

      feed.innerHTML = "";
      if (!rows.length) {
        feed.appendChild(h("div", { class: "empty" },
          h("h3", {}, state.audit.length ? "No verdicts match these filters" : "No verdicts yet"),
          h("p", {}, state.audit.length
            ? "Loosen the filters above, or clear them with Esc."
            : "Take any action in Twenty with the SDK installed, or run a scenario from Action Packs."),
        ));
        return;
      }

      rows.forEach((r, idx) => {
        const row = h("div", {
          class: "feed-row",
          role: "button",
          tabindex: "0",
          dataset: { id: r.id },
          onClick: () => openVerdictDrawer(r),
          onKeydown: (e) => { if (e.key === "Enter") openVerdictDrawer(r); },
        },
          h("span", { class: "feed-time", title: r.timestamp || "" }, fmtRelTime(r.timestamp)),
          h("div", { class: "feed-main" },
            h("div", { class: "feed-pack" }, r.pack_id, " · ", h("span", { style: { color: "var(--ink-3)" } }, r.action || "")),
            h("div", { class: "feed-reason" }, r.primary_reason || ""),
          ),
          h("div", { class: "feed-end" },
            h("span", { class: "verdict", dataset: { v: r.verdict } }, r.verdict)
          ),
        );
        if (idx === 0 && r.id === state._lastTopId) row.dataset.new = "true";
        feed.appendChild(row);
      });
    }

    await loadLive();
    state._loadLive = loadLive;
  };

  function tileSkeleton(label) {
    return h("div", { class: "tile" },
      h("div", { class: "tile-label" }, label),
      h("div", { class: "sk", style: { height: "28px", width: "60%" } }),
      h("div", { class: "sk tile-spark", style: { height: "26px", width: "100%" } }),
    );
  }

  function tile({ label, value, unit, delta, deltaFormat, sparkline, link, emphasis }) {
    const wrap = h("div", { class: "tile" });
    if (link) { wrap.style.cursor = "pointer"; wrap.addEventListener("click", () => { location.hash = link; }); }
    wrap.appendChild(h("div", { class: "tile-label" }, label));
    const valueRow = h("div", { class: "tile-row-2" },
      h("div", {
        class: "tile-value",
        style: emphasis ? { color: "var(--escalate)" } : null,
      }, value),
      unit ? h("span", { class: "tile-unit" }, unit) : null,
    );
    if (typeof delta === "number" && !Number.isNaN(delta)) {
      const dir = Math.abs(delta) < 0.005 ? "flat" : delta > 0 ? "up" : "down";
      let txt;
      if (deltaFormat === "pct") txt = (delta > 0 ? "+" : "") + (delta * 100).toFixed(1) + "pp";
      else txt = (delta > 0 ? "+" : "") + delta;
      valueRow.appendChild(h("span", { class: "tile-delta", dataset: { dir } }, txt));
    }
    wrap.appendChild(valueRow);
    if (sparkline && sparkline.length) wrap.appendChild(sparklineEl(sparkline));
    else wrap.appendChild(h("div", { class: "tile-spark" }));
    return wrap;
  }

  function sparklineEl(buckets) {
    const wrap = h("div", { class: "tile-spark" });
    const maxV = Math.max(1, ...buckets);
    const w = 160, hgt = 26;
    const step = buckets.length > 1 ? w / (buckets.length - 1) : 0;
    const points = buckets.map((v, i) => `${(i * step).toFixed(1)},${(hgt - (v / maxV) * (hgt - 2) - 1).toFixed(1)}`).join(" ");
    wrap.innerHTML = `<svg viewBox="0 0 ${w} ${hgt}" preserveAspectRatio="none"><polyline points="${points}" fill="none" stroke="var(--ink-3)" stroke-width="1.5" /></svg>`;
    return wrap;
  }

  function feedSkeleton(rows = 8) {
    const wrap = h("div");
    for (let i = 0; i < rows; i++) {
      wrap.appendChild(h("div", { class: "sk-row" },
        h("span", { class: "sk" }),
        h("span", { class: "sk" }),
        h("span", { class: "sk" }),
      ));
    }
    return wrap;
  }

  /* ---- 8.2 VERDICT DRAWER (shared) ------------------------------ */

  async function openVerdictDrawer(row) {
    const verdict = row.verdict || row.decision?.verdict || "—";
    const decision = row.decision || row;
    const body = h("div");

    body.appendChild(h("div", { class: "drawer-section" },
      h("div", { class: "drawer-section-label" }, "Primary reason"),
      h("p", { style: { margin: 0, fontSize: "var(--fs-15)", color: "var(--ink-0)" } }, row.primary_reason || decision.primary_reason || "—"),
    ));

    const meta = h("dl", { class: "meta-grid" });
    meta.appendChild(h("dt", {}, "Pack"));     meta.appendChild(h("dd", {}, row.pack_id || decision.pack_id || "—"));
    meta.appendChild(h("dt", {}, "Action"));   meta.appendChild(h("dd", {}, row.action || decision.action || "—"));
    meta.appendChild(h("dt", {}, "Phase"));    meta.appendChild(h("dd", {}, row.phase || decision.phase || "—"));
    meta.appendChild(h("dt", {}, "Time"));     meta.appendChild(h("dd", { class: "is-ui" }, fmtRelTime(row.timestamp), " · ", h("span", { style: { color: "var(--ink-4)" } }, fmtAbsTime(row.timestamp))));
    if (row.id != null) { meta.appendChild(h("dt", {}, "Audit ID")); meta.appendChild(h("dd", {}, "#" + row.id)); }
    body.appendChild(h("div", { class: "drawer-section" }, meta));

    const checks = (decision.checks || []);
    if (checks.length) {
      const list = h("div", { class: "check-list" });
      checks.forEach((c) => {
        list.appendChild(h("div", { class: "check-item", dataset: { passed: c.passed ? "true" : "false" } },
          h("div", { class: "check-mark" }, c.passed ? "✓" : "✗"),
          h("div", { class: "check-body" },
            h("span", { class: "check-id" }, c.check_id),
            h("span", { class: "check-kind" }, c.kind),
            c.reason ? h("div", { class: "check-reason" }, c.reason) : null,
            c.observed !== null && c.observed !== undefined
              ? h("div", { class: "check-observed" }, "observed: " + JSON.stringify(c.observed))
              : null,
          ),
        ));
      });
      body.appendChild(h("div", { class: "drawer-section" },
        h("div", { class: "drawer-section-label" }, "Checks (" + checks.length + ")"),
        list,
      ));
    }

    // Pack snippet
    const packId = row.pack_id || decision.pack_id;
    if (packId) {
      const ySection = h("div", { class: "drawer-section" },
        h("div", { class: "drawer-section-label" }, "Policy"),
        h("div", { class: "sk", style: { height: "120px" } }),
      );
      body.appendChild(ySection);

      const failingCheckId = (checks.find((c) => !c.passed) || {}).check_id;
      api.packYaml(packId).then((res) => {
        const yaml = typeof res === "string" ? res : (res && res.yaml) || "";
        ySection.innerHTML = "";
        ySection.appendChild(h("div", { class: "drawer-section-label" }, "Policy · " + packId));
        const pre = h("pre", { class: "yaml-block" });
        pre.innerHTML = highlightYaml(yaml, failingCheckId);
        ySection.appendChild(pre);
        // Auto-scroll to highlighted line
        const hl = pre.querySelector(".hl");
        if (hl) hl.scrollIntoView({ block: "center" });
      }).catch((err) => {
        ySection.innerHTML = "";
        ySection.appendChild(h("div", { class: "drawer-section-label" }, "Policy"));
        ySection.appendChild(h("p", { style: { fontSize: "var(--fs-12)", color: "var(--ink-3)" } }, "Couldn't load YAML: " + err.message));
      });
    }

    // Raw JSON, collapsed
    const details = h("details", { class: "drawer-section" },
      h("summary", { style: { cursor: "pointer", fontSize: "var(--fs-12)", color: "var(--ink-3)" } }, "Decision JSON"),
      h("pre", { class: "json-block", style: { marginTop: "8px" } }, JSON.stringify(decision, null, 2)),
    );
    body.appendChild(details);

    const foot = h("div");
    if (packId) {
      foot.appendChild(h("button", { class: "btn btn-ghost", onClick: () => { drawer.close(); location.hash = `#/packs/${encodeURIComponent(packId)}`; } },
        inlineSvg("file"), " Open pack"));
    }
    if (row.id != null) {
      foot.appendChild(h("button", { class: "btn btn-ghost", onClick: () => { drawer.close(); location.hash = `#/audit?id=${row.id}`; } },
        inlineSvg("layers"), " View in audit"));
    }

    drawer.open({ verdict, title: row.pack_id || decision.pack_id || "Verdict", body, foot });
  }

  function highlightYaml(yaml, highlightCheckId) {
    const lines = String(yaml || "").split("\n");
    const escapedId = highlightCheckId ? escapeHtml(highlightCheckId) : null;
    let highlightLine = -1;
    if (escapedId) {
      for (let i = 0; i < lines.length; i++) {
        if (/^\s*-\s*id:\s*/.test(lines[i]) && lines[i].includes(highlightCheckId)) {
          highlightLine = i;
          break;
        }
      }
    }
    return lines.map((raw, i) => {
      let line = escapeHtml(raw);
      // simple tokenizer (post-escape, no re-escaping needed)
      line = line
        .replace(/(#.*)$/, '<span class="com">$1</span>')
        .replace(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(:)/, '$1<span class="key">$2</span>$3')
        .replace(/(:\s*)(&quot;[^&]*&quot;|&#39;[^&]*&#39;)/g, '$1<span class="str">$2</span>')
        .replace(/(:\s*)(true|false)\b/g, '$1<span class="bool">$2</span>')
        .replace(/(:\s*)(-?\d+(?:\.\d+)?)\b/g, '$1<span class="num">$2</span>');
      if (i >= highlightLine && highlightLine >= 0) {
        // highlight the rule and the following indented lines until next list item or section
        const indent = (lines[highlightLine].match(/^\s*/) || [""])[0].length;
        const cur = (raw.match(/^\s*/) || [""])[0].length;
        if (i === highlightLine || (cur > indent && raw.trim() !== "" && !raw.match(/^\s*-\s/))) {
          return `<span class="hl">${line}</span>`;
        }
      }
      return line;
    }).join("\n");
  }

  /* ---- 8.3 ESCALATIONS ------------------------------------------ */

  routes.escalations = async function (root) {
    const view = h("div", { class: "view" });
    root.appendChild(view);
    view.appendChild(h("div", { class: "view-head" },
      h("div", {},
        h("h1", { class: "view-title" }, "Escalations"),
        h("p", { class: "view-sub" }, "Verdicts that need a human decision. Approve to retry the action; deny to keep the block."),
      ),
      h("div", { class: "view-actions" },
        h("button", { class: "btn btn-ghost", onClick: () => loadEscalations() }, inlineSvg("refresh"), " Refresh"),
      ),
    ));

    const list = h("div", { id: "esc-list" });
    list.appendChild(h("div", { class: "sk", style: { height: "120px", borderRadius: "10px" } }));
    view.appendChild(list);

    async function loadEscalations() {
      try {
        state.escalations = await api.escalations();
        renderList();
        updateBadge();
      } catch (err) {
        list.innerHTML = "";
        list.appendChild(renderError(err).firstChild);
      }
    }

    function renderList() {
      list.innerHTML = "";
      const items = (state.escalations || []).filter((e) => inWorkspace(e.pack_id));
      if (!items.length) {
        list.appendChild(h("div", { class: "empty" },
          h("h3", {}, "Nothing pending"),
          h("p", {}, "When the gateway escalates an action, it shows up here for a human decision."),
        ));
        return;
      }
      items.forEach((e) => list.appendChild(renderEscalationCard(e, loadEscalations)));
    }

    await loadEscalations();
  };

  function renderEscalationCard(e, onChange) {
    const card = h("div", { class: "esc-card" });
    const left = h("div");
    left.appendChild(h("div", { class: "esc-meta" },
      h("span", { class: "verdict", dataset: { v: "ESCALATE" } }, "ESCALATE"),
      h("span", { class: "esc-pack" }, e.pack_id),
      h("span", {}, e.action || ""),
      h("span", { style: { color: "var(--ink-4)" } }, fmtRelTime(e.timestamp)),
    ));
    left.appendChild(h("div", { class: "esc-reason" }, e.primary_reason || ""));

    const diff = h("div", { class: "esc-diff" },
      h("div", {},
        h("div", { class: "label" }, "Current state"),
        h("pre", { style: { margin: "6px 0 0", whiteSpace: "pre-wrap" } }, JSON.stringify(e.current_state || e.ui_state || {}, null, 2).slice(0, 600)),
      ),
      h("div", {},
        h("div", { class: "label" }, "Proposed action"),
        h("pre", { style: { margin: "6px 0 0", whiteSpace: "pre-wrap" } }, JSON.stringify(e.proposed || { action: e.action }, null, 2).slice(0, 600)),
      ),
    );
    left.appendChild(diff);
    card.appendChild(left);

    const actions = h("div", { class: "esc-actions" });
    actions.appendChild(h("button", {
      class: "btn btn-primary",
      onClick: async () => {
        const c = prompt("Optional comment for the audit trail:") || "";
        try { await api.approveEscalation(e.id, c); toast("Approved · executed", "success"); onChange && onChange(); }
        catch (err) { toast(err.message, "error"); }
      },
    }, inlineSvg("check"), " Approve"));
    actions.appendChild(h("button", {
      class: "btn btn-danger",
      onClick: async () => {
        const c = prompt("Optional comment for the audit trail:") || "";
        try { await api.denyEscalation(e.id, c); toast("Denied · blocked", "warn"); onChange && onChange(); }
        catch (err) { toast(err.message, "error"); }
      },
    }, inlineSvg("x"), " Deny"));
    actions.appendChild(h("button", {
      class: "btn btn-ghost",
      onClick: () => openVerdictDrawer({
        id: e.id, timestamp: e.timestamp, pack_id: e.pack_id, action: e.action,
        phase: e.phase, verdict: "ESCALATE", primary_reason: e.primary_reason, decision: e.decision,
      }),
    }, inlineSvg("eye"), " Details"));
    card.appendChild(actions);
    return card;
  }

  /* ---- 8.4 PACKS ------------------------------------------------- */

  routes.packs = async function (root, segs, params) {
    const packId = segs[1] ? decodeURIComponent(segs[1]) : null;

    const view = h("div", { class: "view" });
    root.appendChild(view);
    view.appendChild(h("div", { class: "view-head" },
      h("div", {},
        h("h1", { class: "view-title" }, "Action Packs"),
        h("p", { class: "view-sub" }, "YAML behavioural contracts the gateway enforces. Edit a pack to change runtime policy without redeploying."),
      ),
    ));

    if (!state.packs.length) {
      try { state.packs = await api.packs(); } catch (err) {
        view.appendChild(renderError(err)); return;
      }
    }

    const grid = h("div", { class: "packs-grid" });
    view.appendChild(grid);

    const sideList = h("div", { class: "pack-list" });
    const search = h("div", { class: "pack-list-search" },
      h("input", {
        class: "input", type: "search", placeholder: "Filter packs…", value: params.q || "",
        oninput: debounce((e) => { setQuery({ q: e.target.value }, { replace: true }); renderSide(); }, 150),
      }),
    );
    sideList.appendChild(search);
    grid.appendChild(sideList);

    const detail = h("div", { class: "pack-detail-card" });
    grid.appendChild(detail);

    function renderSide() {
      $$(".pack-list-item", sideList).forEach((el) => el.remove());
      const q = (parseHash().params.q || "").toLowerCase();
      const filtered = state.packs.filter((p) => inWorkspace(p.id) && (!q || p.id.toLowerCase().includes(q) || (p.description || "").toLowerCase().includes(q)));
      filtered.forEach((p) => {
        const item = h("a", {
          class: "pack-list-item",
          href: `#/packs/${encodeURIComponent(p.id)}`,
          "aria-current": packId === p.id ? "true" : "false",
        },
          h("div", { class: "pack-list-id" }, p.id),
          h("div", { class: "pack-list-meta" }, `${p.check_count} checks · ${p.action}`),
        );
        sideList.appendChild(item);
      });
    }

    async function renderDetail() {
      detail.innerHTML = "";
      if (!packId) {
        detail.appendChild(h("div", { class: "empty" },
          h("h3", {}, "Select a pack"),
          h("p", {}, "Pick a pack from the list to view or edit the policy."),
        ));
        return;
      }
      const pack = state.packs.find((p) => p.id === packId);
      if (!pack) {
        detail.appendChild(h("div", { class: "empty" },
          h("h3", {}, "Pack not found"),
          h("p", {}, packId),
        ));
        return;
      }

      const head = h("div", { class: "pack-detail-head" },
        h("div", { style: { minWidth: 0 } },
          h("div", { class: "pack-detail-id" }, pack.id),
          h("div", { class: "pack-detail-action" }, "Action: ", h("code", {}, pack.action)),
          h("p", { class: "pack-detail-desc" }, (pack.description || "").trim()),
          h("div", { class: "pack-versions", id: "pack-versions" }, "Loading versions…"),
        ),
        h("div", { class: "view-actions" },
          h("button", { class: "btn btn-ghost", id: "btn-edit", onClick: () => toggleEdit(true) }, inlineSvg("edit"), " Edit"),
          h("button", { class: "btn btn-primary", id: "btn-save", style: { display: "none" }, onClick: save }, inlineSvg("save"), " Save"),
          h("button", { class: "btn btn-ghost", id: "btn-cancel", style: { display: "none" }, onClick: () => toggleEdit(false) }, "Cancel"),
        ),
      );
      detail.appendChild(head);

      // YAML viewer/editor
      const yamlHost = h("div", { class: "pack-yaml-host" });
      const viewerPre = h("pre", { class: "yaml-block", id: "yaml-view", style: { margin: 0, maxHeight: "520px" } });
      const editor = h("textarea", { id: "yaml-edit", spellcheck: "false", style: { display: "none" } });
      yamlHost.appendChild(viewerPre);
      yamlHost.appendChild(editor);
      detail.appendChild(yamlHost);

      let originalYaml = "";
      try {
        const res = await api.packYaml(pack.id);
        originalYaml = typeof res === "string" ? res : (res.yaml || "");
        viewerPre.innerHTML = highlightYaml(originalYaml);
        editor.value = originalYaml;
      } catch (err) {
        viewerPre.textContent = "Couldn't load YAML: " + err.message;
      }

      try {
        const versions = await api.packVersions(pack.id);
        const v = $("#pack-versions");
        v.innerHTML = "";
        v.appendChild(h("span", {}, "Versions:"));
        (versions || []).forEach((ver) => {
          v.appendChild(h("span", { class: "pack-version-tag", title: ver.timestamp || "" }, ver.label || ver.version));
        });
        if (!versions || !versions.length) v.appendChild(h("span", { class: "pack-version-tag" }, "v1 · current"));
      } catch (_) {
        const v = $("#pack-versions");
        v.innerHTML = "";
        v.appendChild(h("span", { class: "pack-version-tag" }, "v1 · current"));
      }

      // Attached scenarios + last verdict
      const sScenarios = (state.scenarios || []).filter((s) => s.pack_id === pack.id);
      if (sScenarios.length) {
        const scWrap = h("div", { class: "pack-scenarios" });
        scWrap.appendChild(h("h4", {}, "Regression scenarios"));
        sScenarios.forEach((s) => {
          const row = h("div", { class: "pack-scenario-row" },
            h("div", { class: "name" }, s.id),
            h("span", { class: "verdict", dataset: { v: s.expected_verdict || "—" } }, "expects ", s.expected_verdict || "—"),
            h("button", {
              class: "btn btn-sm", onClick: async () => {
                row.dataset.running = "true";
                try {
                  const r = await api.runScenario(s.id, "engine");
                  const matched = r.decision.verdict === s.expected_verdict;
                  toast(`${s.id} · ${r.decision.verdict} ${matched ? "(match)" : "(differs)"}`, matched ? "success" : "warn");
                  if (state._loadLive) await state._loadLive();
                } catch (err) { toast(err.message, "error"); }
                delete row.dataset.running;
              },
            }, inlineSvg("play"), " Run"),
          );
          scWrap.appendChild(row);
        });
        detail.appendChild(scWrap);
      }

      function toggleEdit(on) {
        viewerPre.style.display = on ? "none" : "block";
        editor.style.display = on ? "block" : "none";
        $("#btn-edit").style.display = on ? "none" : "";
        $("#btn-save").style.display = on ? "" : "none";
        $("#btn-cancel").style.display = on ? "" : "none";
        if (!on) editor.value = originalYaml;
        else editor.focus();
      }

      async function save() {
        const newYaml = editor.value;
        if (newYaml === originalYaml) {
          toast("No changes to save.");
          toggleEdit(false);
          return;
        }
        try {
          await api.savePack(pack.id, newYaml);
          originalYaml = newYaml;
          viewerPre.innerHTML = highlightYaml(newYaml);
          toggleEdit(false);
          toast("Pack saved · live now.", "success");
          // Refresh versions
          api.packVersions(pack.id).then((versions) => {
            const v = $("#pack-versions");
            v.innerHTML = "";
            v.appendChild(h("span", {}, "Versions:"));
            (versions || []).forEach((ver) => v.appendChild(h("span", { class: "pack-version-tag" }, ver.label || ver.version)));
          }).catch(() => {});
        } catch (err) {
          toast("Save failed: " + err.message, "error");
        }
      }

      // Auto-run from palette ?run=
      const runId = parseHash().params.run;
      if (runId) {
        const s = sScenarios.find((x) => x.id === runId);
        if (s) {
          api.runScenario(s.id, "engine").then((r) => {
            toast(`${s.id} · ${r.decision.verdict}`);
            if (state._loadLive) state._loadLive();
          }).catch((err) => toast(err.message, "error"));
          setQuery({ run: null }, { replace: true });
        }
      }
    }

    renderSide();
    await renderDetail();
  };

  /* ---- 8.5 AUDIT LEDGER ----------------------------------------- */

  routes.audit = async function (root, _segs, params) {
    const view = h("div", { class: "view view-wide" });
    root.appendChild(view);

    view.appendChild(h("div", { class: "view-head" },
      h("div", {},
        h("h1", { class: "view-title" }, "Audit Ledger"),
        h("p", { class: "view-sub" }, "Immutable record of every decision the gateway has made. Filterable, exportable, shareable by URL."),
      ),
      h("div", { class: "view-actions" },
        h("a", { class: "btn", id: "export-btn", href: "#", download: "coco-audit.csv" }, inlineSvg("download"), " Export CSV"),
        h("button", { class: "btn btn-ghost", onClick: () => loadAudit() }, inlineSvg("refresh"), " Refresh"),
      ),
    ));

    const fb = h("div", { class: "filterbar" });
    const qInput = h("input", { class: "input", type: "search", placeholder: "Search reason text…", value: params.q || "",
      oninput: debounce((e) => { setQuery({ q: e.target.value }, { replace: true }); loadAudit(); }, 250),
    });
    fb.appendChild(qInput);

    const packSel = h("select", { class: "select", style: { width: "auto", maxWidth: 220 } });
    packSel.appendChild(h("option", { value: "" }, "All packs"));
    (state.packs || []).filter((p) => inWorkspace(p.id)).forEach((p) => packSel.appendChild(h("option", { value: p.id }, p.id)));
    packSel.value = params.pack || "";
    packSel.addEventListener("change", (e) => { setQuery({ pack: e.target.value }, { replace: true }); loadAudit(); });
    fb.appendChild(packSel);

    const verdictChips = h("div", { class: "chips" });
    ["ALLOW", "BLOCK", "ESCALATE"].forEach((v) => {
      const pressed = (params.v || "").split(",").includes(v);
      verdictChips.appendChild(h("button", {
        class: "chip", "aria-pressed": pressed ? "true" : "false", dataset: { v },
        onClick: () => {
          const cur = (parseHash().params.v || "").split(",").filter(Boolean);
          const i = cur.indexOf(v);
          if (i >= 0) cur.splice(i, 1); else cur.push(v);
          setQuery({ v: cur.join(",") }, { replace: true });
          loadAudit();
        },
      }, v));
    });
    fb.appendChild(verdictChips);

    const fromInput = h("input", { class: "input", type: "date", style: { width: 150 }, value: params.from || "",
      onchange: (e) => { setQuery({ from: e.target.value }, { replace: true }); loadAudit(); } });
    const toInput = h("input", { class: "input", type: "date", style: { width: 150 }, value: params.to || "",
      onchange: (e) => { setQuery({ to: e.target.value }, { replace: true }); loadAudit(); } });
    fb.appendChild(h("span", { style: { fontSize: "var(--fs-12)", color: "var(--ink-3)" } }, "from"));
    fb.appendChild(fromInput);
    fb.appendChild(h("span", { style: { fontSize: "var(--fs-12)", color: "var(--ink-3)" } }, "to"));
    fb.appendChild(toInput);
    view.appendChild(fb);

    const wrap = h("div", { class: "table-wrap" });
    const table = h("table", { class: "t" },
      h("thead", {}, h("tr", {},
        h("th", {}, "Time"),
        h("th", {}, "Pack"),
        h("th", {}, "Action"),
        h("th", {}, "Phase"),
        h("th", {}, "Verdict"),
        h("th", {}, "Primary reason"),
      )),
      h("tbody", { id: "audit-body" }, h("tr", {}, h("td", { colspan: 6 }, "Loading…"))),
    );
    wrap.appendChild(table);
    view.appendChild(wrap);

    const meta = h("div", { style: { marginTop: "var(--s-3)", fontSize: "var(--fs-12)", color: "var(--ink-3)" }, id: "audit-meta" }, "");
    view.appendChild(meta);

    async function loadAudit() {
      const p = parseHash().params;
      $("#export-btn").href = api.auditExportUrl(p);
      try {
        const rows = await api.auditSearch(p);
        renderRows(rows);
      } catch (err) {
        // Fallback: client-side filter on /api/audit
        const rows = await api.audit(500);
        const filtered = rows.filter((r) => {
          const vs = (p.v || "").split(",").filter(Boolean);
          if (vs.length && !vs.includes(r.verdict)) return false;
          if (p.pack && r.pack_id !== p.pack) return false;
          if (p.q && !(r.primary_reason || "").toLowerCase().includes(p.q.toLowerCase())) return false;
          if (p.from && r.timestamp < p.from) return false;
          if (p.to && r.timestamp > p.to + "T23:59:59Z") return false;
          return true;
        });
        renderRows(filtered);
      }
    }

    function renderRows(rows) {
      rows = (rows || []).filter((r) => inWorkspace(r.pack_id));
      const body = $("#audit-body");
      body.innerHTML = "";
      if (!rows.length) {
        body.appendChild(h("tr", {}, h("td", { colspan: 6 }, h("div", { class: "empty" },
          h("h3", {}, "No matching rows"),
          h("p", {}, "Loosen the filters or clear them."),
        ))));
        meta.textContent = "";
        return;
      }
      rows.forEach((r) => {
        body.appendChild(h("tr", {
          onClick: () => openVerdictDrawer(r),
          dataset: { id: r.id },
        },
          h("td", { class: "ui" }, fmtRelTime(r.timestamp)),
          h("td", {}, r.pack_id),
          h("td", { class: "ui" }, r.action),
          h("td", {}, r.phase),
          h("td", { class: "ui" }, h("span", { class: "verdict", dataset: { v: r.verdict } }, r.verdict)),
          h("td", { class: "ui" }, r.primary_reason || ""),
        ));
      });
      const packs = new Set(rows.map((r) => r.pack_id));
      meta.textContent = `${rows.length.toLocaleString()} rows · ${packs.size} packs`;

      // Deep-link: ?id=N opens drawer
      const focusId = parseHash().params.id;
      if (focusId) {
        const r = rows.find((x) => String(x.id) === String(focusId));
        if (r) openVerdictDrawer(r);
      }
    }

    await loadAudit();
  };

  /* ---- 8.6 INTEGRATIONS ----------------------------------------- */

  routes.integrations = async function (root) {
    const view = h("div", { class: "view" });
    root.appendChild(view);
    view.appendChild(h("div", { class: "view-head" },
      h("div", {},
        h("h1", { class: "view-title" }, "Integrations"),
        h("p", { class: "view-sub" }, "Connect the SaaS apps you want governed, install the SDK, and Coco starts watching."),
      ),
      h("div", { class: "view-actions" },
        h("a", { class: "btn btn-primary", href: "/sandbox/twenty", target: "_blank" },
          inlineSvg("play"), " Try the overlay"),
      ),
    ));

    const origin = location.origin;
    const sdkSnippet = `<script src="${origin}/sdk/coco-sdk.js"></script>\n<script src="${origin}/sdk/inject.js" data-gateway="${origin}"></script>`;
    const bookmarkletJs = `javascript:(function(){var s=document.createElement('script');s.src='${origin}/sdk/coco-sdk.js?b='+Date.now();document.body.appendChild(s);var t=document.createElement('script');t.src='${origin}/sdk/inject.js?b='+Date.now();t.dataset.gateway='${origin}';document.body.appendChild(t);})();`;

    const grid = h("div", { class: "integration-grid" });
    view.appendChild(grid);

    // --- Twenty card ---
    const twenty = h("div", { class: "card integration-card" });
    twenty.appendChild(h("div", { class: "head" },
      h("div", { class: "name" }, "Twenty CRM"),
      h("span", { class: "status", id: "twenty-status", "data-on": "false" }, "Checking…"),
    ));
    twenty.appendChild(h("p", { style: { color: "var(--ink-2)", margin: 0, fontSize: "var(--fs-13)" } },
      "Open-source CRM. Coco governs deal moves, contact deletes, bulk email, opportunities, and field updates."));

    const twentyForm = h("div", { style: { display: "flex", flexDirection: "column", gap: "var(--s-2)" } });
    twentyForm.appendChild(h("label", { style: { fontSize: "var(--fs-12)", color: "var(--ink-3)" } }, "Base URL"));
    twentyForm.appendChild(h("input", { class: "input input-mono", id: "twenty-base", placeholder: "http://localhost:3000", value: localStorage.getItem("coco.twenty.base") || "http://localhost:3000" }));
    twentyForm.appendChild(h("label", { style: { fontSize: "var(--fs-12)", color: "var(--ink-3)" } }, "API key"));
    twentyForm.appendChild(h("input", { class: "input input-mono", id: "twenty-key", placeholder: "eyJhbGciOi…", type: "password", value: localStorage.getItem("coco.twenty.key") || "" }));
    twentyForm.appendChild(h("div", { style: { display: "flex", gap: "var(--s-2)" } },
      h("button", { class: "btn", onClick: testTwenty }, inlineSvg("check"), " Test connection"),
      h("button", { class: "btn btn-ghost", onClick: () => { localStorage.setItem("coco.twenty.base", $("#twenty-base").value); localStorage.setItem("coco.twenty.key", $("#twenty-key").value); toast("Saved locally."); } }, inlineSvg("save"), " Save"),
    ));
    twenty.appendChild(twentyForm);
    grid.appendChild(twenty);

    async function testTwenty() {
      const status = $("#twenty-status");
      status.textContent = "Testing…"; status.dataset.on = "false";
      const base = $("#twenty-base").value.replace(/\/$/, "");
      const key  = $("#twenty-key").value;
      if (!base || !key) { status.textContent = "Missing creds"; return; }
      try {
        const r = await fetch(`${base}/rest/companies?limit=1`, { headers: { Authorization: "Bearer " + key } });
        if (r.ok) { status.textContent = "Connected"; status.dataset.on = "true"; toast("Twenty reachable.", "success"); }
        else { status.textContent = `HTTP ${r.status}`; toast(`Twenty returned ${r.status}`, "error"); }
      } catch (err) { status.textContent = "Unreachable"; toast(err.message, "error"); }
    }

    // Initial status check
    const sBase = $("#twenty-base").value; const sKey = $("#twenty-key").value;
    if (sBase && sKey) testTwenty();
    else $("#twenty-status").textContent = "Not configured";

    // --- SDK install card ---
    const sdk = h("div", { class: "card integration-card" });
    sdk.appendChild(h("div", { class: "head" },
      h("div", { class: "name" }, "JavaScript SDK"),
      h("span", { class: "status", "data-on": "true" }, "Available"),
    ));
    sdk.appendChild(h("p", { style: { color: "var(--ink-2)", margin: 0, fontSize: "var(--fs-13)" } },
      "Drop this snippet into your SaaS frontend. Every governed action then asks Coco first."));
    const code = h("div", { class: "code-block" });
    code.textContent = sdkSnippet;
    code.appendChild(h("button", { class: "copy", onClick: () => copyToClipboard(sdkSnippet).then(() => toast("Snippet copied.", "success")) }, "copy"));
    sdk.appendChild(code);

    const bookmarkletWrap = h("div", { style: { marginTop: "var(--s-2)", display: "flex", alignItems: "center", gap: "var(--s-3)", flexWrap: "wrap" } });
    const blink = document.createElement("a");
    blink.className = "bookmarklet-pill";
    blink.href = bookmarkletJs;
    blink.textContent = "🐈‍⬛ Coco · drag me";
    blink.addEventListener("click", (e) => e.preventDefault());
    bookmarkletWrap.appendChild(blink);
    bookmarkletWrap.appendChild(h("span", { style: { fontSize: "var(--fs-12)", color: "var(--ink-3)", flex: "1", minWidth: "200px" } },
      "Drag to your bookmarks bar. Click while on Twenty to inject the SDK without redeploying."));
    sdk.appendChild(bookmarkletWrap);

    const sandboxNote = h("div", {
      style: {
        marginTop: "var(--s-3)",
        padding: "10px 12px",
        background: "var(--accent-soft)",
        border: "1px solid var(--accent-line)",
        borderRadius: "var(--r-md)",
        fontSize: "var(--fs-12)",
        color: "var(--accent-ink)",
        display: "flex",
        alignItems: "center",
        gap: "var(--s-2)",
      },
    },
      h("strong", {}, "No Twenty handy?"),
      " Open the ",
      h("a", { href: "/sandbox/twenty", target: "_blank", style: { color: "var(--accent-ink)", textDecoration: "underline", fontWeight: 600 } }, "built-in sandbox"),
      " to try the overlay — same SDK, same gateway, same verdicts.",
    );
    sdk.appendChild(sandboxNote);
    grid.appendChild(sdk);

    // --- Gateway card ---
    const gw = h("div", { class: "card integration-card" });
    gw.appendChild(h("div", { class: "head" },
      h("div", { class: "name" }, "Coco Gateway"),
      h("span", { class: "status", "data-on": "true" }, state.health && state.health.status === "ok" ? "Healthy" : "Unknown"),
    ));
    gw.appendChild(h("p", { style: { color: "var(--ink-2)", margin: 0, fontSize: "var(--fs-13)" } },
      "FastAPI service running at " + origin + ". 5 packs loaded, SQLite audit log under data/runtime/audit.db."));
    gw.appendChild(h("div", { style: { fontFamily: "var(--font-mono)", fontSize: "var(--fs-11)", color: "var(--ink-3)" } },
      "Endpoints: /api/validate · /api/packs · /api/scenarios · /api/audit · /api/metrics/live · /api/escalations"));
    grid.appendChild(gw);
  };

  /* ---- 8.7 SETTINGS --------------------------------------------- */

  routes.settings = async function (root) {
    const view = h("div", { class: "view" });
    root.appendChild(view);
    view.appendChild(h("div", { class: "view-head" },
      h("div", {},
        h("h1", { class: "view-title" }, "Settings"),
        h("p", { class: "view-sub" }, "Workspace, environment, audit retention. Persisted to local storage for now; production-grade settings land in the backend later."),
      ),
    ));

    const card = h("div", { class: "card" });
    const body = h("div", { class: "card-body" });
    const get = (k, d) => localStorage.getItem("coco.settings." + k) || d;
    const set = (k, v) => localStorage.setItem("coco.settings." + k, v);

    function field(label, key, type = "text", placeholder = "") {
      const id = "f-" + key;
      return h("div", { style: { marginBottom: "var(--s-4)" } },
        h("label", { for: id, style: { display: "block", fontSize: "var(--fs-12)", color: "var(--ink-3)", marginBottom: 4 } }, label),
        h("input", { class: "input", id, type, placeholder, value: get(key, ""),
          onchange: (e) => { set(key, e.target.value); toast("Saved.", "success"); },
        }),
      );
    }

    body.appendChild(field("Workspace name", "workspace_name", "text", "Acme Corp"));
    body.appendChild(field("Environment", "environment", "text", "development / staging / production"));
    body.appendChild(field("Audit retention (days)", "retention_days", "number", "365"));
    body.appendChild(field("Operator email (for escalation alerts)", "operator_email", "email", "ops@acme.com"));

    card.appendChild(body);
    view.appendChild(card);
  };

  /* ---- 8.8 ONBOARDING (first-run cue) -------------------------- */

  routes.onboarding = async function (root) {
    const view = h("div", { class: "view" });
    root.appendChild(view);
    view.appendChild(h("div", { class: "view-head" },
      h("div", {},
        h("h1", { class: "view-title" }, "Welcome to Coco"),
        h("p", { class: "view-sub" }, "Four steps to governed AI actions. Takes about five minutes."),
      ),
    ));

    const wrap = h("div", { class: "onboarding" });
    const steps = [
      { num: 1, title: "Gateway is up", body: "Your Coco gateway is running and ready. 5 default Twenty CRM packs are loaded.", done: true },
      { num: 2, title: "Connect Twenty CRM", body: "Paste your Twenty base URL and API key on the Integrations page so the gateway can read live state.", done: !!localStorage.getItem("coco.twenty.key") },
      { num: 3, title: "Install the SDK in Twenty", body: "Drag the Coco bookmarklet into your bookmarks bar, then click it while on Twenty. Or paste the script tag into a production deployment.", done: false },
      { num: 4, title: "Watch the first verdict", body: "Take any governed action in Twenty. The verdict streams into Live. Done.", done: state.audit && state.audit.length > 0 },
    ];

    const activeIdx = steps.findIndex((s) => !s.done);
    steps.forEach((s, i) => {
      wrap.appendChild(h("div", { class: "onboarding-step", dataset: { done: s.done ? "true" : "false", active: i === activeIdx ? "true" : "false" } },
        h("div", { class: "onboarding-num" }, s.done ? "✓" : String(s.num)),
        h("div", {},
          h("h3", { class: "onboarding-title" }, s.title),
          h("p", { class: "onboarding-body" }, s.body),
          i === 1 ? h("a", { class: "btn", href: "#/integrations" }, "Open Integrations ", inlineSvg("arrow_right")) : null,
          i === 2 ? h("a", { class: "btn", href: "#/integrations" }, "Get the bookmarklet ", inlineSvg("arrow_right")) : null,
          i === 3 ? h("a", { class: "btn", href: "#/live" }, "Open Live ", inlineSvg("arrow_right")) : null,
        ),
      ));
    });

    view.appendChild(wrap);
  };

  /* ---- 8.9 AGENT BANKING (pipeline demo) ----------------------- */

  routes.banking = async function (root) {
    const SCENARIOS = [
      { id: "payroll", label: "Run payroll", agentIntent: "Pay the fortnightly payroll batch to PayCycle.",
        accountId: "operating-au-001", accountLabel: "Operating Account", payee: "PayCycle Payroll Pty Ltd", amount: 5000, currency: "USD" },
      { id: "sanctioned-wire", label: "Wire $2M to a flagged entity", agentIntent: "Wire 2,000,000 to Hint Global Trading FZE.",
        accountId: "treasury-002", accountLabel: "Treasury Account", payee: "Hint Global Trading FZE", amount: 2000000, currency: "USD" },
      { id: "vendor-settlement", label: "Settle a $250k invoice", agentIntent: "Settle the quarterly logistics invoice with Meridian.",
        accountId: "payments-003", accountLabel: "Payments Account", payee: "Meridian Logistics Ltd", amount: 250000, currency: "USD" },
    ];

    // Five of the six layers are illustrative: we name the vendors that work
    // at each layer but do not call them. Only stage four runs live.
    const STAGES = [
      { n: 1, key: "discovery", title: "Discovery", role: "The agent finds the tools and other agents it can use.", vendors: ["MCP", "A2A", "OBP-MCP"] },
      { n: 2, key: "authentication", title: "Authentication", role: "The bank verifies which agent is calling, not the human who deployed it.", vendors: ["Visa Trusted Agent Protocol"] },
      { n: 3, key: "authorisation", title: "Authorisation", role: "The agent is cleared to initiate transfers.", vendors: ["Mastercard Verifiable Intent", "PayPal ACP"] },
      { n: 4, key: "enforcement", title: "Runtime enforcement", role: "Coco reads the live account state and rules on the action before it executes.", vendors: ["Coco"], coco: true },
      { n: 5, key: "detection", title: "Detection", role: "Behavioural monitors watch the action stream for anomalies.", vendors: ["Darwinium", "SEON", "Hawk"] },
      { n: 6, key: "investigation", title: "Investigation", role: "Forensics reconstruct what happened for compliance.", vendors: ["Unit21", "Chainalysis", "TRM Labs"] },
    ];

    const CHECK_LABELS = {
      account_active: "Source account active",
      no_sanctions_hold: "No sanctions hold",
      payee_approved: "Payee is an approved beneficiary",
      amount_within_auto_limit: "Within the auto-approve limit",
    };

    // Stages 1 to 3 clear the transfer in every scenario: none of them can
    // see the hold. Stages 5 and 6 read differently per verdict.
    function stageOutcome(key, verdict, auditId) {
      const audit = auditId ? `#${auditId}` : "pending";
      switch (key) {
        case "discovery":      return "Tools and agents resolved. The transfer endpoint is available.";
        case "authentication": return "Agent identity verified. Known agent, valid credential.";
        case "authorisation":  return "Agent is permitted to initiate transfers. Cleared to proceed.";
        case "detection":
          if (verdict === "BLOCK") return "Nothing to flag. Coco stopped the transfer before it reached the stream.";
          if (verdict === "ESCALATE") return "Held alongside Coco's review. No independent anomaly.";
          return "Nominal. The transfer matches the account's pattern.";
        case "investigation":
          if (verdict === "BLOCK") return `Audit row ${audit} records the block and the rule that fired.`;
          if (verdict === "ESCALATE") return `Audit row ${audit} opened for the approver.`;
          return `Logged to audit row ${audit}. Full trail available.`;
        default: return "";
      }
    }

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const money = (amt, cur) => new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(amt);
    const bkMeta = (s) => `${s.accountLabel} · ${money(s.amount, s.currency)} → ${s.payee}`;

    let running = false;
    let selected = SCENARIOS[0];

    const view = h("div", { class: "view" });
    root.appendChild(view);
    view.appendChild(h("div", { class: "view-head" },
      h("div", {},
        h("h1", { class: "view-title" }, "Agent Banking"),
        h("p", { class: "view-sub" }, "An AI agent moves money through six layers of the agent-banking trust stack. Coco is stage four: it reads the live account state and rules allow, block or escalate before the money moves."),
      ),
    ));

    const chipRow = h("div", { class: "bk-chips" });
    const intentLine = h("p", { class: "bk-intent" }, selected.agentIntent);
    const metaLine = h("p", { class: "bk-meta" }, bkMeta(selected));
    const errLine = h("p", { class: "bk-error", style: { display: "none" } });
    const runBtn = h("button", { class: "btn btn-primary bk-run", onClick: () => run() }, "Initiate transfer");

    function refreshChips() {
      chipRow.innerHTML = "";
      SCENARIOS.forEach((s) => {
        chipRow.appendChild(h("button", {
          class: "chip", "aria-pressed": s.id === selected.id ? "true" : "false",
          onClick: () => {
            if (running) return;
            selected = s;
            intentLine.textContent = s.agentIntent;
            metaLine.textContent = bkMeta(s);
            errLine.style.display = "none";
            refreshChips();
            buildRail();
          },
        }, s.label));
      });
    }
    refreshChips();

    view.appendChild(h("div", { class: "card" },
      h("div", { class: "card-body" },
        h("div", { class: "bk-control-label" }, "The agent wants to"),
        chipRow, intentLine, metaLine, runBtn, errLine,
      ),
    ));

    const rail = h("div", { class: "bk-rail" });
    view.appendChild(rail);

    view.appendChild(h("p", { class: "bk-foot" },
      "Stage four runs live against the gateway and writes a real audit row. The other five layers are illustrative: the demo names the vendors that work at each layer but does not call them. The bank is a mock of the Open Bank Project v5.1.0 API, so the account read returns a clean account while the sanctions hold sits in account attributes the read never returns."));

    let stageEls = [];
    function buildRail() {
      rail.innerHTML = "";
      stageEls = STAGES.map((stage) => {
        const dot = h("span", { class: "bk-dot" });
        const outcome = h("p", { class: "bk-outcome" });
        const panelHost = h("div", {});
        const card = h("div", { class: "bk-stage", dataset: { status: "pending", coco: stage.coco ? "true" : "false" } },
          h("span", { class: "bk-num" }, String(stage.n)),
          h("div", { class: "bk-stage-main" },
            h("div", { class: "bk-stage-head" },
              h("h3", { class: "bk-stage-title" }, stage.title),
              dot,
            ),
            h("p", { class: "bk-role" }, stage.role),
            h("div", { class: "bk-vendors" }, ...stage.vendors.map((v) =>
              h("span", { class: "bk-vendor", dataset: { coco: stage.coco ? "true" : "false" },
                title: stage.coco ? "" : "Illustrative. The demo does not call this vendor." }, v))),
            outcome, panelHost,
          ),
        );
        rail.appendChild(card);
        return { stage, card, dot, outcome, panelHost };
      });
    }
    buildRail();

    function applyStep(step, decision) {
      stageEls.forEach((el, i) => {
        const status = step > i ? "done" : step === i ? "active" : "pending";
        el.card.dataset.status = status;
        if (el.stage.coco) {
          el.card.dataset.verdict = decision ? decision.verdict : "";
          el.panelHost.innerHTML = "";
          if (decision && step >= i) el.panelHost.appendChild(renderStage4Panel(decision));
        } else {
          el.outcome.textContent = status === "done"
            ? stageOutcome(el.stage.key, decision ? decision.verdict : "ALLOW", decision ? decision.audit_id : null)
            : "";
        }
      });
    }

    function renderStage4Panel(d) {
      const balance = Number(d.account_view.balance.amount);
      const obpCard = h("div", { class: "bk-panel-card" },
        h("p", { class: "bk-panel-label" }, "OBP transaction API"),
        h("p", { class: "bk-balance" }, money(balance, d.account_view.balance.currency)),
        h("p", { class: "bk-sub" }, `${d.account_view.label} · available`),
        h("div", { class: "bk-obp-status" }, h("span", { class: "bk-obp-dot" }), d.obp_view.status),
        h("p", { class: "bk-note" }, d.obp_view.note),
      );
      const checksCard = h("div", { class: "bk-panel-card", dataset: { v: d.verdict } },
        h("p", { class: "bk-panel-label" }, "Live account state Coco read"),
        h("div", { class: "bk-checks" }, ...d.checks.map((c) =>
          h("div", { class: "bk-check" },
            h("span", { class: c.passed ? "bk-check-label" : "bk-check-label bk-fail" }, CHECK_LABELS[c.check_id] || c.check_id),
            h("span", { class: c.passed ? "bk-check-flag" : "bk-check-flag bk-fail" }, c.passed ? "pass" : "fail"),
          ))),
      );
      const banner = h("div", { class: "bk-verdict-banner", dataset: { v: d.verdict } },
        h("span", { class: "verdict verdict-lg", "data-v": d.verdict }, d.verdict),
        h("span", { class: "bk-reason" }, d.primary_reason),
      );
      const ts = new Date(d.timestamp);
      const tstr = Number.isNaN(ts.getTime()) ? d.timestamp : ts.toLocaleTimeString();
      const audit = h("p", { class: "bk-audit" }, `audit #${d.audit_id != null ? d.audit_id : "—"} · ${tstr} · pack banking.wire_transfer`);
      return h("div", { class: "bk-panel" }, h("div", { class: "bk-panel-grid" }, obpCard, checksCard), banner, audit);
    }

    async function run() {
      if (running) return;
      running = true;
      runBtn.disabled = true;
      errLine.style.display = "none";
      buildRail();
      applyStep(0, null);

      let decision;
      try {
        decision = await api.fetchJson("/api/demo/bank_transfer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account_id: selected.accountId, payee: selected.payee, amount: selected.amount, currency: selected.currency }),
        });
      } catch (e) {
        errLine.textContent = e && e.message ? e.message : "Cannot reach the gateway.";
        errLine.style.display = "";
        running = false;
        runBtn.disabled = false;
        return;
      }

      for (let i = 0; i <= STAGES.length; i++) {
        applyStep(i, decision);
        await sleep(i === 3 ? 950 : 650);
      }
      running = false;
      runBtn.disabled = false;
    }
  };

  /* ---- 8.10 AGENT ACTIONS (other governed banking actions) ------- */

  routes.actions = async function (root) {
    // The wire transfer is the hero pipeline. These are the other actions an
    // agent takes against the bank. Each runs live against the gateway and
    // writes a real audit row, the same engine the pipeline uses.
    const ACTIONS = [
      {
        key: "add_beneficiary",
        title: "Add a beneficiary",
        endpoint: "/api/demo/add_beneficiary",
        sub: "Before an agent can pay a new party it has to add it. Coco screens the payee against sanctions and jurisdiction rules first, because a new beneficiary is the usual first step in a payment-fraud sequence.",
        labels: { account_active: "Source account active", screening_cleared: "Cleared sanctions and name screening", jurisdiction_allowed: "Jurisdiction is permitted", known_or_low_risk: "Known or low-risk payee" },
        scenarios: [
          { id: "clean", label: "Add a screened AU supplier", intent: "Add Brightwave Studios as a payee.", body: { account_id: "operating-au-001", counterparty_id: "brightwave-au" } },
          { id: "sanctioned", label: "Add a sanctioned-jurisdiction entity", intent: "Add Sterling Offshore Holdings as a payee.", body: { account_id: "operating-au-001", counterparty_id: "sterling-offshore" } },
          { id: "first-time", label: "Add a first-time payee in a monitored region", intent: "Add Kepler Trading FZE as a payee.", body: { account_id: "operating-au-001", counterparty_id: "kepler-fze" } },
        ],
      },
      {
        key: "card_controls",
        title: "Change a card limit",
        endpoint: "/api/demo/card_limit",
        sub: "The agent raises a corporate card's spending limit. A card reported lost is blocked outright, and a rise above the programme ceiling is held for a manager.",
        labels: { card_active: "Card is active", card_not_reported: "Card not reported lost", limit_within_ceiling: "Within the limit ceiling" },
        scenarios: [
          { id: "ok", label: "Raise the Operations card to 20,000", intent: "Raise the Operations Visa limit to 20,000.", body: { card_id: "card-ops-01", requested_limit: 20000 } },
          { id: "lost", label: "Change a card reported lost", intent: "Raise the Travel Mastercard limit to 10,000.", body: { card_id: "card-travel-09", requested_limit: 10000 } },
          { id: "high", label: "Raise a card to 250,000", intent: "Raise the Executive Visa limit to 250,000.", body: { card_id: "card-exec-02", requested_limit: 250000 } },
        ],
      },
      {
        key: "data_export",
        title: "Export customer records",
        endpoint: "/api/demo/data_export",
        sub: "The agent pulls customer records. Every export needs a stated business purpose, and a bulk or cross-border pull is held for a data-protection review.",
        labels: { exports_enabled: "Dataset allows export", purpose_declared: "Business purpose declared", volume_within_limit: "Volume within the auto limit", domestic_only: "Domestic export" },
        scenarios: [
          { id: "ok", label: "Export 200 contacts with a purpose", intent: "Export 200 CRM contacts for the Q3 campaign.", body: { dataset_id: "crm-contacts", purpose_declared: true, record_count: 200, cross_border: false } },
          { id: "no-purpose", label: "Export with no stated purpose", intent: "Export 200 CRM contacts.", body: { dataset_id: "crm-contacts", purpose_declared: false, record_count: 200, cross_border: false } },
          { id: "bulk", label: "Export 12,000 records", intent: "Export 12,000 CRM contacts for analysis.", body: { dataset_id: "crm-contacts", purpose_declared: true, record_count: 12000, cross_border: false } },
        ],
      },
    ];

    function renderResult(d, labels) {
      const banner = h("div", { class: "bk-verdict-banner", dataset: { v: d.verdict } },
        h("span", { class: "verdict verdict-lg", "data-v": d.verdict }, d.verdict),
        h("span", { class: "bk-reason" }, d.primary_reason),
      );
      const checks = h("div", { class: "bk-checks" }, ...(d.checks || []).map((c) =>
        h("div", { class: "bk-check" },
          h("span", { class: c.passed ? "bk-check-label" : "bk-check-label bk-fail" }, labels[c.check_id] || c.check_id),
          h("span", { class: c.passed ? "bk-check-flag" : "bk-check-flag bk-fail" }, c.passed ? "pass" : "fail"),
        )));
      const ts = new Date(d.timestamp);
      const tstr = Number.isNaN(ts.getTime()) ? d.timestamp : ts.toLocaleTimeString();
      const line = `audit #${d.audit_id != null ? d.audit_id : "—"} · ${tstr} · ${d.pack_id}`;
      const audit = d.audit_id != null
        ? h("a", { class: "bk-audit", href: `#/audit?id=${d.audit_id}` }, line)
        : h("p", { class: "bk-audit" }, line);
      return h("div", { class: "bk-action-result" }, banner, checks, audit);
    }

    const view = h("div", { class: "view" });
    root.appendChild(view);
    view.appendChild(h("div", { class: "view-head" },
      h("div", {},
        h("h1", { class: "view-title" }, "Agent actions"),
        h("p", { class: "view-sub" }, "Coco governs more than wires. Pick what the agent tries below: the gateway reads the live record and rules allow, block or escalate before it executes, then writes the verdict to the audit ledger."),
      ),
    ));

    ACTIONS.forEach((a) => {
      let selected = a.scenarios[0];
      let running = false;
      const chipRow = h("div", { class: "bk-chips" });
      const intentLine = h("p", { class: "bk-intent" }, selected.intent);
      const errLine = h("p", { class: "bk-error", style: { display: "none" } });
      const resultHost = h("div", {});
      const runBtn = h("button", { class: "btn btn-primary bk-run", onClick: () => run() }, "Run check");

      function refreshChips() {
        chipRow.innerHTML = "";
        a.scenarios.forEach((s) => chipRow.appendChild(h("button", {
          class: "chip", "aria-pressed": s.id === selected.id ? "true" : "false",
          onClick: () => {
            if (running) return;
            selected = s;
            intentLine.textContent = s.intent;
            errLine.style.display = "none";
            resultHost.innerHTML = "";
            refreshChips();
          },
        }, s.label)));
      }
      refreshChips();

      async function run() {
        if (running) return;
        running = true;
        runBtn.disabled = true;
        errLine.style.display = "none";
        resultHost.innerHTML = "";
        try {
          const d = await api.fetchJson(a.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(selected.body),
          });
          resultHost.appendChild(renderResult(d, a.labels));
          refreshEscalationBadge();
        } catch (e) {
          errLine.textContent = e && e.message ? e.message : "Cannot reach the gateway.";
          errLine.style.display = "";
        } finally {
          running = false;
          runBtn.disabled = false;
        }
      }

      view.appendChild(h("div", { class: "card" },
        h("div", { class: "card-body" },
          h("h3", { class: "bk-action-title" }, a.title),
          h("p", { class: "view-sub" }, a.sub),
          h("div", { class: "bk-control-label" }, "The agent wants to"),
          chipRow, intentLine, runBtn, errLine, resultHost,
        ),
      ));
    });

    view.appendChild(h("p", { class: "bk-foot" },
      "Each action runs live against the gateway on its own pack and writes a real audit row. The bank is a mock of the Open Bank Project v5.1.0 API: the screening result, card status and export policy live in the record, not in the request the agent submits."));
  };

  /* ---- 8.11 SECURITIES LENDING (loan-booking pipeline) ----------- */

  routes.seclend = async function (root) {
    // The hero shows one loan booking moving through its lifecycle. The
    // booking API accepts the request at every scenario; Coco reads the live
    // blotter and rules on it before it commits. `withoutCoco` is the failure
    // that lands later, in reconciliation, when nothing stops the booking.
    const SCENARIOS = [
      { id: "routine", label: "Book a routine loan", verdictHint: "ALLOW",
        intent: "Lend 10,000 Apple shares to Citadel Securities.",
        body: { security_id: "AAPL", counterparty_id: "citadel-sec", quantity: 10000 },
        withoutCoco: "Books cleanly. There is nothing to catch, and Coco stays out of the way." },
      { id: "cap", label: "Book past the borrower's cap", verdictHint: "BLOCK",
        intent: "Lend 10,000 Apple shares to Jane Street.",
        body: { security_id: "AAPL", counterparty_id: "jane-street", quantity: 10000 },
        withoutCoco: "The booking API accepts it. The loan commits and pushes Jane Street past its exposure cap. The breach surfaces next morning in reconciliation, as a limit the desk has to unwind and report." },
      { id: "inventory", label: "Book more than is on the shelf", verdictHint: "BLOCK",
        intent: "Lend 20,000 GameStop shares to Meridian.",
        body: { security_id: "GME", counterparty_id: "meridian-bd", quantity: 20000 },
        withoutCoco: "The booking API accepts it. With only 12,000 on the shelf the loan oversells inventory and ends in a settlement fail at T+2, with buy-in costs and a fail charge." },
      { id: "recall", label: "Lend a stock under recall", verdictHint: "BLOCK",
        intent: "Lend 5,000 Tesla shares to Citadel.",
        body: { security_id: "TSLA", counterparty_id: "citadel-sec", quantity: 5000 },
        withoutCoco: "The booking API accepts it. Tesla is already under recall for a shareholder vote. The new loan breaches the lender's recall right and forces a late, costly return." },
      { id: "notional", label: "Book a large notional", verdictHint: "ESCALATE",
        intent: "Lend 50,000 Apple shares to Citadel.",
        body: { security_id: "AAPL", counterparty_id: "citadel-sec", quantity: 50000 },
        withoutCoco: "The booking API accepts it. A $9.5M loan releases on the agent's own authority, with no desk sign-off on a position this size." },
    ];

    const STAGES = [
      { n: 1, key: "locate", title: "Locate", role: "The agent matches a borrow request to a security on the desk.", tags: ["Borrow request"] },
      { n: 2, key: "rate", title: "Rate", role: "The agent agrees a borrow fee inside the desk's band.", tags: ["Desk rate card"] },
      { n: 3, key: "book", title: "Book loan", role: "Coco reads live inventory, the borrower's running exposure and the recall flag, and rules on the booking before it commits.", tags: ["Coco · securities_lending.loan_execution"], coco: true },
      { n: 4, key: "settle", title: "Settlement", role: "The loan moves to settlement at T+2.", tags: ["T+2"] },
      { n: 5, key: "reconcile", title: "Reconciliation", role: "The desk reconciles positions and reports the day's activity.", tags: ["SFTR"] },
    ];

    const CHECK_LABELS = {
      security_loanable: "Security is on the lendable list",
      inventory_covers_quantity: "Inventory covers the quantity",
      no_recall_or_corporate_action: "No recall or corporate action live",
      within_counterparty_cap: "Within the borrower's exposure cap",
      notional_within_desk_limit: "Within the desk auto-approve limit",
    };

    function stageOutcome(key, verdict, auditId) {
      const audit = auditId ? `#${auditId}` : "pending";
      switch (key) {
        case "locate": return "Borrow request matched. The security is on the lendable list.";
        case "rate":   return "Fee agreed inside the desk's approved band.";
        case "settle":
          if (verdict === "BLOCK") return "Never runs. Coco stopped the booking, so the fail this would have caused never happens.";
          if (verdict === "ESCALATE") return "Held with the booking. Settlement waits on the approver.";
          return "Loan settles at T+2. Position booked cleanly.";
        case "reconcile":
          if (verdict === "BLOCK") return `Audit row ${audit} records the block and the rule that fired. The breach never reaches the morning reconciliation.`;
          if (verdict === "ESCALATE") return `Audit row ${audit} opened for the approver.`;
          return `Logged to audit row ${audit}. The position reconciles clean.`;
        default: return "";
      }
    }

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const COCO_IDX = STAGES.findIndex((s) => s.coco);

    let running = false;
    let selected = SCENARIOS[0];

    const view = h("div", { class: "view" });
    root.appendChild(view);
    view.appendChild(h("div", { class: "view-head" },
      h("div", {},
        h("h1", { class: "view-title" }, "Securities Lending"),
        h("p", { class: "view-sub" }, "An AI agent books a securities loan. The booking API accepts every request; Coco reads the live desk blotter and rules allow, block or escalate before the loan commits. Each contract is anchored to a FINOS Common Domain Model event."),
      ),
    ));

    const chipRow = h("div", { class: "bk-chips" });
    const intentLine = h("p", { class: "bk-intent" }, selected.intent);
    const errLine = h("p", { class: "bk-error", style: { display: "none" } });
    const runBtn = h("button", { class: "btn btn-primary bk-run", onClick: () => run() }, "Book loan");
    const contrastHost = h("div", {});

    function refreshChips() {
      chipRow.innerHTML = "";
      SCENARIOS.forEach((s) => chipRow.appendChild(h("button", {
        class: "chip", "aria-pressed": s.id === selected.id ? "true" : "false",
        onClick: () => {
          if (running) return;
          selected = s;
          intentLine.textContent = s.intent;
          errLine.style.display = "none";
          contrastHost.innerHTML = "";
          refreshChips();
          buildRail();
        },
      }, s.label)));
    }
    refreshChips();

    view.appendChild(h("div", { class: "card" },
      h("div", { class: "card-body" },
        h("div", { class: "bk-control-label" }, "The agent wants to"),
        chipRow, intentLine, runBtn, errLine,
      ),
    ));

    const rail = h("div", { class: "bk-rail" });
    view.appendChild(rail);
    view.appendChild(contrastHost);

    view.appendChild(h("p", { class: "bk-foot" },
      "The booking stage runs live against the gateway and writes a real audit row. The desk blotter is a fixture standing in for a lending platform such as an extended FINOS TraderX: inventory, the borrower's exposure and the recall flag live in the blotter, not in the booking request the agent submits."));

    let stageEls = [];
    function buildRail() {
      rail.innerHTML = "";
      stageEls = STAGES.map((stage) => {
        const outcome = h("p", { class: "bk-outcome" });
        const panelHost = h("div", {});
        const card = h("div", { class: "bk-stage", dataset: { status: "pending", coco: stage.coco ? "true" : "false" } },
          h("span", { class: "bk-num" }, String(stage.n)),
          h("div", { class: "bk-stage-main" },
            h("div", { class: "bk-stage-head" },
              h("h3", { class: "bk-stage-title" }, stage.title),
              h("span", { class: "bk-dot" }),
            ),
            h("p", { class: "bk-role" }, stage.role),
            h("div", { class: "bk-vendors" }, ...stage.tags.map((t) =>
              h("span", { class: "bk-vendor", dataset: { coco: stage.coco ? "true" : "false" } }, t))),
            outcome, panelHost,
          ),
        );
        rail.appendChild(card);
        return { stage, card, outcome, panelHost };
      });
    }
    buildRail();

    function applyStep(step, decision) {
      stageEls.forEach((el, i) => {
        const status = step > i ? "done" : step === i ? "active" : "pending";
        el.card.dataset.status = status;
        if (el.stage.coco) {
          el.card.dataset.verdict = decision ? decision.verdict : "";
          el.panelHost.innerHTML = "";
          if (decision && step >= i) el.panelHost.appendChild(renderBookPanel(decision));
        } else {
          el.outcome.textContent = status === "done"
            ? stageOutcome(el.stage.key, decision ? decision.verdict : "ALLOW", decision ? decision.audit_id : null)
            : "";
        }
      });
    }

    function renderBookPanel(d) {
      const bv = d.booking_view || {};
      const money = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
      const apiCard = h("div", { class: "bk-panel-card" },
        h("p", { class: "bk-panel-label" }, "Booking API"),
        h("p", { class: "bk-balance" }, money(bv.notional || 0)),
        h("p", { class: "bk-sub" }, `${bv.quantity != null ? bv.quantity.toLocaleString() : "—"} ${bv.security || ""} → ${bv.counterparty || ""}`),
        h("div", { class: "bk-obp-status" }, h("span", { class: "bk-obp-dot" }), (d.platform_view && d.platform_view.status) || "ACCEPTED"),
        h("p", { class: "bk-note" }, (d.platform_view && d.platform_view.note) || ""),
      );
      const checksCard = h("div", { class: "bk-panel-card", dataset: { v: d.verdict } },
        h("p", { class: "bk-panel-label" }, "Live blotter state Coco read"),
        h("div", { class: "bk-checks" }, ...(d.checks || []).map((c) =>
          h("div", { class: "bk-check" },
            h("span", { class: c.passed ? "bk-check-label" : "bk-check-label bk-fail" }, CHECK_LABELS[c.check_id] || c.check_id),
            h("span", { class: c.passed ? "bk-check-flag" : "bk-check-flag bk-fail" }, c.passed ? "pass" : "fail"),
          ))),
      );
      const banner = h("div", { class: "bk-verdict-banner", dataset: { v: d.verdict } },
        h("span", { class: "verdict verdict-lg", "data-v": d.verdict }, d.verdict),
        h("span", { class: "bk-reason" }, d.primary_reason),
      );
      const ts = new Date(d.timestamp);
      const tstr = Number.isNaN(ts.getTime()) ? d.timestamp : ts.toLocaleTimeString();
      const cdm = d.cdm_event ? ` · CDM ${d.cdm_event}` : "";
      const audit = h("p", { class: "bk-audit" }, `audit #${d.audit_id != null ? d.audit_id : "—"} · ${tstr} · ${d.pack_id}${cdm}`);
      return h("div", { class: "bk-panel" }, h("div", { class: "bk-panel-grid" }, apiCard, checksCard), banner, audit);
    }

    function renderContrast(scenario, d) {
      const blocked = d.verdict !== "ALLOW";
      const withTone = d.verdict === "ALLOW" ? "good" : d.verdict === "ESCALATE" ? "hold" : "bad";
      const withBody = d.verdict === "ALLOW"
        ? "ALLOW. Every check passed against the live blotter, so the loan books and Coco logs it."
        : d.verdict === "ESCALATE"
          ? `${d.primary_reason}. Coco pauses the booking and hands it to a human, with the reason on the record.`
          : `${d.primary_reason}. Coco blocks the booking at the action boundary, before it commits, and names the rule that fired.`;
      const auditLine = d.audit_id != null
        ? h("a", { class: "sl-panel-foot", href: `#/audit?id=${d.audit_id}` }, `audit #${d.audit_id}${d.cdm_event ? " · CDM " + d.cdm_event : ""}`)
        : h("p", { class: "sl-panel-foot" }, "");
      return h("div", { class: "sl-contrast" },
        h("div", { class: "sl-panel", dataset: { tone: blocked ? "bad" : "good" } },
          h("p", { class: "sl-panel-label" }, "Without Coco"),
          h("p", { class: "sl-panel-body" }, scenario.withoutCoco),
        ),
        h("div", { class: "sl-panel", dataset: { tone: withTone } },
          h("p", { class: "sl-panel-label" }, "With Coco"),
          h("p", { class: "sl-panel-body" }, withBody),
          auditLine,
        ),
      );
    }

    async function run() {
      if (running) return;
      running = true;
      runBtn.disabled = true;
      errLine.style.display = "none";
      contrastHost.innerHTML = "";
      buildRail();
      applyStep(0, null);

      let decision;
      try {
        decision = await api.fetchJson("/api/demo/seclend/book_loan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(selected.body),
        });
      } catch (e) {
        errLine.textContent = e && e.message ? e.message : "Cannot reach the gateway.";
        errLine.style.display = "";
        running = false;
        runBtn.disabled = false;
        return;
      }

      for (let i = 0; i <= STAGES.length; i++) {
        applyStep(i, decision);
        await sleep(i === COCO_IDX ? 950 : 600);
      }
      contrastHost.appendChild(renderContrast(selected, decision));
      refreshEscalationBadge();
      running = false;
      runBtn.disabled = false;
    }
  };

  /* ---- 8.12 LIFECYCLE ACTIONS (other securities-lending contracts) - */

  routes.seclend_actions = async function (root) {
    // The other contracts in the loan lifecycle. Each runs live against the
    // gateway on its own pack and writes a real audit row. `fallout` is what
    // goes wrong without Coco when the verdict is not ALLOW.
    const ACTIONS = [
      {
        key: "collateral", title: "Post collateral", endpoint: "/api/demo/seclend/post_collateral",
        sub: "The borrower posts or substitutes collateral. Coco checks it is eligible and meets the margin threshold before it lands, and holds a concentrated substitution for review.",
        labels: { collateral_eligible: "Collateral type is eligible", meets_margin_threshold: "Meets the margin threshold", concentration_within_limit: "Within the concentration limit" },
        scenarios: [
          { id: "ok", label: "Post cash collateral in full", intent: "Post 2,000,000 in cash against loan-001.", body: { loan_id: "loan-001", posted_value: 2000000, collateral_type: "cash", concentration_pct: 0 } },
          { id: "short", label: "Post below the margin threshold", intent: "Post 1,900,000 against loan-001.", body: { loan_id: "loan-001", posted_value: 1900000, collateral_type: "cash", concentration_pct: 0 }, fallout: "The loan runs under-collateralised. If the borrower defaults, the lender is short on a position it believed was covered." },
          { id: "concentration", label: "Substitute into concentrated equity", intent: "Substitute 2,000,000 of equity collateral into loan-001.", body: { loan_id: "loan-001", posted_value: 2000000, collateral_type: "equity", concentration_pct: 30 }, fallout: "The collateral pool tips past its concentration limit, leaving the lender over-exposed to one asset type." },
        ],
      },
      {
        key: "rate", title: "Agree a borrow fee", endpoint: "/api/demo/seclend/check_rate",
        sub: "The agent agrees the borrow fee on execution. A fee below the floor on a hard-to-borrow name is blocked, and a fee far from the benchmark is held for the desk.",
        labels: { fee_at_or_above_floor: "At or above the approved floor", fee_within_ceiling: "Within the approved ceiling", fee_near_benchmark: "Close to the benchmark" },
        scenarios: [
          { id: "ok", label: "Quote a fee inside the band", intent: "Quote 35 bps to borrow Apple.", body: { security_id: "AAPL", proposed_fee_bps: 35 } },
          { id: "floor", label: "Underprice a hard-to-borrow name", intent: "Quote 200 bps to borrow GameStop.", body: { security_id: "GME", proposed_fee_bps: 200 }, fallout: "A scarce name is lent far below its floor. That is lost fee income at best and a manipulated rate at worst." },
          { id: "bench", label: "Quote far from the benchmark", intent: "Quote 70 bps to borrow Apple.", body: { security_id: "AAPL", proposed_fee_bps: 70 }, fallout: "An off-market fee books unreviewed, the kind of print that draws questions from a regulator." },
        ],
      },
      {
        key: "recall", title: "Roll or extend a loan", endpoint: "/api/demo/seclend/roll_loan",
        sub: "The agent rolls an open loan into a new term. A roll against a live recall is blocked outright, and a roll close to a recall deadline is held for a human.",
        labels: { no_active_recall: "No live recall", not_in_recall_warning_window: "Recall deadline not near" },
        scenarios: [
          { id: "ok", label: "Roll a loan with no recall", intent: "Roll loan-001 into a new term.", body: { loan_id: "loan-001", action: "roll" } },
          { id: "recall", label: "Roll a loan under recall", intent: "Roll loan-002 into a new term.", body: { loan_id: "loan-002", action: "roll" }, fallout: "The roll extends a loan the lender has already recalled, breaching the recall right and forcing a late return." },
          { id: "window", label: "Roll close to a recall deadline", intent: "Roll loan-003 into a new term.", body: { loan_id: "loan-003", action: "roll" }, fallout: "The roll runs past an imminent recall deadline, risking a fail the moment the recall lands." },
        ],
      },
      {
        key: "reporting", title: "Submit a regulatory report", endpoint: "/api/demo/seclend/submit_report",
        sub: "The agent submits the trade report under SFTR. A report missing a required field is blocked, and a report filed past the T+1 deadline is held for a supervisor.",
        labels: { uti_present: "UTI present", lei_present: "Counterparty LEI present", collateral_type_present: "Collateral type present", values_internally_consistent: "Values internally consistent", filed_within_deadline: "Filed within T+1" },
        scenarios: [
          { id: "ok", label: "Submit a complete report", intent: "Submit the SFTR report for loan-001.", body: { report_id: "rpt-clean" } },
          { id: "uti", label: "Submit with a missing UTI", intent: "Submit the SFTR report for loan-002.", body: { report_id: "rpt-missing-uti" }, fallout: "An incomplete report goes to the regulator, a reporting breach the desk has to correct and explain." },
          { id: "late", label: "Submit past the T+1 deadline", intent: "Submit the SFTR report for loan-003.", body: { report_id: "rpt-late" }, fallout: "A late report files silently unless a supervisor owns the breach, which is what Coco forces." },
        ],
      },
    ];

    function renderResult(d, labels, scenario) {
      const banner = h("div", { class: "bk-verdict-banner", dataset: { v: d.verdict } },
        h("span", { class: "verdict verdict-lg", "data-v": d.verdict }, d.verdict),
        h("span", { class: "bk-reason" }, d.primary_reason),
      );
      const checks = h("div", { class: "bk-checks" }, ...(d.checks || []).map((c) =>
        h("div", { class: "bk-check" },
          h("span", { class: c.passed ? "bk-check-label" : "bk-check-label bk-fail" }, labels[c.check_id] || c.check_id),
          h("span", { class: c.passed ? "bk-check-flag" : "bk-check-flag bk-fail" }, c.passed ? "pass" : "fail"),
        )));
      const kids = [banner, checks];
      if (d.verdict !== "ALLOW" && scenario && scenario.fallout) {
        kids.push(h("p", { class: "sl-fallout" }, h("strong", {}, "Without Coco: "), scenario.fallout));
      }
      const ts = new Date(d.timestamp);
      const tstr = Number.isNaN(ts.getTime()) ? d.timestamp : ts.toLocaleTimeString();
      const cdm = d.cdm_event ? ` · CDM ${d.cdm_event}` : "";
      const line = `audit #${d.audit_id != null ? d.audit_id : "—"} · ${tstr} · ${d.pack_id}${cdm}`;
      kids.push(d.audit_id != null
        ? h("a", { class: "bk-audit", href: `#/audit?id=${d.audit_id}` }, line)
        : h("p", { class: "bk-audit" }, line));
      return h("div", { class: "bk-action-result" }, ...kids);
    }

    const view = h("div", { class: "view" });
    root.appendChild(view);
    view.appendChild(h("div", { class: "view-head" },
      h("div", {},
        h("h1", { class: "view-title" }, "Lifecycle actions"),
        h("p", { class: "view-sub" }, "A loan is a chain of stateful transitions, and Coco governs each one. Pick what the agent tries: the gateway reads the live blotter and rules allow, block or escalate before it commits, then writes the verdict to the audit ledger."),
      ),
    ));

    ACTIONS.forEach((a) => {
      let selected = a.scenarios[0];
      let running = false;
      const chipRow = h("div", { class: "bk-chips" });
      const intentLine = h("p", { class: "bk-intent" }, selected.intent);
      const errLine = h("p", { class: "bk-error", style: { display: "none" } });
      const resultHost = h("div", {});
      const runBtn = h("button", { class: "btn btn-primary bk-run", onClick: () => run() }, "Run check");

      function refreshChips() {
        chipRow.innerHTML = "";
        a.scenarios.forEach((s) => chipRow.appendChild(h("button", {
          class: "chip", "aria-pressed": s.id === selected.id ? "true" : "false",
          onClick: () => {
            if (running) return;
            selected = s;
            intentLine.textContent = s.intent;
            errLine.style.display = "none";
            resultHost.innerHTML = "";
            refreshChips();
          },
        }, s.label)));
      }
      refreshChips();

      async function run() {
        if (running) return;
        running = true;
        runBtn.disabled = true;
        errLine.style.display = "none";
        resultHost.innerHTML = "";
        try {
          const d = await api.fetchJson(a.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(selected.body),
          });
          resultHost.appendChild(renderResult(d, a.labels, selected));
          refreshEscalationBadge();
        } catch (e) {
          errLine.textContent = e && e.message ? e.message : "Cannot reach the gateway.";
          errLine.style.display = "";
        } finally {
          running = false;
          runBtn.disabled = false;
        }
      }

      view.appendChild(h("div", { class: "card" },
        h("div", { class: "card-body" },
          h("h3", { class: "bk-action-title" }, a.title),
          h("p", { class: "view-sub" }, a.sub),
          h("div", { class: "bk-control-label" }, "The agent wants to"),
          chipRow, intentLine, runBtn, errLine, resultHost,
        ),
      ));
    });

    view.appendChild(h("p", { class: "bk-foot" },
      "Each action runs live against the gateway on its own CDM-anchored pack and writes a real audit row. Inventory, margin thresholds, recall flags and report completeness live in the desk blotter, not in the request the agent submits."));
  };

  /* =================================================================
   * 9. BOOTSTRAP
   * ================================================================= */

  /* ---- Workspace switcher (company toggle in the topbar) -------- */

  function routeWorkspace(route) {
    if (route === "banking" || route === "actions") return "banking";
    if (route === "seclend" || route === "seclend_actions") return "securities_lending";
    if (route === "integrations") return "twenty";
    return null;  // live/escalations/audit/packs/settings are shared; keep the current workspace
  }
  function setWorkspaceState(id) {
    state.workspace = id;
    try { localStorage.setItem("coco.workspace", id); } catch (_) {}
    const nameEl = $("#workspace-name");
    if (nameEl) nameEl.textContent = currentWorkspace().label;
    applyWorkspaceNav();
    updateBadge();
  }
  function syncWorkspaceToRoute(route) {
    const target = routeWorkspace(route);
    if (target && target !== state.workspace) setWorkspaceState(target);
  }
  function setWorkspace(id) {
    if (!WORKSPACES.some((w) => w.id === id)) return;
    setWorkspaceState(id);
    const target = "#/" + currentWorkspace().home;
    if (location.hash === target) dispatch();
    else location.hash = target;
  }
  function applyWorkspaceNav() {
    const wsId = state.workspace;
    $$(".nav-item[data-ws]").forEach((el) => {
      const ok = (el.dataset.ws || "").split(/\s+/).includes(wsId);
      el.style.display = ok ? "" : "none";
    });
    $$(".nav-section").forEach((sec) => {
      const items = $$(".nav-item", sec);
      const anyVisible = items.some((el) => el.style.display !== "none");
      sec.style.display = items.length && !anyVisible ? "none" : "";
    });
  }
  function buildWorkspaceMenu() {
    const btn = $("#workspace-btn");
    if (!btn) return;
    const menu = h("div", { id: "workspace-menu", class: "ws-menu" });
    menu.hidden = true;
    document.body.appendChild(menu);
    const close = () => { menu.hidden = true; };
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!menu.hidden) { close(); return; }
      menu.innerHTML = "";
      WORKSPACES.forEach((w) => {
        menu.appendChild(h("button", {
          class: "ws-menu-item", "aria-current": w.id === state.workspace ? "true" : "false",
          onClick: (ev) => { ev.stopPropagation(); close(); setWorkspace(w.id); },
        },
          h("span", { class: "ws-dot", dataset: { ws: w.id } }),
          h("span", {}, w.label),
        ));
      });
      const r = btn.getBoundingClientRect();
      menu.style.top = (r.bottom + 6) + "px";
      menu.style.left = r.left + "px";
      menu.hidden = false;
    });
    document.addEventListener("click", close);
  }

  function updateClock() {
    const c = $("#foot-clock");
    if (c) c.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  async function refreshHealth() {
    try {
      const h2 = await api.health();
      state.health = h2;
      $(".health-dot").dataset.status = h2.status === "ok" ? "ok" : "err";
      $("#health-label").textContent = `Gateway · ${h2.status} · ${h2.packs_loaded} packs`;
    } catch (_) {
      state.health = { status: "err" };
      $(".health-dot").dataset.status = "err";
      $("#health-label").textContent = "Gateway offline";
    }
  }

  async function refreshEscalationBadge() {
    try {
      const ex = await api.escalations().catch(() => []);
      state.escalations = ex || [];
    } catch (_) { state.escalations = []; }
    updateBadge();
  }
  function updateBadge() {
    const b = $("#badge-escalations");
    if (!b) return;
    const n = (state.escalations || []).filter((e) => inWorkspace(e.pack_id)).length;
    b.textContent = String(n);
    b.dataset.empty = n === 0 ? "true" : "false";
  }

  async function pollLive() {
    // Light poll: refresh audit + metrics + escalation badge if user is on Live.
    if (state.lastView === "live") {
      try {
        const [audit, metrics] = await Promise.all([api.audit(100), api.metricsLive().catch(() => null)]);
        const topId = audit && audit[0] && audit[0].id;
        if (topId && topId !== state._lastTopId) {
          state._lastTopId = topId;
        }
        state.audit = audit;
        state.metrics = metrics;
        if (state._loadLive) {
          // refresh the live view's renderers in place
          // simpler: call dispatch only if filters didn't change drastically
        }
      } catch (_) {}
    }
    refreshEscalationBadge();
  }

  function bindGlobalKeys() {
    document.addEventListener("keydown", (e) => {
      // Cmd/Ctrl-K
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        palette.open();
        return;
      }
      if (e.key === "Escape") {
        if (palette.isOpen()) palette.close();
        else if (drawer.isOpen()) drawer.close();
        return;
      }
      const t = e.target;
      const inField = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || (t.isContentEditable));
      if (inField) return;
      if (e.key === "/") { e.preventDefault(); palette.open(); }
      // j/k on Live view → move feed selection.
      if (state.lastView === "live" && (e.key === "j" || e.key === "k")) {
        moveFeedSelection(e.key === "j" ? 1 : -1);
        e.preventDefault();
      }
      if (state.lastView === "live" && e.key === "Enter") {
        const sel = $(".feed-row[aria-selected='true']");
        if (sel) sel.click();
      }
    });
  }

  function moveFeedSelection(delta) {
    const rows = $$(".feed-row");
    if (!rows.length) return;
    let idx = rows.findIndex((r) => r.getAttribute("aria-selected") === "true");
    if (idx < 0) idx = delta > 0 ? -1 : rows.length;
    idx = Math.max(0, Math.min(rows.length - 1, idx + delta));
    rows.forEach((r, i) => r.setAttribute("aria-selected", i === idx ? "true" : "false"));
    rows[idx].scrollIntoView({ block: "nearest" });
  }

  function rerenderFeedTimes() {
    // Lightweight tick: refresh "Nm ago" labels without reloading data.
    $$(".feed-row").forEach((r) => {
      const t = r.querySelector(".feed-time");
      if (!t) return;
      const iso = t.title;
      if (iso) t.textContent = fmtRelTime(iso);
    });
  }

  async function init() {
    drawer.init();
    palette.init();
    mountGlyphs();
    buildWorkspaceMenu();
    const wsName = $("#workspace-name");
    if (wsName) wsName.textContent = currentWorkspace().label;
    applyWorkspaceNav();
    bindGlobalKeys();
    updateClock();
    setInterval(updateClock, 30 * 1000);

    window.addEventListener("hashchange", dispatch);
    window.addEventListener("popstate", dispatch);

    // Initial parallel data load
    await Promise.all([
      refreshHealth(),
      api.packs().then((p) => { state.packs = p; }).catch(() => { state.packs = []; }),
      api.scenarios().then((s) => { state.scenarios = s; }).catch(() => { state.scenarios = []; }),
      refreshEscalationBadge(),
    ]);

    if (!location.hash) location.hash = "#/" + currentWorkspace().home;
    await dispatch();

    setInterval(refreshHealth, 15 * 1000);
    setInterval(pollLive, 5 * 1000);
    setInterval(rerenderFeedTimes, 30 * 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
