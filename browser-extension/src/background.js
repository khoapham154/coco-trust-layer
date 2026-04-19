/* CoCo Trust Layer — MV3 service worker.
 *
 * Responsibilities:
 *   1. Own the gateway URL / enabled / appId settings (chrome.storage.sync).
 *   2. Poll the gateway /health endpoint to colour the toolbar badge
 *      (green = ok, amber = warn, red = err, grey = unknown).
 *   3. When the content script requests injection, fetch the SDK + inject
 *      bundles from the gateway and run them in the page's MAIN world via
 *      chrome.scripting.executeScript — bypassing CSP that would reject
 *      inline bookmarklet scripts.
 */

const DEFAULT_SETTINGS = {
  gatewayUrl: "http://localhost:8080",
  appId: "twenty",
  enabled: true,
  matchHosts: ["http://localhost:3000/*", "https://*.twenty.com/*"],
};

const HEALTH_POLL_MS = 30_000;

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function setBadge(state) {
  const colour =
    {
      ok: "#047857",
      warn: "#d97706",
      err: "#dc2626",
    }[state] || "#6b7280";
  const text =
    {
      ok: "ok",
      warn: "!",
      err: "x",
    }[state] || "";
  try {
    await chrome.action.setBadgeBackgroundColor({ color: colour });
    await chrome.action.setBadgeText({ text });
  } catch (_) {
    /* popup closed — ignore */
  }
}

async function pollHealth() {
  const { gatewayUrl, enabled } = await getSettings();
  if (!enabled) {
    await setBadge("unknown");
    await chrome.storage.local.set({ lastHealth: { state: "off", at: Date.now() } });
    return;
  }
  try {
    const resp = await fetch(`${gatewayUrl}/health`, { method: "GET" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const payload = await resp.json();
    const ok = payload && payload.status === "ok";
    await setBadge(ok ? "ok" : "warn");
    await chrome.storage.local.set({
      lastHealth: {
        state: ok ? "ok" : "warn",
        packsLoaded: payload?.packs_loaded ?? null,
        at: Date.now(),
      },
    });
  } catch (err) {
    await setBadge("err");
    await chrome.storage.local.set({
      lastHealth: { state: "err", error: String(err), at: Date.now() },
    });
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  await chrome.storage.sync.set({ ...DEFAULT_SETTINGS, ...existing });
  chrome.alarms.create("coco-health", { periodInMinutes: HEALTH_POLL_MS / 60_000 });
  pollHealth();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("coco-health", { periodInMinutes: HEALTH_POLL_MS / 60_000 });
  pollHealth();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "coco-health") pollHealth();
});

async function injectSdkIntoTab(tabId) {
  const { gatewayUrl, appId, enabled } = await getSettings();
  if (!enabled) return { ok: false, reason: "extension disabled" };

  let sdkSource, injectSource;
  try {
    const [sdkResp, injectResp] = await Promise.all([
      fetch(`${gatewayUrl}/sdk/coco-sdk.js`),
      fetch(`${gatewayUrl}/sdk/inject.js`),
    ]);
    if (!sdkResp.ok || !injectResp.ok) {
      return {
        ok: false,
        reason: `gateway returned ${sdkResp.status}/${injectResp.status}`,
      };
    }
    sdkSource = await sdkResp.text();
    injectSource = await injectResp.text();
  } catch (err) {
    return { ok: false, reason: `fetch failed: ${err}` };
  }

  const bootstrap = `
    (function(){
      window.__COCO_GATEWAY_URL = ${JSON.stringify(gatewayUrl)};
      window.__COCO_APP_ID = ${JSON.stringify(appId)};
    })();
  `;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (code) => {
        const tag = document.createElement("script");
        tag.textContent = code;
        document.documentElement.appendChild(tag);
        tag.remove();
      },
      args: [`${bootstrap}\n${sdkSource}\n${injectSource}`],
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `executeScript failed: ${err}` };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "coco:inject") {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, reason: "no tab id" });
      return;
    }
    injectSdkIntoTab(tabId).then(sendResponse);
    return true; // async response
  }
  if (msg && msg.type === "coco:getState") {
    Promise.all([getSettings(), chrome.storage.local.get("lastHealth")]).then(
      ([settings, { lastHealth }]) => sendResponse({ settings, lastHealth }),
    );
    return true;
  }
  if (msg && msg.type === "coco:setSettings") {
    chrome.storage.sync.set(msg.settings || {}).then(async () => {
      await pollHealth();
      sendResponse({ ok: true });
    });
    return true;
  }
  if (msg && msg.type === "coco:pollNow") {
    pollHealth().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
