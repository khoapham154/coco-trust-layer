/*!
 * Coco Trust Layer — Twenty injection bootstrap.
 *
 * Auto-loaded into a Twenty browser tab via the bookmarklet at
 * /static/inject_bookmarklet.html (or via a userscript manager).
 * Depends on coco-sdk.js being loaded first — the bookmarklet loads
 * them in order.
 *
 * What it does when it runs inside Twenty:
 *   1. Calls `Coco.init` with the gateway URL this file was served
 *      from (same origin as the SDK — no CORS config needed).
 *   2. Draws a small floating Coco badge (bottom-right) showing the
 *      gateway status + a "Validate current page" button.
 *   3. Renders a toast on every verdict the SDK observes.
 *
 * This file is intentionally self-contained — no bundler, no build,
 * and no assumptions about Twenty's internal structure.
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
    // Fall back: derive from the <script src> of coco-sdk.js itself.
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
        z-index: 2147483647;
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
      .coco-toast {
        position: fixed;
        right: 18px;
        bottom: 120px;
        z-index: 2147483647;
        background: #14131a;
        color: #fff;
        border-radius: 10px;
        padding: 12px 16px;
        font: 500 13px "Inter", sans-serif;
        box-shadow: 0 12px 28px rgba(12, 10, 30, 0.22);
        max-width: 320px;
        transition: transform 0.25s ease, opacity 0.25s ease;
      }
      .coco-toast[data-verdict="ALLOW"]    { background: #047857; }
      .coco-toast[data-verdict="BLOCK"]    { background: #dc2626; }
      .coco-toast[data-verdict="ESCALATE"] { background: #d97706; }
    `;
    document.head.appendChild(css);
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
      <div class="coco-badge-meta" id="coco-injected-meta">Connecting to ${gatewayUrl}…</div>
      <button class="coco-badge-btn" id="coco-injected-validate">Validate current page</button>
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
    // Best-effort: look at the current Twenty route to decide what
    // pack + ui_state to validate against. Users can always run
    // a specific scenario from the Coco dashboard instead.
    const path = location.pathname;
    if (/\/objects\/opportunities/.test(path)) {
      const stageEl = document.querySelector('[data-testid="record-detail-stage"]')
        || document.querySelector('[data-field="stage"]');
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
            target_stage: (stageEl && stageEl.textContent || "").trim().toLowerCase(),
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
      showToast("BLOCK", "Coco validate failed: " + err.message);
    });
  }

  function showToast(verdict, message) {
    const toast = document.createElement("div");
    toast.className = "coco-toast";
    toast.dataset.verdict = verdict;
    toast.textContent = `[${verdict}] ${message}`;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(8px)";
      setTimeout(() => toast.remove(), 250);
    }, 4000);
  }

  function bindHandlers() {
    window.Coco.onVerdict((decision) => {
      showToast(decision.verdict, decision.primary_reason || decision.pack_id);
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
      bindHandlers();
      console.info("[Coco] SDK live against", gatewayUrl);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
