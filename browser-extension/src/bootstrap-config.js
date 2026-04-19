/* Coco Trust Layer — MAIN-world bootstrap.
 *
 * Runs BEFORE coco-sdk.js and inject.js as the first content script in
 * the manifest's MAIN-world list. Sets the two globals the SDK reads
 * on init, so the SDK doesn't have to guess.
 *
 * Gateway URL is hardcoded for now. For a non-default gateway, edit
 * this file and reload the extension in chrome://extensions.
 */
(function () {
  if (window.__COCO_BOOTSTRAPPED__) return;
  window.__COCO_BOOTSTRAPPED__ = true;
  window.__COCO_GATEWAY_URL = "http://localhost:8080";
  window.__COCO_APP_ID = "twenty";
})();
