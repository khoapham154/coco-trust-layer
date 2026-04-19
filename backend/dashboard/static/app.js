/* CoCo Trust Layer — dashboard frontend logic.
 *
 * Talks to the real gateway at same-origin endpoints:
 *   GET  /api/packs
 *   GET  /api/packs/{id}
 *   GET  /api/scenarios
 *   GET  /api/scenarios/{id}
 *   POST /api/scenarios/{id}/run?driver=engine|twenty
 *   GET  /api/audit?limit=50
 *   GET  /health
 *
 * No frameworks, no build step. Runs straight from the <script> tag
 * and renders into elements defined in templates/index.html.
 */

(function () {
  "use strict";

  const state = {
    packs: [],
    packDetails: {},
    scenarios: [],
    selectedPackId: null,
    selectedScenarioId: null,
    driver: "engine",
    lastRun: null,
  };

  const el = (id) => document.getElementById(id);
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function replaceIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  }

  function toast(message, kind = "info") {
    const stack = el("toast-stack");
    if (!stack) return;
    const node = document.createElement("div");
    node.className = "toast";
    node.dataset.kind = kind;
    node.textContent = message;
    stack.appendChild(node);
    setTimeout(() => {
      node.style.opacity = "0";
      node.style.transition = "opacity 0.25s ease";
      setTimeout(() => node.remove(), 300);
    }, 3500);
  }

  async function fetchJson(url, init) {
    const resp = await fetch(url, init);
    if (!resp.ok) {
      let detail = "";
      try {
        const body = await resp.json();
        detail = body && body.detail ? ` — ${body.detail}` : "";
      } catch (_) {
        /* noop */
      }
      throw new Error(`${resp.status} ${resp.statusText}${detail}`);
    }
    return resp.json();
  }

  /* ---- Packs --------------------------------------------------- */

  async function loadPacks() {
    const grid = el("pack-grid");
    grid.innerHTML = '<div class="pack-loading">Loading packs…</div>';
    try {
      state.packs = await fetchJson("/api/packs");
    } catch (err) {
      grid.innerHTML = `<div class="pack-loading">Failed to load packs: ${err.message}</div>`;
      return;
    }
    el("stat-packs").textContent = state.packs.length;
    renderPackGrid();
  }

  function renderPackGrid() {
    const grid = el("pack-grid");
    if (!state.packs.length) {
      grid.innerHTML = '<div class="pack-loading">No packs loaded.</div>';
      return;
    }
    grid.innerHTML = "";
    state.packs.forEach((pack) => {
      const card = document.createElement("div");
      card.className = "pack-card";
      if (state.selectedPackId === pack.id) card.classList.add("active");
      card.dataset.packId = pack.id;
      card.innerHTML = `
        <div class="pack-title">${escapeHtml(pack.id)}</div>
        <div class="pack-action">${escapeHtml(pack.action)}</div>
        <div class="pack-desc">${escapeHtml(pack.description || "")}</div>
        <div class="pack-meta">
          <span class="pack-chip">${pack.pre_count} pre</span>
          <span class="pack-chip">${pack.constraint_count} constraint</span>
          <span class="pack-chip">${pack.post_count} post</span>
        </div>
      `;
      card.addEventListener("click", () => selectPack(pack.id));
      grid.appendChild(card);
    });
  }

  async function selectPack(packId) {
    state.selectedPackId = packId;
    renderPackGrid();
    try {
      if (!state.packDetails[packId]) {
        state.packDetails[packId] = await fetchJson(
          `/api/packs/${encodeURIComponent(packId)}`
        );
      }
      renderPackDetail(state.packDetails[packId]);
    } catch (err) {
      toast(`Failed to load pack ${packId}: ${err.message}`, "error");
    }
  }

  function renderPackDetail(pack) {
    const host = el("pack-detail");
    host.innerHTML = `
      <div class="pack-detail-body">
        <div class="pack-detail-head">
          <div>
            <h3>${escapeHtml(pack.id)}</h3>
            <p>${escapeHtml(pack.description || "")}</p>
          </div>
          <span class="pack-chip">${escapeHtml(pack.action)}</span>
        </div>
        <pre class="yaml-view">${escapeHtml(renderPackYaml(pack))}</pre>
      </div>
    `;
  }

  function renderPackYaml(pack) {
    /* Not a full YAML emitter — renders the pack dict as a compact,
     * readable YAML-ish view. Good enough for the dashboard; the
     * source of truth is the file in data/twenty/packs/. */
    const lines = [];
    lines.push(`id: ${pack.id}`);
    lines.push(`action: ${pack.action}`);
    if (pack.description) lines.push(`description: ${pack.description}`);
    lines.push("");
    const sections = [
      ["pre_conditions", pack.pre_conditions],
      ["constraints", pack.constraints],
      ["post_conditions", pack.post_conditions],
    ];
    sections.forEach(([name, items]) => {
      if (!items || !items.length) return;
      lines.push(`${name}:`);
      items.forEach((check) => {
        lines.push(`  - id: ${check.id}`);
        if (check.description) lines.push(`    description: ${check.description}`);
        if (check.expression) lines.push(`    expression: ${check.expression}`);
        if (check.operator) lines.push(`    operator: ${check.operator}`);
        if (check.expected !== undefined)
          lines.push(`    expected: ${JSON.stringify(check.expected)}`);
        if (check.verdict_on_fail)
          lines.push(`    verdict_on_fail: ${check.verdict_on_fail}`);
        if (check.fail_reason) lines.push(`    fail_reason: ${check.fail_reason}`);
      });
      lines.push("");
    });
    return lines.join("\n");
  }

  /* ---- Scenarios ---------------------------------------------- */

  async function loadScenarios() {
    const grid = el("scenario-grid");
    grid.innerHTML = '<div class="scenario-loading">Loading scenarios…</div>';
    try {
      state.scenarios = await fetchJson("/api/scenarios");
    } catch (err) {
      grid.innerHTML = `<div class="scenario-loading">Failed to load: ${err.message}</div>`;
      return;
    }
    el("stat-scenarios").textContent = state.scenarios.length;
    renderScenarioGrid();
  }

  function renderScenarioGrid() {
    const grid = el("scenario-grid");
    if (!state.scenarios.length) {
      grid.innerHTML = '<div class="scenario-loading">No scenarios.</div>';
      return;
    }
    grid.innerHTML = "";
    state.scenarios.forEach((s) => {
      const card = document.createElement("div");
      card.className = "scenario-card";
      if (state.selectedScenarioId === s.id) card.classList.add("active");
      card.innerHTML = `
        <div class="scenario-head">
          <div class="scenario-name">${escapeHtml(s.id)}</div>
          <span class="verdict-badge" data-verdict="${escapeHtml(
            s.expected_verdict || "—"
          )}">${escapeHtml(s.expected_verdict || "—")}</span>
        </div>
        <div class="scenario-pack">${escapeHtml(s.pack_id)} · ${escapeHtml(
        s.action || ""
      )}</div>
      `;
      card.addEventListener("click", () => runScenario(s.id));
      grid.appendChild(card);
    });
  }

  async function runScenario(scenarioId) {
    state.selectedScenarioId = scenarioId;
    renderScenarioGrid();
    try {
      const scenario = state.scenarios.find((s) => s.id === scenarioId);
      if (scenario) selectPack(scenario.pack_id);
    } catch (_) {
      /* pack selection is best-effort */
    }

    showVerdictLoading(scenarioId);
    try {
      const driver = state.driver;
      const result = await fetchJson(
        `/api/scenarios/${encodeURIComponent(scenarioId)}/run?driver=${driver}`,
        { method: "POST" }
      );
      state.lastRun = result;
      renderVerdict(result);
      loadAudit();
      toast(
        `${scenarioId} · ${result.decision.verdict}`,
        verdictKind(result.decision.verdict)
      );
    } catch (err) {
      renderVerdictError(scenarioId, err);
      toast(`Run failed: ${err.message}`, "error");
    }
  }

  function verdictKind(v) {
    if (v === "ALLOW") return "success";
    if (v === "BLOCK") return "error";
    return "warn";
  }

  function showVerdictLoading(scenarioId) {
    el("verdict-empty").hidden = true;
    const detail = el("verdict-detail");
    detail.hidden = false;
    detail.innerHTML = `
      <div class="verdict-head">
        <span class="verdict-badge" data-verdict="—">Running…</span>
        <div class="verdict-head-meta">${escapeHtml(scenarioId)}</div>
      </div>
      <p class="verdict-reason">Calling /api/scenarios/${escapeHtml(
        scenarioId
      )}/run…</p>
    `;
    replaceIcons();
  }

  function renderVerdictError(scenarioId, err) {
    el("verdict-empty").hidden = true;
    const detail = el("verdict-detail");
    detail.hidden = false;
    detail.innerHTML = `
      <div class="verdict-head">
        <span class="verdict-badge" data-verdict="BLOCK">Error</span>
        <div class="verdict-head-meta">${escapeHtml(scenarioId)}</div>
      </div>
      <p class="verdict-reason">${escapeHtml(err.message)}</p>
    `;
  }

  function renderVerdict(result) {
    const decision = result.decision;
    el("verdict-empty").hidden = true;
    const detail = el("verdict-detail");
    detail.hidden = false;

    const expected = result.expected_verdict;
    const matched = expected ? decision.verdict === expected : null;

    const checksHtml = (decision.checks || [])
      .map(
        (c) => `
      <div class="check-row" data-passed="${c.passed}">
        <div class="check-mark">${c.passed ? "✓" : "✗"}</div>
        <div class="check-body">
          <span class="check-id">${escapeHtml(c.check_id)}</span>
          <span class="check-kind">${escapeHtml(c.kind)}</span>
          <div class="check-reason">${escapeHtml(c.reason || "")}</div>
          ${
            c.observed === null || c.observed === undefined
              ? ""
              : `<div class="check-observed">observed: ${escapeHtml(
                  JSON.stringify(c.observed)
                )}</div>`
          }
        </div>
      </div>
    `
      )
      .join("");

    detail.innerHTML = `
      <div class="verdict-head">
        <span class="verdict-badge" data-verdict="${escapeHtml(
          decision.verdict
        )}">${escapeHtml(decision.verdict)}</span>
        <div class="verdict-head-meta">
          ${escapeHtml(decision.pack_id)}<br />
          ${escapeHtml(decision.action)} · ${escapeHtml(decision.phase)}<br />
          ${escapeHtml(decision.timestamp)}
        </div>
      </div>
      <p class="verdict-reason">${escapeHtml(decision.primary_reason)}</p>
      <div class="verdict-meta-grid">
        <div class="verdict-meta">
          <div class="verdict-meta-label">Driver</div>
          <div class="verdict-meta-value">${escapeHtml(
            result.driver || "engine"
          )}</div>
        </div>
        <div class="verdict-meta">
          <div class="verdict-meta-label">Scenario</div>
          <div class="verdict-meta-value">${escapeHtml(
            result.scenario_id
          )}</div>
        </div>
        <div class="verdict-meta">
          <div class="verdict-meta-label">Checks</div>
          <div class="verdict-meta-value">${decision.checks.length}</div>
        </div>
      </div>
      <div class="verdict-checks">${checksHtml || "<em>No checks recorded.</em>"}</div>
      ${
        expected
          ? `<div class="verdict-expected ${
              matched === null ? "" : matched ? "match" : "mismatch"
            }">
              Expected verdict: <strong>${escapeHtml(expected)}</strong>
              ${
                matched === null
                  ? ""
                  : matched
                  ? "· ✓ matched"
                  : "· ✗ differed"
              }
             </div>`
          : ""
      }
    `;
  }

  /* ---- Audit -------------------------------------------------- */

  async function loadAudit() {
    const body = el("audit-body");
    try {
      const rows = await fetchJson("/api/audit?limit=50");
      el("stat-audit").textContent = rows.length;
      if (!rows.length) {
        body.innerHTML =
          '<tr><td colspan="6" class="audit-empty">No decisions yet — run a scenario.</td></tr>';
        return;
      }
      body.innerHTML = rows
        .map(
          (r) => `
        <tr>
          <td>${escapeHtml(formatTime(r.timestamp))}</td>
          <td>${escapeHtml(r.pack_id)}</td>
          <td>${escapeHtml(r.action)}</td>
          <td>${escapeHtml(r.phase)}</td>
          <td><span class="verdict-badge" data-verdict="${escapeHtml(
            r.verdict
          )}">${escapeHtml(r.verdict)}</span></td>
          <td>${escapeHtml(r.primary_reason || "")}</td>
        </tr>
      `
        )
        .join("");
    } catch (err) {
      body.innerHTML = `<tr><td colspan="6" class="audit-empty">Failed to load: ${escapeHtml(
        err.message
      )}</td></tr>`;
    }
  }

  /* ---- Health ------------------------------------------------- */

  async function loadHealth() {
    const dot = qs(".health-dot");
    const label = el("nav-health-label");
    const stat = el("stat-gateway");
    try {
      const h = await fetchJson("/health");
      dot.dataset.status = h.status === "ok" ? "ok" : "err";
      label.textContent = `Gateway · ${h.status}`;
      stat.textContent = h.status;
    } catch (err) {
      dot.dataset.status = "err";
      label.textContent = "Gateway offline";
      stat.textContent = "offline";
    }
  }

  /* ---- Run all ------------------------------------------------ */

  async function runAllScenarios() {
    if (!state.scenarios.length) return;
    toast(`Running ${state.scenarios.length} scenarios…`);
    let pass = 0;
    let fail = 0;
    for (const s of state.scenarios) {
      try {
        const result = await fetchJson(
          `/api/scenarios/${encodeURIComponent(s.id)}/run?driver=${state.driver}`,
          { method: "POST" }
        );
        if (result.decision.verdict === s.expected_verdict) pass += 1;
        else fail += 1;
      } catch (_) {
        fail += 1;
      }
    }
    toast(`Run all: ${pass} matched · ${fail} differed`, fail ? "warn" : "success");
    loadAudit();
  }

  /* ---- Utilities ---------------------------------------------- */

  function escapeHtml(v) {
    if (v === null || v === undefined) return "";
    return String(v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatTime(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString() + " " + d.toLocaleDateString();
    } catch (_) {
      return iso;
    }
  }

  function bindControls() {
    qsa('input[name="driver"]').forEach((input) => {
      input.addEventListener("change", (e) => {
        state.driver = e.target.value;
        toast(`Driver: ${state.driver}`);
      });
    });

    el("refresh-audit").addEventListener("click", loadAudit);
    el("run-all").addEventListener("click", runAllScenarios);

    qsa("[data-scroll]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = document.getElementById(btn.dataset.scroll);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });

    const copyBtn = el("copy-snippet");
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        const snippet = el("inject-snippet").textContent.trim();
        try {
          await navigator.clipboard.writeText(snippet);
          toast("SDK snippet copied to clipboard", "success");
        } catch (_) {
          toast("Copy failed — select the snippet and Cmd/Ctrl+C", "warn");
        }
      });
    }

    const bookmarkletBtn = el("open-bookmarklet");
    if (bookmarkletBtn) {
      bookmarkletBtn.addEventListener("click", () => {
        document.getElementById("twenty").scrollIntoView({ behavior: "smooth" });
      });
    }
  }

  function updateFoot() {
    const footTime = el("foot-time");
    if (footTime) {
      footTime.textContent = new Date().toLocaleString();
    }
  }

  async function init() {
    bindControls();
    updateFoot();
    replaceIcons();
    await Promise.all([loadHealth(), loadPacks(), loadScenarios(), loadAudit()]);
    replaceIcons();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
