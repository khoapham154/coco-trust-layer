/*!
 * CoCo Trust Layer SDK — vanilla JS, no dependencies.
 *
 * Embed in a SaaS frontend to capture UI state and validate agent actions
 * against the CoCo gateway before they run.
 *
 * Quick start:
 *   CoCo.init({ gatewayUrl: "http://localhost:8080", appId: "twenty" });
 *   const state = CoCo.captureState({ stage: "[data-testid='deal-stage']" });
 *   const verdict = await CoCo.validate(
 *     "move_stage", state, "twenty.deal_stage_move"
 *   );
 *   if (verdict.verdict === "BLOCK") alert(verdict.primary_reason);
 */
(function (global) {
  "use strict";

  const CoCo = {
    _config: null,
    _handlers: [],

    init(config) {
      if (!config || !config.gatewayUrl) {
        throw new Error("CoCo.init: gatewayUrl is required");
      }
      this._config = {
        gatewayUrl: String(config.gatewayUrl).replace(/\/$/, ""),
        appId: config.appId || "twenty",
      };
      return this;
    },

    /**
     * Read values from the DOM into a plain object suitable as ui_state input.
     * `selectors` is a flat `{ key: "cssSelector" }` map. For structured state,
     * pass a nested object and CoCo will recurse.
     */
    captureState(selectors) {
      if (!selectors) return {};
      const state = {};
      for (const [key, sel] of Object.entries(selectors)) {
        if (sel && typeof sel === "object") {
          state[key] = this.captureState(sel);
          continue;
        }
        const el = document.querySelector(sel);
        if (!el) {
          state[key] = null;
          continue;
        }
        if (el.dataset && el.dataset.cocoValue !== undefined) {
          state[key] = el.dataset.cocoValue;
        } else if ("value" in el && el.value !== undefined && el.value !== "") {
          state[key] = el.value;
        } else {
          state[key] = (el.textContent || "").trim() || null;
        }
      }
      return state;
    },

    /**
     * Send the captured state + requested action to the gateway.
     * Returns the full decision object (verdict, primary_reason, checks, ...).
     */
    async validate(action, uiState, packId, phase) {
      if (!this._config) {
        throw new Error("CoCo.validate: call CoCo.init first");
      }
      const body = {
        pack_id: packId,
        action: action,
        ui_state: uiState || {},
        phase: phase || "pre",
      };
      const res = await fetch(this._config.gatewayUrl + "/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error("CoCo gateway error " + res.status + ": " + text);
      }
      const decision = await res.json();
      for (const h of this._handlers) {
        try { h(decision); } catch (e) { console.error("CoCo handler error", e); }
      }
      return decision;
    },

    /** Register a callback that fires on every verdict (ALLOW, BLOCK, ESCALATE). */
    onVerdict(cb) {
      if (typeof cb === "function") this._handlers.push(cb);
      return this;
    },

    /** Clear config + handlers (useful for tests). */
    reset() {
      this._config = null;
      this._handlers = [];
      return this;
    },
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = CoCo;
  } else {
    global.CoCo = CoCo;
  }
})(typeof window !== "undefined" ? window : globalThis);
