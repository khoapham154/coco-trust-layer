/* CoCo Trust Layer — Twenty onboarding wizard.
 *
 * Renders a six-step state machine inside #wizard on the dashboard.
 * Each step owns (a) a render() that draws the pane body and (b) a
 * set of event handlers for the buttons it exposes. State (API key,
 * base URL, completion flags, verdict) persists to localStorage under
 * the `coco.wizard.*` namespace so a page refresh keeps progress.
 *
 * Backend endpoints hit:
 *   GET  /health
 *   POST /api/twenty/test-connection
 *   POST /api/twenty/seed   (requires COCO_ALLOW_WIZARD_EXEC=1 server-side)
 *   POST /api/scenarios/deal_stage_move_allow/run?driver=twenty
 *
 * No deps. Loaded after app.js — app.js's toast helper is reused when
 * available, otherwise we fall back to inline status pills.
 */
(function () {
  "use strict";

  const LS_PREFIX = "coco.wizard.";
  const GATEWAY_ORIGIN = window.location.origin;
  const DEFAULT_TWENTY_URL = "http://localhost:3000";

  const lsGet = (key, fallback = "") => {
    try {
      const val = localStorage.getItem(LS_PREFIX + key);
      return val == null ? fallback : val;
    } catch (_) {
      return fallback;
    }
  };
  const lsSet = (key, val) => {
    try {
      localStorage.setItem(LS_PREFIX + key, val);
    } catch (_) {
      /* noop — private mode, quota exceeded */
    }
  };
  const lsBool = (key) => lsGet(key) === "1";
  const lsSetBool = (key, val) => lsSet(key, val ? "1" : "0");

  const state = {
    currentStep: parseInt(lsGet("currentStep", "0"), 10) || 0,
    apiKey: lsGet("apiKey", ""),
    twentyUrl: lsGet("twentyUrl", DEFAULT_TWENTY_URL),
    steps: {
      health: { done: lsBool("step.health"), lastStatus: null },
      twenty: { done: lsBool("step.twenty"), lastStatus: null },
      connect: { done: lsBool("step.connect"), lastStatus: null, workspace: "" },
      seed: { done: lsBool("step.seed"), lastStatus: null, counts: null },
      extension: { done: lsBool("step.extension"), lastStatus: null },
      scenario: { done: lsBool("step.scenario"), lastStatus: null, verdict: null },
    },
  };

  const STEPS = [
    { key: "health", label: "Gateway health", num: "1" },
    { key: "twenty", label: "Start Twenty", num: "2" },
    { key: "connect", label: "Connect API key", num: "3" },
    { key: "seed", label: "Seed fixtures", num: "4" },
    { key: "extension", label: "Install extension", num: "5" },
    { key: "scenario", label: "Run first scenario", num: "6" },
  ];

  function persistStep(key) {
    lsSetBool(`step.${key}`, state.steps[key].done);
    lsSet("currentStep", String(state.currentStep));
  }

  function h(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "dataset") Object.assign(el.dataset, v);
      else el.setAttribute(k, v);
    }
    for (const child of [].concat(children)) {
      if (child == null || child === false) continue;
      el.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return el;
  }

  function toast(message, kind = "info") {
    if (typeof window.cocoToast === "function") {
      window.cocoToast(message, kind);
      return;
    }
    console.info(`[coco.wizard ${kind}]`, message);
  }

  function statusPill(text, stateAttr) {
    const pill = h("span", { class: "wizard-status", "data-state": stateAttr || "" });
    pill.appendChild(h("span", { class: "wizard-status-dot" }));
    pill.appendChild(document.createTextNode(text));
    return pill;
  }

  function codeBlock(lines) {
    const pre = h("pre", { class: "wizard-code" });
    lines.forEach((line, idx) => {
      if (idx > 0) pre.appendChild(document.createTextNode("\n"));
      pre.appendChild(h("span", { class: "prompt" }, "$ "));
      pre.appendChild(document.createTextNode(line));
    });
    return pre;
  }

  function renderRail() {
    const rail = document.getElementById("wizard-rail");
    if (!rail) return;
    rail.innerHTML = "";
    STEPS.forEach((step, idx) => {
      const classes = ["wizard-step"];
      if (idx === state.currentStep) classes.push("active");
      if (state.steps[step.key].done) classes.push("done");
      rail.appendChild(
        h(
          "div",
          {
            class: classes.join(" "),
            onclick: () => gotoStep(idx),
          },
          [
            h("div", { class: "wizard-step-num" }, step.num),
            h("div", { class: "wizard-step-label" }, step.label),
          ],
        ),
      );
    });
  }

  function gotoStep(idx) {
    state.currentStep = Math.max(0, Math.min(STEPS.length - 1, idx));
    lsSet("currentStep", String(state.currentStep));
    render();
  }

  function markDone(key, next = true) {
    state.steps[key].done = true;
    persistStep(key);
    if (next) {
      const pos = STEPS.findIndex((s) => s.key === key);
      if (pos >= 0 && pos + 1 < STEPS.length) {
        state.currentStep = pos + 1;
        lsSet("currentStep", String(state.currentStep));
      }
    }
    render();
  }

  function render() {
    renderRail();
    const pane = document.getElementById("wizard-pane");
    if (!pane) return;
    pane.innerHTML = "";
    const step = STEPS[state.currentStep];
    const rendererName = `render_${step.key}`;
    const renderer = renderers[rendererName];
    if (renderer) renderer(pane);
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  }

  // ---- Step renderers -----------------------------------------------

  const renderers = {
    render_health(pane) {
      pane.appendChild(h("h3", {}, "Gateway health"));
      pane.appendChild(
        h(
          "p",
          { class: "lede-sm" },
          "Check that the CoCo gateway is up, packs are loaded, and the audit DB is writable before you bring Twenty online.",
        ),
      );
      const actions = h("div", { class: "wizard-actions" });
      const status = state.steps.health.lastStatus;
      actions.appendChild(
        h(
          "button",
          {
            class: "btn btn-primary",
            onclick: runHealthCheck,
          },
          [h("i", { "data-lucide": "activity" }), document.createTextNode("Check /health")],
        ),
      );
      if (status) actions.appendChild(statusPill(status.text, status.state));
      pane.appendChild(actions);

      if (state.steps.health.lastPayload) {
        const pre = h("div", { class: "wizard-output" });
        pre.textContent = JSON.stringify(state.steps.health.lastPayload, null, 2);
        pane.appendChild(pre);
      }
    },

    render_twenty(pane) {
      pane.appendChild(h("h3", {}, "Start Twenty CRM"));
      pane.appendChild(
        h(
          "p",
          { class: "lede-sm" },
          "Run the bootstrap script in a tmux session. First run pulls Docker images (~5 min); subsequent runs boot in under a minute.",
        ),
      );
      pane.appendChild(
        codeBlock([
          "tmux new-session -d -s twenty_up -c /mnt/khoa/coco/coco-trust-layer",
          "tmux send-keys -t twenty_up 'bash scripts/setup_twenty.sh 2>&1 | tee logs/twenty_up.log' Enter",
        ]),
      );
      pane.appendChild(
        h(
          "p",
          { class: "lede-sm" },
          "When the UI is ready, open it and create your admin account. Then come back to step 3.",
        ),
      );

      const urlField = h("div", { class: "wizard-field" }, [
        h("label", { for: "wizard-twenty-url" }, "Twenty URL"),
        h("input", {
          id: "wizard-twenty-url",
          type: "url",
          value: state.twentyUrl,
          oninput: (e) => {
            state.twentyUrl = e.target.value.trim() || DEFAULT_TWENTY_URL;
            lsSet("twentyUrl", state.twentyUrl);
          },
        }),
      ]);
      pane.appendChild(urlField);

      const actions = h("div", { class: "wizard-actions" });
      actions.appendChild(
        h(
          "a",
          {
            class: "btn btn-primary",
            href: state.twentyUrl,
            target: "_blank",
            rel: "noopener",
          },
          [h("i", { "data-lucide": "external-link" }), document.createTextNode("Open Twenty")],
        ),
      );
      actions.appendChild(
        h(
          "button",
          {
            class: "btn btn-ghost",
            onclick: () => markDone("twenty"),
          },
          [h("i", { "data-lucide": "check" }), document.createTextNode("Twenty is up — next")],
        ),
      );
      if (state.steps.twenty.lastStatus) {
        actions.appendChild(
          statusPill(state.steps.twenty.lastStatus.text, state.steps.twenty.lastStatus.state),
        );
      }
      pane.appendChild(actions);
    },

    render_connect(pane) {
      pane.appendChild(h("h3", {}, "Connect your Twenty API key"));
      pane.appendChild(
        h(
          "p",
          { class: "lede-sm" },
          "In Twenty: Settings → Developers → API keys → Create key. Copy the token and paste it here. The key stays in your browser — the gateway uses it per-request only.",
        ),
      );

      pane.appendChild(
        h("div", { class: "wizard-field" }, [
          h("label", { for: "wizard-base-url" }, "Twenty base URL"),
          h("input", {
            id: "wizard-base-url",
            type: "url",
            value: state.twentyUrl,
            oninput: (e) => {
              state.twentyUrl = e.target.value.trim() || DEFAULT_TWENTY_URL;
              lsSet("twentyUrl", state.twentyUrl);
            },
          }),
        ]),
      );

      pane.appendChild(
        h("div", { class: "wizard-field" }, [
          h("label", { for: "wizard-api-key" }, "API key"),
          h("input", {
            id: "wizard-api-key",
            type: "password",
            placeholder: "eyJhbGciOi...",
            value: state.apiKey,
            autocomplete: "off",
            oninput: (e) => {
              state.apiKey = e.target.value.trim();
              lsSet("apiKey", state.apiKey);
            },
          }),
        ]),
      );

      const actions = h("div", { class: "wizard-actions" });
      actions.appendChild(
        h(
          "button",
          {
            class: "btn btn-primary",
            onclick: runConnectTest,
          },
          [h("i", { "data-lucide": "plug" }), document.createTextNode("Test connection")],
        ),
      );
      const status = state.steps.connect.lastStatus;
      if (status) actions.appendChild(statusPill(status.text, status.state));
      pane.appendChild(actions);

      if (state.steps.connect.workspace) {
        pane.appendChild(
          h(
            "div",
            { class: "wizard-callout" },
            `Connected — ${state.steps.connect.workspace}. You can advance to step 4.`,
          ),
        );
      }
    },

    render_seed(pane) {
      pane.appendChild(h("h3", {}, "Seed fixture data"));
      pane.appendChild(
        h(
          "p",
          { class: "lede-sm" },
          "Creates 5 companies, 10 people, and 3 opportunities in Twenty, then writes their IDs to data/twenty/fixtures/seeded.json. Idempotent — safe to re-run.",
        ),
      );
      pane.appendChild(
        codeBlock([
          "# runs against your current Twenty + API key",
          "python scripts/seed_twenty.py",
        ]),
      );

      const actions = h("div", { class: "wizard-actions" });
      actions.appendChild(
        h(
          "button",
          {
            class: "btn btn-primary",
            onclick: runSeed,
            disabled: !state.apiKey ? "" : null,
          },
          [h("i", { "data-lucide": "database" }), document.createTextNode("Run seed")],
        ),
      );
      if (state.steps.seed.lastStatus) {
        actions.appendChild(
          statusPill(state.steps.seed.lastStatus.text, state.steps.seed.lastStatus.state),
        );
      }
      actions.appendChild(
        h(
          "button",
          {
            class: "btn btn-ghost",
            onclick: () => markDone("seed"),
          },
          [h("i", { "data-lucide": "check" }), document.createTextNode("I seeded manually — next")],
        ),
      );
      pane.appendChild(actions);

      if (state.steps.seed.counts) {
        const c = state.steps.seed.counts;
        pane.appendChild(
          h(
            "div",
            { class: "wizard-callout" },
            `Seeded: ${c.companies || 0} companies · ${c.people || 0} people · ${c.opportunities || 0} opportunities.`,
          ),
        );
      }
      if (state.steps.seed.logTail) {
        const pre = h("div", { class: "wizard-output" });
        pre.textContent = state.steps.seed.logTail;
        pane.appendChild(pre);
      }
      if (!state.apiKey) {
        pane.appendChild(
          h(
            "div",
            { class: "wizard-callout" },
            "Paste your API key in step 3 first, or run the command manually in tmux.",
          ),
        );
      }
    },

    render_extension(pane) {
      pane.appendChild(h("h3", {}, "Install the CoCo browser extension"));
      pane.appendChild(
        h(
          "p",
          { class: "lede-sm" },
          "The extension auto-injects the CoCo SDK into your Twenty tab and renders a floating verdict badge. Install it once, then the SDK follows you across sessions.",
        ),
      );

      const actions = h("div", { class: "wizard-actions" });
      actions.appendChild(
        h(
          "a",
          {
            class: "btn btn-primary",
            href: "/browser-extension.zip",
            download: "coco-browser-extension.zip",
          },
          [h("i", { "data-lucide": "download" }), document.createTextNode("Download extension (.zip)")],
        ),
      );
      actions.appendChild(
        h(
          "a",
          {
            class: "btn btn-ghost",
            href: "chrome://extensions",
            target: "_blank",
            rel: "noopener",
            onclick: (e) => {
              e.preventDefault();
              toast("Chrome blocks direct links to chrome://extensions. Copy-paste the URL manually.", "warn");
            },
          },
          [h("i", { "data-lucide": "puzzle" }), document.createTextNode("Open chrome://extensions")],
        ),
      );
      actions.appendChild(
        h(
          "button",
          {
            class: "btn btn-ghost",
            onclick: () => markDone("extension"),
          },
          [h("i", { "data-lucide": "check" }), document.createTextNode("Extension loaded — next")],
        ),
      );
      pane.appendChild(actions);

      pane.appendChild(
        h("div", { class: "wizard-callout" }, [
          h("strong", {}, "Install steps:"),
          h("ol", { style: "margin: 6px 0 0 18px; padding: 0;" }, [
            h("li", {}, "Unzip the archive anywhere on disk."),
            h("li", {}, "Open chrome://extensions in Chrome or Edge."),
            h("li", {}, "Toggle Developer mode (top right)."),
            h("li", {}, "Click Load unpacked → pick the browser-extension/ folder."),
            h("li", {}, `Click the CoCo extension icon → gateway URL is ${GATEWAY_ORIGIN}.`),
            h("li", {}, `Open ${state.twentyUrl} → the floating CoCo badge appears bottom-right.`),
          ]),
        ]),
      );

      const legacy = h("details", { class: "wizard-legacy" });
      legacy.appendChild(h("summary", {}, "Legacy fallback — bookmarklet / DevTools snippet"));
      const pre = h("pre");
      pre.textContent = `var s=document.createElement('script');s.src='${GATEWAY_ORIGIN}/sdk/coco-sdk.js';s.onload=function(){var i=document.createElement('script');i.src='${GATEWAY_ORIGIN}/sdk/inject.js';document.head.appendChild(i);};document.head.appendChild(s);`;
      legacy.appendChild(pre);
      pane.appendChild(legacy);
    },

    render_scenario(pane) {
      pane.appendChild(h("h3", {}, "Run your first live scenario"));
      pane.appendChild(
        h(
          "p",
          { class: "lede-sm" },
          "Fires deal_stage_move_allow against live Twenty: the agent reads state, the gateway returns ALLOW, and Twenty actually advances the deal stage. The audit row lands immediately.",
        ),
      );

      const actions = h("div", { class: "wizard-actions" });
      actions.appendChild(
        h(
          "button",
          {
            class: "btn btn-primary",
            onclick: () => runScenario("deal_stage_move_allow"),
          },
          [h("i", { "data-lucide": "play" }), document.createTextNode("Run deal_stage_move_allow")],
        ),
      );
      actions.appendChild(
        h(
          "button",
          {
            class: "btn btn-ghost",
            onclick: () => runScenario("deal_stage_move_block_no_owner"),
          },
          [h("i", { "data-lucide": "shield-off" }), document.createTextNode("Try a BLOCK case")],
        ),
      );
      if (state.steps.scenario.lastStatus) {
        actions.appendChild(
          statusPill(state.steps.scenario.lastStatus.text, state.steps.scenario.lastStatus.state),
        );
      }
      pane.appendChild(actions);

      if (state.steps.scenario.runError) {
        const err = h("div", { class: "wizard-callout", style: "background: var(--red-soft); color: var(--red); border-color: #fca5a5;" });
        err.appendChild(h("strong", {}, "Scenario run failed"));
        err.appendChild(document.createElement("br"));
        err.appendChild(document.createTextNode(state.steps.scenario.runError));
        pane.appendChild(err);
      }

      const v = state.steps.scenario.verdict;
      if (v) {
        const card = h("div", { class: "wizard-verdict", "data-verdict": v.verdict });
        card.appendChild(
          h("div", { class: "wizard-verdict-head" }, [
            h("i", {
              "data-lucide":
                v.verdict === "ALLOW"
                  ? "shield-check"
                  : v.verdict === "BLOCK"
                    ? "shield-alert"
                    : "shield-question",
            }),
            document.createTextNode(`${v.verdict} · ${v.pack_id || "—"}`),
          ]),
        );
        card.appendChild(
          h(
            "p",
            { class: "wizard-verdict-reason" },
            v.primary_reason || "Verdict rendered — see audit ledger for full check list.",
          ),
        );
        if (v.mutation_error) {
          card.appendChild(
            h(
              "p",
              { class: "wizard-verdict-reason", style: "color: var(--red);" },
              `Mutation error: ${v.mutation_error}`,
            ),
          );
        } else if (v.verdict === "ALLOW" && v.twenty_response) {
          card.appendChild(
            h(
              "p",
              { class: "wizard-verdict-reason", style: "color: var(--green);" },
              "Twenty mutation applied ✓",
            ),
          );
        }
        pane.appendChild(card);
      }
    },
  };

  // ---- Actions ------------------------------------------------------

  async function runHealthCheck() {
    const step = state.steps.health;
    step.lastStatus = { text: "Checking…", state: "warn" };
    render();
    try {
      const resp = await fetch(`${GATEWAY_ORIGIN}/health`);
      const payload = await resp.json();
      step.lastPayload = payload;
      if (resp.ok && payload.status === "ok") {
        step.lastStatus = {
          text: `OK · ${payload.packs_loaded} packs loaded`,
          state: "ok",
        };
        markDone("health");
        return;
      }
      step.lastStatus = { text: `Bad status: ${resp.status}`, state: "err" };
    } catch (err) {
      step.lastStatus = { text: `Gateway unreachable: ${err}`, state: "err" };
      step.lastPayload = null;
    }
    render();
  }

  async function runConnectTest() {
    const step = state.steps.connect;
    if (!state.apiKey) {
      step.lastStatus = { text: "Paste an API key first", state: "err" };
      render();
      return;
    }
    step.lastStatus = { text: "Testing connection…", state: "warn" };
    render();
    try {
      const resp = await fetch(`${GATEWAY_ORIGIN}/api/twenty/test-connection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: state.apiKey, base_url: state.twentyUrl }),
      });
      const payload = await resp.json();
      if (payload.ok) {
        step.workspace = payload.workspace_name || payload.base_url;
        step.lastStatus = { text: "Connected", state: "ok" };
        markDone("connect");
        return;
      }
      step.lastStatus = { text: payload.error || "Connection failed", state: "err" };
    } catch (err) {
      step.lastStatus = { text: `Request failed: ${err}`, state: "err" };
    }
    render();
  }

  async function runSeed() {
    const step = state.steps.seed;
    if (!state.apiKey) {
      step.lastStatus = { text: "API key required", state: "err" };
      render();
      return;
    }
    step.lastStatus = { text: "Running seed_twenty.py…", state: "warn" };
    render();
    try {
      const resp = await fetch(`${GATEWAY_ORIGIN}/api/twenty/seed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: state.apiKey, base_url: state.twentyUrl }),
      });
      if (resp.status === 403) {
        step.lastStatus = {
          text: "Seed endpoint disabled (set COCO_ALLOW_WIZARD_EXEC=1 on the gateway)",
          state: "err",
        };
        render();
        return;
      }
      const payload = await resp.json();
      step.counts = payload.counts;
      step.logTail = payload.log_tail;
      if (payload.ok) {
        const total = (payload.counts?.companies || 0) + (payload.counts?.people || 0) + (payload.counts?.opportunities || 0);
        step.lastStatus = { text: `Seeded (${total} records)`, state: "ok" };
        markDone("seed");
        return;
      }
      step.lastStatus = { text: payload.error || "Seed failed", state: "err" };
    } catch (err) {
      step.lastStatus = { text: `Seed request failed: ${err}`, state: "err" };
    }
    render();
  }

  async function runScenario(scenarioId) {
    const step = state.steps.scenario;
    step.lastStatus = { text: `Running ${scenarioId}…`, state: "warn" };
    step.verdict = null;
    step.runError = null;
    render();
    try {
      const url = `${GATEWAY_ORIGIN}/api/scenarios/${encodeURIComponent(scenarioId)}/run?driver=twenty`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: state.apiKey || null,
          base_url: state.twentyUrl || null,
        }),
      });
      const payload = await resp.json();
      if (!resp.ok) {
        step.lastStatus = {
          text: `HTTP ${resp.status}: ${payload.detail || "error"}`,
          state: "err",
        };
        render();
        return;
      }

      // Agent returns { decision: {...}, twenty_response, error? }
      // — when Twenty is unreachable or returns non-2xx, decision is
      // null and `error` carries the message.
      if (!payload.decision) {
        step.runError = payload.error || "Scenario run returned no decision";
        step.lastStatus = { text: "Run failed", state: "err" };
        render();
        return;
      }

      const decision = payload.decision;
      step.verdict = {
        verdict: decision.verdict,
        pack_id: decision.pack_id || payload.pack_id || scenarioId,
        primary_reason: decision.primary_reason,
        checks: decision.checks || [],
        mutation_error: payload.mutation_error,
        twenty_response: payload.twenty_response,
      };
      step.lastStatus = {
        text: decision.verdict || "?",
        state:
          decision.verdict === "ALLOW"
            ? "ok"
            : decision.verdict === "BLOCK"
              ? "err"
              : "warn",
      };
      markDone("scenario");
    } catch (err) {
      step.lastStatus = { text: `Run failed: ${err}`, state: "err" };
      render();
    }
  }

  // ---- Boot ---------------------------------------------------------

  function boot() {
    if (!document.getElementById("wizard")) return;
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
