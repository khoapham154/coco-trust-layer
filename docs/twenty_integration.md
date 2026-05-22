# Twenty integration

How to run the Coco Trust Layer against a live Twenty CRM.

## 1. Start the gateway

```bash
conda activate coco
cd /mnt/khoa/coco/coco-trust-layer
PYTHONPATH=$PWD COCO_ALLOW_DEMO_RESET=1 \
  uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8080 --reload
```

The dashboard is at <http://localhost:8080/dashboard>. The sandbox is at
<http://localhost:8080/sandbox/twenty> if you want to try the user
overlay before standing up real Twenty.

## 2. Self-host Twenty

```bash
bash scripts/setup_twenty.sh
```

The script clones `twentyhq/twenty` into `twenty/` (gitignored, ~500 MB),
runs its Docker Compose, and waits for <http://localhost:3000>. First
build takes ~5 min while images pull.

When the script finishes:

1. Open <http://localhost:3000>.
2. Create an admin account. Email and password, no OTP on localhost.
3. Settings → Developers → API keys, generate a token.
4. `export TWENTY_API_KEY=<token>`.

Tear down with `bash scripts/setup_twenty.sh --down`.

## 3. Seed fixtures

```bash
python scripts/seed_twenty.py
```

Creates 5 companies, 10 people, 3 opportunities. IDs land in
`data/twenty/fixtures/seeded.json`. Re-runs are idempotent; records
match by name and stay one copy.

## 4. Drop the SDK into the Twenty tab

Open the dashboard's Integrations page:

```
http://localhost:8080/dashboard#/integrations
```

Drag the **"🐈‍⬛ Coco · drag me"** pill to your bookmarks bar. On a
Twenty tab, click the bookmark. The Coco SDK and overlay load. A small
badge appears bottom-right.

If the bookmarklet is blocked by Twenty's CSP, paste this into Twenty's
DevTools console instead:

```js
var s = document.createElement("script");
s.src = "http://localhost:8080/sdk/coco-sdk.js";
s.onload = function () {
  var i = document.createElement("script");
  i.src = "http://localhost:8080/sdk/inject.js";
  i.dataset.gateway = "http://localhost:8080";
  document.head.appendChild(i);
};
document.head.appendChild(s);
```

The overlay renders into a Shadow DOM root so Twenty's CSS cannot leak
in or out.

## 5. Run a real scenario

```bash
python -m agents.cli --scenario deal_stage_move_allow
```

Or drive it from the dashboard's Packs page: click any pack, scroll to
the regression scenarios, hit **Run**.

On `ALLOW`, the agent calls `PATCH /rest/opportunities/{id}` (or
whatever the pack's action maps to). On `BLOCK` or `ESCALATE`, the
mutation is skipped and the refusal is recorded. Every run writes to
`data/runtime/audit.db`.

## What the user sees in Twenty

- **ALLOW.** A small green card slides in bottom-right and auto-dismisses
  after a few seconds.
- **BLOCK.** A centred modal interrupts the action. It names the policy
  and the failing rule in plain English. Buttons: See policy · Request
  override · Cancel.
- **ESCALATE.** An amber card with a "Request override" button. The
  override lands in the Escalations queue on the dashboard.
- **See policy.** Opens a right-side drawer with the YAML, the firing
  rule highlighted in Coco purple, auto-scrolled into view.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `503 Twenty driver not available yet` on `?driver=twenty` | `agents/` is not importable. Run the gateway from the repo root or set `PYTHONPATH` to include it. |
| `TWENTY_API_KEY` not set | Settings → Developers → API keys, then `export TWENTY_API_KEY=...`. |
| `Twenty fetch failed` in the trace | Twenty is unreachable. `curl http://localhost:3000` to confirm, then re-run `bash scripts/setup_twenty.sh`. |
| Bookmarklet does nothing | Twenty's CSP blocked it. Use the DevTools console snippet above. |
| No badge after the bookmarklet | DevTools → console → look for `[Coco] overlay live against ...`. If absent, the SDK didn't attach. |

## What is wired where

```
coco-gateway (:8080) ── /api/validate ────── engine + SQLite audit
                   ├── /api/metrics/live ─── tiles for the Live view
                   ├── /api/escalations ──── pending queue + approve/deny
                   ├── /api/packs/yaml ───── read + edit + version + revert
                   └── /api/scenarios/{id}/run?driver=twenty
                         └──▶ agents/twenty_agent.py
                                 ├── providers/twenty.py (live state)
                                 └── Twenty REST (live mutation)

Twenty tab (:3000) ◀── /sdk/coco-sdk.js + /sdk/inject.js
                     (served same-origin by coco-gateway)
```
