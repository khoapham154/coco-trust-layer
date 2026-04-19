/* Coco Trust Layer — options script. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  function sendMsg(message) {
    return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
  }

  async function load() {
    const { settings } = await sendMsg({ type: "coco:getState" });
    $("gateway-url").value = settings.gatewayUrl;
    $("app-id").value = settings.appId;
    const list = $("host-list");
    list.innerHTML = "";
    (settings.matchHosts || []).forEach((host) => {
      const li = document.createElement("li");
      li.textContent = host;
      list.appendChild(li);
    });
  }

  async function save() {
    const gatewayUrl = $("gateway-url").value.trim().replace(/\/$/, "") || "http://localhost:8080";
    const appId = $("app-id").value.trim() || "twenty";
    await sendMsg({ type: "coco:setSettings", settings: { gatewayUrl, appId } });
    const el = $("save-status");
    el.textContent = "Saved.";
    setTimeout(() => (el.textContent = ""), 1800);
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("save").addEventListener("click", save);
    load();
  });
})();
