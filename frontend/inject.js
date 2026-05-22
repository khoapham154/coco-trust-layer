/*!
 * Coco Trust Layer — Twenty CRM overlay.
 *
 * Auto-loaded into a Twenty tab. Depends on coco-sdk.js (loaded first).
 *
 * What it does:
 *   1. Calls Coco.init with the gateway URL it was served from.
 *   2. Renders a small badge in the corner inside a Shadow DOM root so
 *      Twenty's CSS cannot leak in or out.
 *   3. Listens for SDK verdicts (Coco.onVerdict) and demo events
 *      (coco:demo-verdict). On every verdict, it shows a verdict card.
 *      BLOCK verdicts also surface a blocked-action modal with
 *      Cancel / See policy / Request override choices.
 *   4. The "See policy" panel pulls /api/packs/<id>/yaml from the
 *      gateway and highlights the rule that fired.
 */
(function () {
  "use strict";

  if (window.__COCO_INJECTED__) {
    console.info("[Coco] already injected — skipping");
    return;
  }
  window.__COCO_INJECTED__ = true;

  /* ---------- gateway URL resolution ---------- */
  function resolveGatewayUrl() {
    const fromAttr = document.currentScript && document.currentScript.dataset.gateway;
    if (fromAttr) return fromAttr.replace(/\/$/, "");
    if (window.__COCO_GATEWAY_URL) return window.__COCO_GATEWAY_URL.replace(/\/$/, "");
    const scripts = Array.from(document.querySelectorAll("script"));
    const sdk = scripts.find((s) => s.src && /\/sdk\/coco-sdk\.js/.test(s.src));
    if (sdk) { try { return new URL(sdk.src).origin; } catch (_) { /* noop */ } }
    return "http://localhost:8080";
  }

  function waitForSdk(cb, attempts) {
    attempts = attempts || 0;
    if (window.Coco && typeof window.Coco.init === "function") return cb();
    if (attempts > 50) return console.error("[Coco] SDK never appeared");
    setTimeout(() => waitForSdk(cb, attempts + 1), 100);
  }

  /* ---------- shadow root + styles ---------- */
  let host, root;
  function mountShadow() {
    host = document.createElement("div");
    host.id = "coco-overlay-host";
    host.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;z-index:2147483646;pointer-events:none";
    document.documentElement.appendChild(host);
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
<style>
  :host, * { box-sizing: border-box; }
  .root {
    font-family: "Inter", system-ui, -apple-system, sans-serif;
    font-size: 13px;
    color: #1a1a1f;
    line-height: 1.5;
  }

  /* ------ BADGE ------ */
  .badge {
    position: fixed;
    right: 18px;
    bottom: 18px;
    background: #fff;
    border: 1px solid #e6e6ea;
    border-radius: 10px;
    box-shadow: 0 4px 20px rgba(15, 15, 18, 0.10);
    padding: 10px 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    pointer-events: auto;
    transition: box-shadow 0.2s ease, transform 0.15s ease;
  }
  .badge:hover { box-shadow: 0 8px 28px rgba(15, 15, 18, 0.14); }
  .badge-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #9b9ba8;
  }
  .badge-dot[data-s="ok"]        { background: #15803d; box-shadow: 0 0 0 3px #dcfce7; }
  .badge-dot[data-s="err"]       { background: #b91c1c; box-shadow: 0 0 0 3px #fee2e2; }
  .badge-dot[data-s="validating"]{ background: #b45309; box-shadow: 0 0 0 3px #fef3c7; animation: pulse 1.2s ease-in-out infinite; }
  @keyframes pulse {
    0%,100% { opacity: 1; }
    50%     { opacity: 0.5; }
  }
  .badge-brand {
    background: linear-gradient(135deg, #a855f7 0%, #5b21b6 100%);
    color: #fff;
    font-weight: 700;
    font-size: 11px;
    border-radius: 5px;
    padding: 2px 6px;
  }
  .badge-text { font-size: 12px; color: #3a3a45; }
  .badge-btn {
    margin-left: 8px;
    background: #0a0a0c;
    color: #fff;
    border: none;
    font: 600 11px "Inter", sans-serif;
    padding: 5px 9px;
    border-radius: 5px;
    cursor: pointer;
  }
  .badge-btn:hover { background: #000; }
  .badge-x {
    background: transparent;
    border: none;
    color: #9b9ba8;
    font-size: 14px;
    cursor: pointer;
    padding: 0 2px;
    line-height: 1;
  }
  .badge-x:hover { color: #1a1a1f; }

  /* ------ VERDICT CARD ------ */
  .card {
    position: fixed;
    right: 18px;
    bottom: 70px;
    width: 380px;
    max-width: calc(100vw - 36px);
    background: #fff;
    border: 1px solid #e6e6ea;
    border-radius: 12px;
    box-shadow: 0 16px 48px rgba(15, 15, 18, 0.18);
    overflow: hidden;
    pointer-events: auto;
    opacity: 0;
    transform: translateY(10px);
    transition: opacity 0.25s ease, transform 0.25s ease;
  }
  .card[data-open="true"] { opacity: 1; transform: translateY(0); }
  .card-stripe { height: 4px; background: #9b9ba8; }
  .card[data-v="ALLOW"]    .card-stripe { background: #15803d; }
  .card[data-v="BLOCK"]    .card-stripe { background: #b91c1c; }
  .card[data-v="ESCALATE"] .card-stripe { background: #b45309; }
  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 12px 16px 6px;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 9px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    border: 1px solid;
  }
  .pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .pill[data-v="ALLOW"]    { color: #15803d; background: #dcfce7; border-color: #bbf7d0; }
  .pill[data-v="BLOCK"]    { color: #b91c1c; background: #fee2e2; border-color: #fecaca; }
  .pill[data-v="ESCALATE"] { color: #b45309; background: #fef3c7; border-color: #fde68a; }
  .pill[data-v="INFO"]     { color: #3a3a45; background: #f4f4f5; border-color: #e6e6ea; }
  .card-close {
    background: transparent;
    border: none;
    font-size: 15px;
    color: #6a6a78;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    line-height: 1;
  }
  .card-close:hover { color: #0a0a0c; background: #f4f4f5; }
  .card-reason {
    padding: 4px 16px 10px;
    font-size: 13px;
    color: #1a1a1f;
    line-height: 1.45;
  }
  .card-meta {
    padding: 0 16px 10px;
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .card-tag {
    font: 11px "JetBrains Mono", ui-monospace, monospace;
    background: #f4f4f5;
    border: 1px solid #e6e6ea;
    border-radius: 4px;
    padding: 2px 6px;
    color: #3a3a45;
  }
  .card-detail {
    padding: 8px 16px 12px;
    border-top: 1px solid #f4f4f5;
    background: #fafafa;
    font-size: 12px;
    color: #3a3a45;
  }
  .card-detail-row { display: flex; gap: 10px; }
  .card-detail-row + .card-detail-row { margin-top: 4px; }
  .card-detail-key {
    flex-shrink: 0;
    width: 76px;
    font-weight: 600;
    color: #6a6a78;
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 0.06em;
    padding-top: 1px;
  }
  .card-detail-value { flex: 1; word-break: break-word; }
  .card-detail-value code {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    background: #fff;
    border: 1px solid #e6e6ea;
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 11px;
  }
  .card-actions {
    display: flex;
    gap: 8px;
    padding: 10px 16px 14px;
    border-top: 1px solid #f4f4f5;
    background: #fafafa;
  }
  .card-btn {
    flex: 1;
    padding: 7px 10px;
    border-radius: 7px;
    font: 600 12px "Inter", sans-serif;
    cursor: pointer;
    border: 1px solid #d4d4dc;
    background: #fff;
    color: #1a1a1f;
    transition: background 0.12s ease, border-color 0.12s ease;
  }
  .card-btn:hover  { border-color: #0a0a0c; }
  .card-btn:disabled { opacity: 0.55; cursor: not-allowed; }
  .card-btn-primary {
    background: #0a0a0c;
    color: #fff;
    border-color: #0a0a0c;
  }
  .card-btn-primary:hover { background: #000; }

  /* ------ BLOCKED MODAL ------ */
  .modal-scrim {
    position: fixed;
    inset: 0;
    background: rgba(15, 15, 18, 0.45);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
  }
  .modal-scrim[data-open="true"] { opacity: 1; pointer-events: auto; }
  .modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -45%);
    width: 460px;
    max-width: calc(100vw - 36px);
    background: #fff;
    border-radius: 14px;
    box-shadow: 0 24px 60px rgba(15, 15, 18, 0.30);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease, transform 0.2s ease;
    overflow: hidden;
  }
  .modal[data-open="true"] {
    opacity: 1;
    pointer-events: auto;
    transform: translate(-50%, -50%);
  }
  .modal-head {
    padding: 18px 20px 8px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .modal-head h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: #0a0a0c;
  }
  .modal-body {
    padding: 4px 20px 16px;
    font-size: 14px;
    color: #1a1a1f;
    line-height: 1.55;
  }
  .modal-policy {
    margin-top: 12px;
    padding: 10px 12px;
    background: #f7f7f8;
    border: 1px solid #e6e6ea;
    border-radius: 8px;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 11px;
    color: #3a3a45;
  }
  .modal-foot {
    padding: 12px 20px 18px;
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    background: #fafafa;
    border-top: 1px solid #f4f4f5;
  }

  /* ------ POLICY DRAWER ------ */
  .drawer {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: 460px;
    max-width: 100vw;
    background: #fff;
    border-left: 1px solid #e6e6ea;
    box-shadow: -16px 0 48px rgba(15, 15, 18, 0.18);
    transform: translateX(100%);
    transition: transform 0.3s cubic-bezier(0.2, 0.7, 0.2, 1);
    pointer-events: auto;
    display: flex;
    flex-direction: column;
  }
  .drawer[data-open="true"] { transform: translateX(0); }
  .drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid #e6e6ea;
  }
  .drawer-head h3 { margin: 0; font-size: 14px; font-weight: 600; }
  .drawer-body {
    flex: 1;
    padding: 16px 18px;
    overflow-y: auto;
  }
  .drawer-section { margin-bottom: 16px; }
  .drawer-section h4 {
    margin: 0 0 6px;
    font-size: 10px;
    color: #6a6a78;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
  }
  .yaml-pre {
    background: #0d0d10;
    color: #e6e6ea;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 11.5px;
    line-height: 1.5;
    padding: 12px;
    border-radius: 8px;
    margin: 0;
    white-space: pre;
    overflow: auto;
    max-height: 460px;
  }
  .yaml-pre .hl { background: rgba(124, 58, 237, 0.32); color: #fff; display: block; }
  .yaml-pre .com { color: #7a7a85; }
  .yaml-pre .key { color: #c4a4ff; }
  .yaml-pre .str { color: #d3e8b8; }
  .yaml-pre .num { color: #f3bd75; }
  .yaml-pre .bool { color: #ff9aa2; }
</style>

<div class="root">
  <div class="badge" id="badge" hidden>
    <span class="badge-brand">Coco</span>
    <span class="badge-dot" id="badge-dot" data-s="ok"></span>
    <span class="badge-text" id="badge-text">Watching Twenty</span>
    <button class="badge-btn" id="badge-validate">Validate</button>
    <button class="badge-x" id="badge-close" title="Hide">✕</button>
  </div>

  <div class="card" id="card" hidden>
    <div class="card-stripe"></div>
    <div class="card-head">
      <span class="pill" id="card-pill" data-v="ALLOW">ALLOW</span>
      <button class="card-close" id="card-close">✕</button>
    </div>
    <div class="card-reason" id="card-reason">All checks passed.</div>
    <div class="card-meta" id="card-meta"></div>
    <div class="card-detail" id="card-detail" hidden></div>
    <div class="card-actions" id="card-actions"></div>
  </div>

  <div class="modal-scrim" id="modal-scrim"></div>
  <div class="modal" id="modal">
    <div class="modal-head">
      <span class="pill" data-v="BLOCK">BLOCKED</span>
      <h3 id="modal-title">Action blocked by policy</h3>
    </div>
    <div class="modal-body" id="modal-body"></div>
    <div class="modal-foot" id="modal-foot"></div>
  </div>

  <div class="drawer" id="drawer">
    <div class="drawer-head">
      <h3 id="drawer-title">Policy</h3>
      <button class="card-close" id="drawer-close">✕</button>
    </div>
    <div class="drawer-body" id="drawer-body"></div>
  </div>
</div>
`;
  }

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
  function $$(sel) { return root.querySelector(sel); }
  function $$$(sel) { return Array.from(root.querySelectorAll(sel)); }

  /* ---------- gateway helpers ---------- */
  function gw() { return window.__COCO_GATEWAY_URL || "http://localhost:8080"; }

  async function pingHealth() {
    const dot = $$("#badge-dot"); const text = $$("#badge-text");
    try {
      const r = await fetch(gw() + "/health");
      const j = await r.json();
      dot.dataset.s = j.status === "ok" ? "ok" : "err";
      text.textContent = j.status === "ok" ? `Gateway · ${j.packs_loaded} packs` : "Gateway issue";
    } catch (_) {
      dot.dataset.s = "err";
      text.textContent = "Gateway offline";
    }
  }

  /* ---------- verdict card ---------- */
  function showCard(opts) {
    const card = $$("#card");
    const verdict = opts.verdict || "INFO";
    card.dataset.v = verdict;
    $$("#card-pill").dataset.v = verdict;
    $$("#card-pill").textContent = verdict;
    $$("#card-reason").textContent = opts.primary_reason || opts.reason || "—";

    const meta = $$("#card-meta"); meta.innerHTML = "";
    if (opts.pack_id) {
      const t = document.createElement("span");
      t.className = "card-tag";
      t.textContent = opts.pack_id;
      meta.appendChild(t);
    }
    const failing = ((opts.decision && opts.decision.checks) || []).find((c) => c && c.passed === false);
    if (failing) {
      const t = document.createElement("span");
      t.className = "card-tag";
      t.textContent = "rule: " + failing.check_id;
      meta.appendChild(t);
    }

    const detail = $$("#card-detail");
    detail.innerHTML = "";
    const rows = [];
    const sum = opts.action_summary || {};
    if (sum.deal_name) rows.push(["Deal", esc(sum.deal_name)]);
    if (sum.intent)    rows.push(["Tried", esc(sum.intent)]);
    if (failing && failing.observed !== undefined && failing.observed !== null) {
      rows.push(["Observed", `<code>${esc(JSON.stringify(failing.observed))}</code>`]);
    }
    if (rows.length) {
      detail.hidden = false;
      detail.innerHTML = rows.map(([k, v]) =>
        `<div class="card-detail-row"><span class="card-detail-key">${k}</span><span class="card-detail-value">${v}</span></div>`
      ).join("");
    } else {
      detail.hidden = true;
    }

    const actions = $$("#card-actions"); actions.innerHTML = "";
    if (verdict === "BLOCK" && opts.decision_id) {
      const btn = document.createElement("button");
      btn.className = "card-btn card-btn-primary";
      btn.textContent = "See policy";
      btn.onclick = () => openPolicyDrawer(opts.pack_id, failing && failing.check_id);
      actions.appendChild(btn);
      const ov = document.createElement("button");
      ov.className = "card-btn";
      ov.textContent = "Request override";
      ov.onclick = () => requestOverride(opts.decision_id, opts.pack_id, ov);
      actions.appendChild(ov);
    } else if (verdict === "BLOCK") {
      const btn = document.createElement("button");
      btn.className = "card-btn card-btn-primary";
      btn.textContent = "See policy";
      btn.onclick = () => openPolicyDrawer(opts.pack_id, failing && failing.check_id);
      actions.appendChild(btn);
    } else if (verdict === "ALLOW" || verdict === "ESCALATE") {
      const btn = document.createElement("button");
      btn.className = "card-btn";
      btn.textContent = "Open dashboard";
      btn.onclick = () => window.open(gw() + "/dashboard#/live", "_blank");
      actions.appendChild(btn);
    }

    card.hidden = false;
    requestAnimationFrame(() => { card.dataset.open = "true"; });
    if (verdict !== "BLOCK") {
      clearTimeout(card._timer);
      card._timer = setTimeout(hideCard, 14000);
    }
  }

  function hideCard() {
    const card = $$("#card");
    card.dataset.open = "false";
    setTimeout(() => { card.hidden = true; }, 280);
  }

  $$ && (function bindCardClose() {
    // bind after mount
    setTimeout(() => { $$("#card-close").onclick = hideCard; }, 0);
  })();

  /* ---------- blocked modal ---------- */
  function showBlockedModal(opts) {
    const m = $$("#modal"); const s = $$("#modal-scrim");
    $$("#modal-title").textContent = "Action blocked by policy";
    const body = $$("#modal-body");
    const failing = ((opts.decision && opts.decision.checks) || []).find((c) => c && c.passed === false);
    body.innerHTML = `
      <p style="margin:0;">${esc(opts.primary_reason || opts.reason || "Action blocked.")}</p>
      <div class="modal-policy">
        <strong>Policy:</strong> ${esc(opts.pack_id || "—")}<br/>
        ${failing ? `<strong>Rule:</strong> ${esc(failing.check_id)} (${esc(failing.kind)})` : ""}
      </div>
    `;
    const foot = $$("#modal-foot"); foot.innerHTML = "";

    const seePolicy = document.createElement("button");
    seePolicy.className = "card-btn";
    seePolicy.textContent = "See policy";
    seePolicy.onclick = () => { closeBlockedModal(); openPolicyDrawer(opts.pack_id, failing && failing.check_id); };
    foot.appendChild(seePolicy);

    if (opts.decision_id) {
      const ov = document.createElement("button");
      ov.className = "card-btn";
      ov.textContent = "Request override";
      ov.onclick = () => { closeBlockedModal(); requestOverride(opts.decision_id, opts.pack_id); };
      foot.appendChild(ov);
    }

    const cancel = document.createElement("button");
    cancel.className = "card-btn card-btn-primary";
    cancel.textContent = "Cancel";
    cancel.onclick = closeBlockedModal;
    foot.appendChild(cancel);

    m.dataset.open = "true";
    s.dataset.open = "true";
    setTimeout(() => cancel.focus(), 60);
  }
  function closeBlockedModal() {
    $$("#modal").dataset.open = "false";
    $$("#modal-scrim").dataset.open = "false";
  }

  /* ---------- policy drawer ---------- */
  async function openPolicyDrawer(packId, ruleId) {
    if (!packId) return;
    const d = $$("#drawer"); const b = $$("#drawer-body");
    $$("#drawer-title").textContent = "Policy · " + packId;
    b.innerHTML = `<div style="color:#6a6a78;font-size:12px">Loading…</div>`;
    d.dataset.open = "true";
    try {
      const r = await fetch(`${gw()}/api/packs/${encodeURIComponent(packId)}/yaml`);
      const yaml = await r.text();
      b.innerHTML = "";
      const section = document.createElement("div");
      section.className = "drawer-section";
      const h = document.createElement("h4"); h.textContent = "YAML"; section.appendChild(h);
      const pre = document.createElement("pre"); pre.className = "yaml-pre";
      pre.innerHTML = highlightYaml(yaml, ruleId);
      section.appendChild(pre);
      b.appendChild(section);
      const hl = pre.querySelector(".hl");
      if (hl) hl.scrollIntoView({ block: "center" });
    } catch (err) {
      b.innerHTML = `<div style="color:#b91c1c">Couldn't load policy: ${esc(err.message)}</div>`;
    }
  }
  function closePolicyDrawer() { $$("#drawer").dataset.open = "false"; }

  function highlightYaml(yaml, ruleId) {
    const lines = String(yaml || "").split("\n");
    let hlLine = -1;
    if (ruleId) {
      for (let i = 0; i < lines.length; i++) {
        if (/^\s*-\s*id:\s*/.test(lines[i]) && lines[i].includes(ruleId)) { hlLine = i; break; }
      }
    }
    return lines.map((raw, i) => {
      let line = esc(raw)
        .replace(/(#.*)$/, '<span class="com">$1</span>')
        .replace(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(:)/, '$1<span class="key">$2</span>$3')
        .replace(/(:\s*)(true|false)\b/g, '$1<span class="bool">$2</span>')
        .replace(/(:\s*)(-?\d+(?:\.\d+)?)\b/g, '$1<span class="num">$2</span>');
      if (hlLine >= 0 && i >= hlLine) {
        const baseIndent = (lines[hlLine].match(/^\s*/) || [""])[0].length;
        const curIndent = (raw.match(/^\s*/) || [""])[0].length;
        if (i === hlLine || (curIndent > baseIndent && raw.trim() !== "" && !raw.match(/^\s*-\s/))) {
          return `<span class="hl">${line}</span>`;
        }
      }
      return line;
    }).join("\n");
  }

  /* ---------- override flow ---------- */
  async function requestOverride(decisionId, packId, btn) {
    const comment = prompt("Why do you need this override?") || "";
    if (btn) { btn.disabled = true; btn.textContent = "Submitting…"; }
    try {
      const r = await fetch(`${gw()}/api/demo/escalate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision_id: decisionId, comment }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (btn) { btn.disabled = false; btn.textContent = j.detail || "Failed"; }
        return;
      }
      showCard({
        verdict: "ESCALATE",
        primary_reason: "Pending review · manager will be notified.",
        pack_id: packId,
        decision_id: j.id,
      });
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = "Failed: " + err.message; }
    }
  }

  /* ---------- guess pack from URL ---------- */
  function guessAction() {
    const path = location.pathname;
    if (/\/objects\/opportunities/.test(path)) {
      return {
        packId: "twenty.deal_stage_move",
        action: "move_stage",
        uiState: {
          deal: {
            owner: readText('[data-testid="record-detail-owner"]'),
            amount: Number(readText('[data-testid="record-detail-amount"]')) || 0,
            prev_stage_tasks_completed: true,
            is_sequential_stage_move: true,
            manager_field_filled: false,
            target_stage: (readText('[data-testid="record-detail-stage"]') || "").toLowerCase(),
          },
          user: { role: "sales" },
        },
      };
    }
    if (/\/objects\/people/.test(path)) {
      return {
        packId: "twenty.contact_delete",
        action: "delete_contact",
        uiState: { contact: { open_opportunity_count: 0, days_since_modified: 30 }, user: { role: "admin" } },
      };
    }
    return {
      packId: "twenty.field_update",
      action: "update_field",
      uiState: {
        record: { exists: true, archived: false },
        field_update: { required_fields_still_filled: true, email_format_valid: true },
      },
    };
  }
  function readText(sel) {
    const el = document.querySelector(sel);
    if (!el) return null;
    if (el.dataset && el.dataset.cocoValue) return el.dataset.cocoValue;
    return (el.textContent || "").trim() || null;
  }

  async function validateCurrentPage() {
    const dot = $$("#badge-dot"); const original = dot.dataset.s;
    dot.dataset.s = "validating";
    const guess = guessAction();
    try {
      await window.Coco.validate(guess.action, guess.uiState, guess.packId, "pre");
    } catch (err) {
      showCard({ verdict: "BLOCK", primary_reason: "Validate failed: " + err.message, pack_id: guess.packId });
    } finally {
      setTimeout(() => { dot.dataset.s = original || "ok"; }, 400);
    }
  }

  /* ---------- wiring ---------- */
  function bind() {
    $$("#badge-validate").addEventListener("click", validateCurrentPage);
    $$("#badge-close").addEventListener("click", () => { $$("#badge").hidden = true; });
    $$("#card-close").addEventListener("click", hideCard);
    $$("#modal-scrim").addEventListener("click", closeBlockedModal);
    $$("#drawer-close").addEventListener("click", closePolicyDrawer);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if ($$("#modal").dataset.open === "true") closeBlockedModal();
        else if ($$("#drawer").dataset.open === "true") closePolicyDrawer();
      }
    });

    if (window.Coco && typeof window.Coco.onVerdict === "function") {
      window.Coco.onVerdict((decision) => {
        const params = {
          verdict: decision.verdict,
          primary_reason: decision.primary_reason,
          pack_id: decision.pack_id,
          decision,
        };
        // For BLOCK, the modal is the headline UI — the small corner
        // card would compete for attention. Show only the modal.
        if (decision.verdict === "BLOCK") {
          showBlockedModal(params);
        } else {
          showCard(params);
        }
      });
    }

    window.addEventListener("coco:demo-verdict", (e) => {
      try { showCard(e.detail || {}); }
      catch (err) { console.error("[Coco] verdict render failed:", err); }
    });
  }

  function boot() {
    const url = resolveGatewayUrl();
    window.__COCO_GATEWAY_URL = url;
    waitForSdk(() => {
      try { window.Coco.init({ gatewayUrl: url, appId: "twenty" }); }
      catch (err) { console.error("[Coco] init failed:", err); return; }
      mountShadow();
      bind();
      $$("#badge").hidden = false;
      pingHealth();
      setInterval(pingHealth, 30000);
      console.info("[Coco] overlay live against", url);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
