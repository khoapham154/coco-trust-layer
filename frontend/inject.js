/*!
 * Coco Trust Layer — Twenty injection bootstrap.
 *
 * Auto-loaded into a Twenty browser tab (extension content_scripts MAIN
 * world OR bookmarklet). Depends on coco-sdk.js being loaded first —
 * the loader of choice puts them in order.
 *
 * What it does inside Twenty:
 *   1. Calls Coco.init with the gateway URL this file was served from.
 *   2. Draws a small floating Coco badge bottom-right with health +
 *      "Validate current page" button.
 *   3. Listens for SDK verdicts (Coco.onVerdict) AND for
 *      `coco:demo-verdict` CustomEvents fired by the extension popup,
 *      and renders a polished verdict card for both paths.
 *
 * Self-contained — no bundler, no build, no assumptions about Twenty.
 */
(function () {
  "use strict";

  if (window.__COCO_INJECTED__) {
    console.info("[Coco] already injected — skipping");
    return;
  }
  window.__COCO_INJECTED__ = true;

  function resolveGatewayUrl() {
    const fromAttr = document.currentScript && document.currentScript.dataset.gateway;
    if (fromAttr) return fromAttr;
    if (window.__COCO_GATEWAY_URL) return window.__COCO_GATEWAY_URL;
    const scripts = Array.from(document.querySelectorAll("script"));
    const sdk = scripts.find((s) => s.src && /\/sdk\/coco-sdk\.js/.test(s.src));
    if (sdk) {
      try {
        return new URL(sdk.src).origin;
      } catch (_) {
        /* noop */
      }
    }
    return "http://localhost:8080";
  }

  function waitForSdk(cb, attempts) {
    attempts = attempts || 0;
    if (window.Coco && typeof window.Coco.init === "function") {
      cb();
      return;
    }
    if (attempts > 50) {
      console.error("[Coco] SDK never appeared — inject failed");
      return;
    }
    setTimeout(() => waitForSdk(cb, attempts + 1), 100);
  }

  function injectStyles() {
    if (document.getElementById("coco-injected-styles")) return;
    const css = document.createElement("style");
    css.id = "coco-injected-styles";
    css.textContent = `
      .coco-badge {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483646;
        background: #fff;
        color: #14131a;
        font-family: "Inter", system-ui, sans-serif;
        font-size: 13px;
        border-radius: 12px;
        box-shadow: 0 14px 34px rgba(12, 10, 30, 0.18);
        border: 1px solid #e6e4dd;
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 220px;
      }
      .coco-badge-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .coco-badge-brand {
        font-weight: 700;
        letter-spacing: 0.02em;
        color: #5a149c;
      }
      .coco-badge-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #9024e2;
        box-shadow: 0 0 0 3px rgba(144, 36, 226, 0.2);
      }
      .coco-badge-dot[data-status="off"] { background: #dc2626; box-shadow: 0 0 0 3px #fee2e2; }
      .coco-badge-dot[data-status="on"]  { background: #047857; box-shadow: 0 0 0 3px #dcfce7; }
      .coco-badge-meta { font-size: 11px; color: #6b6a78; }
      .coco-badge-btn {
        background: #14131a;
        color: #fff;
        border: none;
        padding: 8px 12px;
        border-radius: 8px;
        font: 600 12px "Inter", sans-serif;
        cursor: pointer;
      }
      .coco-badge-btn:hover { background: #000; }

      /* --- Verdict card --- */
      .coco-verdict-card {
        position: fixed;
        right: 18px;
        bottom: 130px;
        width: 380px;
        max-width: calc(100vw - 36px);
        z-index: 2147483647;
        background: #fff;
        color: #14131a;
        font-family: "Inter", system-ui, sans-serif;
        border-radius: 14px;
        box-shadow: 0 24px 60px rgba(12, 10, 30, 0.32);
        border: 1px solid #e6e4dd;
        overflow: hidden;
        opacity: 0;
        transform: translateY(20px);
        animation: coco-card-in 0.32s cubic-bezier(0.2, 0.9, 0.3, 1.1) forwards;
      }
      @keyframes coco-card-in {
        from { opacity: 0; transform: translateY(20px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .coco-verdict-stripe {
        height: 6px;
        background: #9024e2;
      }
      .coco-verdict-card[data-verdict="ALLOW"]    .coco-verdict-stripe { background: #047857; }
      .coco-verdict-card[data-verdict="BLOCK"]    .coco-verdict-stripe { background: #dc2626; }
      .coco-verdict-card[data-verdict="ESCALATE"] .coco-verdict-stripe { background: #d97706; }
      .coco-verdict-card[data-verdict="INFO"]     .coco-verdict-stripe { background: #6b6a78; }

      .coco-verdict-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 14px 18px 6px;
      }
      .coco-verdict-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-weight: 800;
        font-size: 14px;
        letter-spacing: 0.04em;
      }
      .coco-verdict-card[data-verdict="ALLOW"]    .coco-verdict-pill { color: #047857; }
      .coco-verdict-card[data-verdict="BLOCK"]    .coco-verdict-pill { color: #dc2626; }
      .coco-verdict-card[data-verdict="ESCALATE"] .coco-verdict-pill { color: #d97706; }
      .coco-verdict-card[data-verdict="INFO"]     .coco-verdict-pill { color: #14131a; }

      .coco-verdict-icon {
        font-size: 18px;
        line-height: 1;
      }
      .coco-verdict-close {
        background: transparent;
        border: none;
        font-size: 16px;
        color: #9ca3af;
        cursor: pointer;
        padding: 2px 6px;
        border-radius: 4px;
      }
      .coco-verdict-close:hover { color: #14131a; background: #f3f4f6; }

      .coco-verdict-reason {
        padding: 4px 18px 12px;
        font-size: 14px;
        line-height: 1.5;
        color: #1f2937;
      }
      .coco-verdict-meta {
        padding: 0 18px 10px;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .coco-verdict-pack, .coco-verdict-rule {
        font: 11px "JetBrains Mono", ui-monospace, monospace;
        background: #f3f4f6;
        border: 1px solid #e5e7eb;
        border-radius: 4px;
        padding: 2px 6px;
        color: #374151;
      }
      .coco-verdict-actions {
        display: flex;
        gap: 8px;
        padding: 10px 18px 16px;
        border-top: 1px solid #f3f4f6;
        background: #fafafa;
      }
      .coco-verdict-btn {
        flex: 1;
        padding: 9px 12px;
        border-radius: 8px;
        font: 600 13px "Inter", sans-serif;
        cursor: pointer;
        border: 1px solid #d1d5db;
        background: #fff;
        color: #14131a;
        transition: border-color 0.12s ease, background 0.12s ease;
      }
      .coco-verdict-btn:hover { border-color: #14131a; }
      .coco-verdict-btn:disabled { opacity: 0.6; cursor: not-allowed; }
      .coco-verdict-btn-primary {
        background: #14131a;
        color: #fff;
        border-color: #14131a;
      }
      .coco-verdict-btn-primary:hover { background: #000; }
    `;
    document.head.appendChild(css);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function removeVerdictCard() {
    const existing = document.getElementById("coco-verdict-card");
    if (existing) existing.remove();
  }

  function pickIconAndLabel(verdict) {
    if (verdict === "BLOCK") return { icon: "🛑", label: "BLOCKED" };
    if (verdict === "ESCALATE") return { icon: "🟡", label: "ESCALATE" };
    if (verdict === "ALLOW") return { icon: "✅", label: "ALLOWED" };
    return { icon: "ℹ️", label: verdict || "INFO" };
  }

  function renderVerdictCard(opts) {
    removeVerdictCard();
    const gatewayUrl =
      opts.gateway_url || window.__COCO_GATEWAY_URL || "http://localhost:8080";

    // Demo "no_coco" variant — neutral info card.
    if (opts.mode === "no_coco") {
      const card = buildBaseCard({
        verdict: "INFO",
        title: "No Coco · mutation applied",
        reason: opts.message || "Stage skip applied with no governance, no audit row.",
        gatewayUrl,
      });
      document.body.appendChild(card);
      autoDismiss(10000);
      return;
    }

    // Demo "reset" variant.
    if (opts.mode === "reset") {
      const card = buildBaseCard({
        verdict: "INFO",
        title: "Demo reset",
        reason: "Hero deal restored to NEW. Audit window cleared.",
        gatewayUrl,
      });
      document.body.appendChild(card);
      autoDismiss(6000);
      return;
    }

    // Real verdict (with_coco or SDK validate path).
    const verdict = opts.verdict || "ALLOW";
    const { icon, label } = pickIconAndLabel(verdict);
    const reason = opts.primary_reason || opts.reason || "All checks passed.";
    const packId = opts.pack_id || "";
    const decisionId = opts.decision_id;
    const decision = opts.decision || {};
    const failingCheck = (decision.checks || []).find((c) => c && c.passed === false);
    const ruleId = failingCheck && failingCheck.check_id;

    const card = document.createElement("div");
    card.className = "coco-verdict-card";
    card.id = "coco-verdict-card";
    card.dataset.verdict = verdict;
    card.innerHTML = `
      <div class="coco-verdict-stripe"></div>
      <div class="coco-verdict-head">
        <span class="coco-verdict-pill">
          <span class="coco-verdict-icon">${icon}</span>${label}
        </span>
        <button class="coco-verdict-close" aria-label="Dismiss" type="button">✕</button>
      </div>
      <div class="coco-verdict-reason">${escapeHtml(reason)}</div>
      <div class="coco-verdict-meta">
        ${packId ? `<span class="coco-verdict-pack">${escapeHtml(packId)}</span>` : ""}
        ${ruleId ? `<span class="coco-verdict-rule">rule: ${escapeHtml(ruleId)}</span>` : ""}
      </div>
      <div class="coco-verdict-actions">
        ${decisionId ? `<button class="coco-verdict-btn coco-verdict-btn-primary" data-action="evidence" type="button">Show evidence</button>` : ""}
        ${verdict === "BLOCK" && decisionId ? `<button class="coco-verdict-btn" data-action="override" type="button">Override</button>` : ""}
      </div>
    `;
    document.body.appendChild(card);

    card.querySelector(".coco-verdict-close").addEventListener("click", removeVerdictCard);

    const evBtn = card.querySelector("[data-action='evidence']");
    if (evBtn) {
      evBtn.addEventListener("click", () => {
        window.open(`${gatewayUrl}/dashboard#audit-${decisionId}`, "_blank");
      });
    }

    const ovBtn = card.querySelector("[data-action='override']");
    if (ovBtn) {
      ovBtn.addEventListener("click", () => overrideVerdict(ovBtn, decisionId, packId, gatewayUrl));
    }

    if (verdict !== "BLOCK") {
      autoDismiss(18000);
    }
  }

  function buildBaseCard({ verdict, title, reason, gatewayUrl }) {
    const card = document.createElement("div");
    card.className = "coco-verdict-card";
    card.id = "coco-verdict-card";
    card.dataset.verdict = verdict;
    card.innerHTML = `
      <div class="coco-verdict-stripe"></div>
      <div class="coco-verdict-head">
        <span class="coco-verdict-pill">
          <span class="coco-verdict-icon">ℹ️</span>${escapeHtml(title)}
        </span>
        <button class="coco-verdict-close" aria-label="Dismiss" type="button">✕</button>
      </div>
      <div class="coco-verdict-reason">${escapeHtml(reason)}</div>
      <div class="coco-verdict-actions">
        <button class="coco-verdict-btn" data-action="dashboard" type="button">Open dashboard</button>
      </div>
    `;
    card.querySelector(".coco-verdict-close").addEventListener("click", removeVerdictCard);
    card
      .querySelector("[data-action='dashboard']")
      .addEventListener("click", () => window.open(`${gatewayUrl}/dashboard`, "_blank"));
    return card;
  }

  function autoDismiss(ms) {
    setTimeout(() => {
      const el = document.getElementById("coco-verdict-card");
      if (el) el.remove();
    }, ms);
  }

  async function overrideVerdict(button, decisionId, packId, gatewayUrl) {
    button.disabled = true;
    button.textContent = "Escalating…";
    try {
      const resp = await fetch(`${gatewayUrl}/api/demo/escalate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision_id: decisionId,
          comment: "Override requested from Coco verdict card.",
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        button.textContent = data.detail || `Failed (${resp.status})`;
        return;
      }
      renderVerdictCard({
        mode: "with_coco",
        verdict: "ESCALATE",
        primary_reason: data.primary_reason,
        pack_id: packId,
        decision_id: data.id,
        gateway_url: gatewayUrl,
      });
    } catch (err) {
      button.textContent = `Failed: ${err.message}`;
    }
  }

  function renderBadge(gatewayUrl) {
    if (document.getElementById("coco-injected-badge")) return;
    const badge = document.createElement("div");
    badge.id = "coco-injected-badge";
    badge.className = "coco-badge";
    badge.innerHTML = `
      <div class="coco-badge-head">
        <span class="coco-badge-brand">Coco</span>
        <span class="coco-badge-dot" id="coco-injected-dot" data-status="unknown"></span>
      </div>
      <div class="coco-badge-meta" id="coco-injected-meta">Connecting to ${escapeHtml(gatewayUrl)}…</div>
      <button class="coco-badge-btn" id="coco-injected-validate" type="button">Validate current page</button>
    `;
    document.body.appendChild(badge);
    pingHealth(gatewayUrl);
    document.getElementById("coco-injected-validate").addEventListener("click", () => {
      validateCurrentPage(gatewayUrl);
    });
  }

  function pingHealth(gatewayUrl) {
    const dot = document.getElementById("coco-injected-dot");
    const meta = document.getElementById("coco-injected-meta");
    fetch(gatewayUrl + "/health")
      .then((r) => r.json())
      .then((h) => {
        dot.dataset.status = h.status === "ok" ? "on" : "off";
        meta.textContent = `Gateway · ${h.status} · ${h.packs_loaded} packs`;
      })
      .catch(() => {
        dot.dataset.status = "off";
        meta.textContent = "Gateway offline";
      });
  }

  function guessPackAndState() {
    const path = location.pathname;
    if (/\/objects\/opportunities/.test(path)) {
      const stageEl =
        document.querySelector('[data-testid="record-detail-stage"]') ||
        document.querySelector('[data-field="stage"]');
      return {
        packId: "twenty.deal_stage_move",
        action: "move_stage",
        uiState: {
          deal: {
            owner: readDatasetValue('[data-testid="record-detail-owner"]'),
            amount: Number(readDatasetValue('[data-testid="record-detail-amount"]')) || 0,
            prev_stage_tasks_completed: true,
            is_sequential_stage_move: true,
            manager_field_filled: false,
            target_stage: ((stageEl && stageEl.textContent) || "").trim().toLowerCase(),
          },
          user: { role: "sales" },
        },
      };
    }
    if (/\/objects\/people/.test(path)) {
      return {
        packId: "twenty.contact_delete",
        action: "delete_contact",
        uiState: {
          contact: { open_opportunity_count: 0, days_since_modified: 30 },
          user: { role: "admin" },
        },
      };
    }
    return {
      packId: "twenty.field_update",
      action: "update_field",
      uiState: {
        record: { exists: true, archived: false },
        field_update: {
          required_fields_still_filled: true,
          email_format_valid: true,
        },
      },
    };
  }

  function readDatasetValue(selector) {
    const el = document.querySelector(selector);
    if (!el) return null;
    if (el.dataset && el.dataset.cocoValue) return el.dataset.cocoValue;
    return (el.textContent || "").trim() || null;
  }

  function validateCurrentPage(gatewayUrl) {
    const guess = guessPackAndState();
    window.Coco.validate(guess.action, guess.uiState, guess.packId, "pre").catch((err) => {
      renderVerdictCard({
        verdict: "BLOCK",
        primary_reason: "Coco validate failed: " + err.message,
        pack_id: guess.packId,
        gateway_url: gatewayUrl,
      });
    });
  }

  function bindHandlers(gatewayUrl) {
    if (window.Coco && typeof window.Coco.onVerdict === "function") {
      window.Coco.onVerdict((decision) => {
        renderVerdictCard({
          verdict: decision.verdict,
          primary_reason: decision.primary_reason,
          pack_id: decision.pack_id,
          decision: decision,
          gateway_url: gatewayUrl,
        });
      });
    }
    // Demo events from the extension popup.
    window.addEventListener("coco:demo-verdict", (ev) => {
      try {
        renderVerdictCard(ev.detail || {});
      } catch (err) {
        console.error("[Coco] verdict render failed:", err);
      }
    });
  }

  function boot() {
    const gatewayUrl = resolveGatewayUrl();
    window.__COCO_GATEWAY_URL = gatewayUrl;
    waitForSdk(() => {
      try {
        window.Coco.init({ gatewayUrl: gatewayUrl, appId: "twenty" });
      } catch (err) {
        console.error("[Coco] init failed:", err);
        return;
      }
      injectStyles();
      renderBadge(gatewayUrl);
      bindHandlers(gatewayUrl);
      console.info("[Coco] SDK live against", gatewayUrl);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
