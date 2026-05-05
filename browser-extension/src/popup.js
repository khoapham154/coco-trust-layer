/* Coco Trust Layer — popup script. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // Pre-populated so demo buttons work even if the user clicks before
  // chrome.storage round-trips (race we saw in 0.3.0).
  let currentSettings = {
    gatewayUrl: "http://localhost:8080",
    appId: "twenty",
    enabled: true,
  };

  async function ensureSettings() {
    try {
      const resp = await sendMsg({ type: "coco:getState" });
      if (resp && resp.settings && resp.settings.gatewayUrl) {
        currentSettings = resp.settings;
      }
    } catch (_) {
      /* keep defaults */
    }
    return currentSettings;
  }

  // --- status pill ---------------------------------------------------

  function paintStatus(lastHealth) {
    const pill = $("status-pill");
    const text = $("status-text");
    const packs = $("packs-loaded");
    if (!lastHealth) {
      pill.dataset.state = "unknown";
      text.textContent = "Not yet checked";
      packs.textContent = "";
      return;
    }
    pill.dataset.state = lastHealth.state;
    const labels = {
      ok: "Gateway healthy",
      warn: "Gateway degraded",
      err: "Gateway unreachable",
      off: "Extension disabled",
      unknown: "Not yet checked",
    };
    text.textContent = labels[lastHealth.state] || lastHealth.state;
    if (lastHealth.state === "ok" && Number.isInteger(lastHealth.packsLoaded)) {
      packs.textContent = `${lastHealth.packsLoaded} packs loaded`;
    } else if (lastHealth.state === "err") {
      packs.textContent = lastHealth.error || "";
    } else {
      packs.textContent = "";
    }
  }

  // --- service-worker bridge -----------------------------------------

  function sendMsg(message) {
    return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
  }

  async function load() {
    let settings = null;
    let lastHealth = null;
    try {
      const resp = await sendMsg({ type: "coco:getState" });
      if (resp) {
        settings = resp.settings || null;
        lastHealth = resp.lastHealth || null;
      }
    } catch (err) {
      console.warn("[Coco popup] coco:getState failed:", err);
    }
    if (settings && settings.gatewayUrl) {
      currentSettings = settings;
    }
    // currentSettings is always a non-null object (initialised at module top).
    $("gateway-url").value = currentSettings.gatewayUrl || "http://localhost:8080";
    $("app-id").value = currentSettings.appId || "twenty";
    $("enabled").checked = !!currentSettings.enabled;
    $("open-dashboard").href = `${(currentSettings.gatewayUrl || "http://localhost:8080").replace(/\/$/, "")}/dashboard`;
    paintStatus(lastHealth);
    refreshDemoState();
  }

  async function save() {
    const gatewayUrl =
      $("gateway-url").value.trim().replace(/\/$/, "") || "http://localhost:8080";
    const appId = $("app-id").value.trim() || "twenty";
    const enabled = $("enabled").checked;
    $("save").disabled = true;
    await sendMsg({
      type: "coco:setSettings",
      settings: { gatewayUrl, appId, enabled },
    });
    $("save").disabled = false;
    $("open-dashboard").href = `${gatewayUrl}/dashboard`;
    currentSettings = { ...currentSettings, gatewayUrl, appId, enabled };
    const { lastHealth } = await sendMsg({ type: "coco:getState" });
    paintStatus(lastHealth);
    refreshDemoState();
  }

  async function recheck() {
    $("refresh").disabled = true;
    await sendMsg({ type: "coco:pollNow" });
    const { lastHealth } = await sendMsg({ type: "coco:getState" });
    paintStatus(lastHealth);
    $("refresh").disabled = false;
    refreshDemoState();
  }

  // --- tabs ----------------------------------------------------------

  function setupTabs() {
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const target = tab.dataset.tab;
        document
          .querySelectorAll(".tab")
          .forEach((t) => t.classList.toggle("active", t === tab));
        document
          .querySelectorAll(".tab-panel")
          .forEach((p) => p.classList.toggle("active", p.id === `tab-${target}`));
      });
    });
  }

  // --- demo controls -------------------------------------------------

  function logLine(message, level = "info") {
    const log = $("demo-log");
    const line = document.createElement("div");
    line.className = `log-line log-${level}`;
    line.textContent = message;
    log.prepend(line);
    while (log.childElementCount > 8) log.removeChild(log.lastChild);
  }

  async function refreshDemoState() {
    const settings = await ensureSettings();
    const url = `${(settings.gatewayUrl || "http://localhost:8080").replace(/\/$/, "")}/api/demo/state`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`gateway ${resp.status}`);
      const state = await resp.json();
      if (state.demo_enabled) {
        $("demo-status-line").textContent = "Ready. All controls live.";
      } else {
        $("demo-status-line").innerHTML =
          'Demo controls disabled. Restart gateway with <code>COCO_ALLOW_DEMO_RESET=1</code>.';
      }
      $("demo-deal-stage").textContent = `${state.hero_deal_name} · clean stage: ${state.clean_stage}`;
      const noCoco = $("btn-no-coco");
      if (noCoco) noCoco.disabled = !state.demo_enabled;
    } catch (err) {
      $("demo-status-line").textContent = `Gateway unreachable: ${err.message}`;
      $("demo-deal-stage").textContent = "—";
    }
  }

  async function callDemo(path, body) {
    const settings = await ensureSettings();
    const baseUrl = (settings.gatewayUrl || "http://localhost:8080").replace(/\/$/, "");
    const resp = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const detail = data.detail || data.error || `HTTP ${resp.status}`;
      throw new Error(detail);
    }
    return data;
  }

  async function dispatchVerdictToTwentyTab(payload) {
    // Fire a CustomEvent in the active tab's MAIN world so the injected
    // verdict card picks it up.
    const tabs = await new Promise((resolve) =>
      chrome.tabs.query({ active: true, currentWindow: true }, resolve),
    );
    const tab = tabs && tabs[0];
    if (!tab || !tab.id) return;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: (data) => {
          window.dispatchEvent(new CustomEvent("coco:demo-verdict", { detail: data }));
        },
        args: [payload],
      });
    } catch (err) {
      console.warn("[Coco popup] could not dispatch verdict:", err);
    }
  }

  function disableDemoButtons(disabled) {
    ["btn-no-coco", "btn-with-coco", "btn-reset"].forEach((id) => {
      const el = $(id);
      if (el) el.disabled = disabled;
    });
  }

  async function runAgentNoCoco() {
    disableDemoButtons(true);
    logLine("Running agent without Coco…");
    try {
      const result = await callDemo("/api/demo/agent-runs", {
        scenario_id: "deal_stage_move_block_skip_stage",
        with_coco: false,
      });
      if (result.error) {
        logLine(`Error: ${result.error}`, "err");
      } else if (result.mutation_error) {
        logLine(`Twenty error: ${result.mutation_error}`, "err");
      } else {
        logLine("Mutation landed in Twenty. No verdict, no audit.", "warn");
        await dispatchVerdictToTwentyTab({
          mode: "no_coco",
          message: result.action_summary && result.action_summary.intent
            ? `Agent ran: ${result.action_summary.intent}. No governance, no audit row.`
            : "Stage skip applied. No governance, no record.",
          action_summary: result.action_summary,
          gateway_url: currentSettings.gatewayUrl || "http://localhost:8080",
        });
      }
    } catch (err) {
      logLine(`Failed: ${err.message}`, "err");
    } finally {
      disableDemoButtons(false);
      refreshDemoState();
    }
  }

  async function runAgentWithCoco() {
    disableDemoButtons(true);
    logLine("Running agent through Coco…");
    try {
      const result = await callDemo("/api/demo/agent-runs", {
        scenario_id: "deal_stage_move_block_skip_stage",
        with_coco: true,
      });
      if (result.error) {
        logLine(`Error: ${result.error}`, "err");
      } else {
        const verdict = result.verdict || "?";
        const reason = result.primary_reason || "";
        const tone = verdict === "BLOCK" ? "err" : verdict === "ESCALATE" ? "warn" : "ok";
        logLine(`${verdict}: ${reason}`, tone);
        await dispatchVerdictToTwentyTab({
          mode: "with_coco",
          verdict,
          primary_reason: reason,
          pack_id: result.pack_id,
          decision_id: result.decision_id,
          decision: result.decision,
          action_summary: result.action_summary,
          gateway_url: currentSettings.gatewayUrl || "http://localhost:8080",
        });
      }
    } catch (err) {
      logLine(`Failed: ${err.message}`, "err");
    } finally {
      disableDemoButtons(false);
      refreshDemoState();
    }
  }

  async function resetDemo() {
    disableDemoButtons(true);
    logLine("Resetting demo…");
    try {
      const result = await callDemo("/api/demo/reset", { audit_minutes: 10 });
      if (result.twenty_error) {
        logLine(result.twenty_error, "err");
      } else {
        logLine(
          `Stage → ${result.deal_stage}. Cleared ${result.audit_cleared} audit rows.`,
          "ok",
        );
        await dispatchVerdictToTwentyTab({
          mode: "reset",
          gateway_url: currentSettings.gatewayUrl || "http://localhost:8080",
        });
      }
    } catch (err) {
      logLine(`Failed: ${err.message}`, "err");
    } finally {
      disableDemoButtons(false);
      refreshDemoState();
    }
  }

  function paintVersion() {
    try {
      const m = chrome.runtime.getManifest();
      if (m && m.version) {
        const el = $("popup-version");
        if (el) el.textContent = `v${m.version}`;
      }
    } catch (_) {
      /* noop */
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    paintVersion();
    setupTabs();
    $("save").addEventListener("click", save);
    $("refresh").addEventListener("click", recheck);
    $("btn-no-coco").addEventListener("click", runAgentNoCoco);
    $("btn-with-coco").addEventListener("click", runAgentWithCoco);
    $("btn-reset").addEventListener("click", resetDemo);
    load();
  });
})();
