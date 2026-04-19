/*!
 * Coco Trust Layer SDK — vanilla JS, no dependencies.
 *
 * Embed in a SaaS frontend to capture UI state and validate agent actions
 * against the Coco gateway before they run.
 *
 * Quick start:
 *   Coco.init({ gatewayUrl: "http://localhost:8080", appId: "twenty" });
 *   const state = Coco.captureState({ stage: "[data-testid='deal-stage']" });
 *   const verdict = await Coco.validate(
 *     "move_stage", state, "twenty.deal_stage_move"
 *   );
 *   if (verdict.verdict === "BLOCK") alert(verdict.primary_reason);
 */
(function (global) {
  "use strict";

  const Coco = {
    _config: null,
    _handlers: [],

    init(config) {
      if (!config || !config.gatewayUrl) {
        throw new Error("Coco.init: gatewayUrl is required");
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
     * pass a nested object and Coco will recurse.
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
        throw new Error("Coco.validate: call Coco.init first");
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
        throw new Error("Coco gateway error " + res.status + ": " + text);
      }
      const decision = await res.json();
      for (const h of this._handlers) {
        try { h(decision); } catch (e) { console.error("Coco handler error", e); }
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
    module.exports = Coco;
  } else {
    global.Coco = Coco;
  }
})(typeof window !== "undefined" ? window : globalThis);
