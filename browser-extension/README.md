# Coco Browser Extension (Chromium MV3)

Auto-injects the Coco SDK into matching Twenty CRM tabs, talking to a
locally running Coco gateway on `http://localhost:8080` by default.

Replaces the old bookmarklet flow. Install once, always on.

## Install

1. Download `coco-browser-extension.zip` from the dashboard
   (`http://localhost:8080/dashboard` → step 5 of the onboarding
   wizard), or use this folder directly.
2. Unzip (skip if using the folder directly).
3. Open `chrome://extensions` in Chrome or Edge.
4. Toggle **Developer mode** (top-right).
5. Click **Load unpacked** and pick this folder (the one with
   `manifest.json`).
6. Pin the Coco icon in the toolbar. A green "ok" badge means the
   gateway is reachable.

## Use

1. Start the gateway (from the repo root):

   ```bash
   tmux new-session -d -s coco_gateway -c /mnt/khoa/coco/coco-trust-layer
   tmux send-keys -t coco_gateway \
     'conda activate coco && PYTHONPATH=$PWD uvicorn main:app --app-dir backend \
      --host 0.0.0.0 --port 8080 2>&1 | tee logs/gateway.log' Enter
   ```

2. Start Twenty:

   ```bash
   tmux new-session -d -s twenty_up -c /mnt/khoa/coco/coco-trust-layer
   tmux send-keys -t twenty_up \
     'bash scripts/setup_twenty.sh 2>&1 | tee logs/twenty_up.log' Enter
   ```

3. Open `http://localhost:3000`. The extension injects the SDK and a
   floating Coco badge appears bottom-right.
4. Click the extension toolbar icon to toggle it off, change the
   gateway URL, or jump to the dashboard.

## Remote server workflow

If the gateway + Twenty run on a remote machine (e.g. your 8×A100
server) and Chrome runs on your laptop, forward both ports via SSH:

```bash
ssh -L 3000:localhost:3000 -L 8080:localhost:8080 <server>
```

Then install the extension on your laptop and visit `http://localhost:3000`
in local Chrome. The tunnels make it look like everything runs locally.

## Files

```
manifest.json          MV3 manifest
assets/                16/48/128-px icons
src/background.js      service worker: health polling, SDK injection
src/content-script.js  content script: requests inject from background
src/popup.html|.js     toolbar popup (gateway URL, on/off, health)
src/options.html|.js   full settings page
src/styles.css         shared popup + options styling
```

## How injection works

The content script runs on every matching tab at `document_idle`. It
sends a `coco:inject` message to the service worker. The service worker
`fetch`es `/sdk/coco-sdk.js` + `/sdk/inject.js` from the configured
gateway, then uses `chrome.scripting.executeScript({ world: "MAIN", ... })`
to run them in the page's main world — bypassing any CSP that would
reject a bookmarklet-style injection.

## Security notes

- The extension needs `host_permissions` for `localhost:3000`,
  `localhost:8080`, and `*.twenty.com` — nothing else.
- It never requests page content, history, or cookies.
- The API key the wizard uses is stored in `localStorage` on the
  dashboard (not by the extension), and is transmitted to Twenty
  directly by the gateway via your loopback only.
- To harden for production: pin a specific gateway origin in
  `host_permissions`, add integrity hashes for the fetched SDK files,
  and move the service-worker fetches behind an authenticated token.
