/* CoCo Trust Layer — content script.
 *
 * Runs on every matching tab (localhost:3000 + *.twenty.com).
 * Its only job is to ask the service worker to inject the SDK into the
 * page's MAIN world — the CSP-bypass happens there.
 *
 * We idempotency-guard via window.__COCO_INJECTED__ so reloads don't
 * double-inject, and we retry once after 2s if the page is still
 * bootstrapping when we first run.
 */
(() => {
  "use strict";
  if (window.__COCO_CS_BOOTED__) return;
  window.__COCO_CS_BOOTED__ = true;

  function inject(retryOnFail = true) {
    chrome.runtime.sendMessage({ type: "coco:inject" }, (resp) => {
      if (chrome.runtime.lastError) {
        console.warn("[CoCo] inject msg failed:", chrome.runtime.lastError.message);
        return;
      }
      if (!resp || !resp.ok) {
        console.warn("[CoCo] SDK inject failed:", resp && resp.reason);
        if (retryOnFail) setTimeout(() => inject(false), 2000);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => inject(true));
  } else {
    inject(true);
  }
})();
