/* CoCo Trust Layer — popup script. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

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

  function sendMsg(message) {
    return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
  }

  async function load() {
    const { settings, lastHealth } = await sendMsg({ type: "coco:getState" });
    $("gateway-url").value = settings.gatewayUrl;
    $("app-id").value = settings.appId;
    $("enabled").checked = !!settings.enabled;
    $("open-dashboard").href = `${settings.gatewayUrl.replace(/\/$/, "")}/dashboard`;
    paintStatus(lastHealth);
  }

  async function save() {
    const gatewayUrl = $("gateway-url").value.trim().replace(/\/$/, "") || "http://localhost:8080";
    const appId = $("app-id").value.trim() || "twenty";
    const enabled = $("enabled").checked;
    $("save").disabled = true;
    await sendMsg({ type: "coco:setSettings", settings: { gatewayUrl, appId, enabled } });
    $("save").disabled = false;
    $("open-dashboard").href = `${gatewayUrl}/dashboard`;
    const { lastHealth } = await sendMsg({ type: "coco:getState" });
    paintStatus(lastHealth);
  }

  async function recheck() {
    $("refresh").disabled = true;
    await sendMsg({ type: "coco:pollNow" });
    const { lastHealth } = await sendMsg({ type: "coco:getState" });
    paintStatus(lastHealth);
    $("refresh").disabled = false;
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("save").addEventListener("click", save);
    $("refresh").addEventListener("click", recheck);
    load();
  });
})();
