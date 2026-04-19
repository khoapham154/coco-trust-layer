# Twenty integration

How to run the Coco Trust Layer against a live Twenty CRM end-to-end.

## 1. Start the gateway

```bash
conda activate coco
cd backend
uvicorn main:app --host 0.0.0.0 --port 8080 --reload
```

The dashboard is at <http://localhost:8080/dashboard>.

## 2. Self-host Twenty

```bash
bash scripts/setup_twenty.sh
```

This clones `twentyhq/twenty` into `twenty/` (gitignored, ~500 MB), runs
its Docker Compose, and waits for `http://localhost:3000`. The first
build takes ~5 minutes while Twenty's images pull.

When the script finishes:

1. Open <http://localhost:3000> in a browser.
2. Create an admin account — email + password, no OTP needed for
   localhost.
3. Settings → Developers → API keys → generate a personal token.
4. `export TWENTY_API_KEY=<token>`.

Tear down with `bash scripts/setup_twenty.sh --down`.

## 3. Seed fixtures

```bash
python scripts/seed_twenty.py
```

Creates 5 companies, 10 people, 3 opportunities and writes their IDs to
`data/twenty/fixtures/seeded.json`. Re-running is idempotent — records
matched by name are reused, not duplicated.

## 4. Drop the SDK into the Twenty tab

Open the bookmarklet page:

```
http://localhost:8080/dashboard#twenty
```

— then drag the **Coco → Twenty** link to your bookmarks bar. On a
Twenty tab, click the bookmark: the Coco SDK (`/sdk/coco-sdk.js`) and
injection bootstrap (`/sdk/inject.js`) load, a floating badge appears
bottom-right, and every agent verdict renders as a toast.

Alternative: paste this into Twenty's DevTools console.

```js
var s = document.createElement("script");
s.src = "http://localhost:8080/sdk/coco-sdk.js";
s.onload = function () {
  var i = document.createElement("script");
  i.src = "http://localhost:8080/sdk/inject.js";
  document.head.appendChild(i);
};
document.head.appendChild(s);
```

## 5. Run a real scenario

```bash
# Standalone CLI
python -m agents.cli --scenario deal_stage_move_allow

# Or through the dashboard: flip the scenario toggle to "Live Twenty"
# and click any scenario card.
```

On ALLOW, the agent performs the mutation via Twenty's REST API (e.g.
`PATCH /rest/opportunities/{id}` to move a stage). On BLOCK or
ESCALATE, the agent skips the mutation and records the refusal. Every
run writes a row to the audit log at `data/runtime/audit.db`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `503 Twenty driver not available yet` on `?driver=twenty` | Make sure `agents/` is importable — run gateway from the repo root or set `PYTHONPATH` to include it. |
| `TWENTY_API_KEY` not set | Generate a key in Twenty → Settings → Developers → API keys, then `export TWENTY_API_KEY=...`. |
| `Twenty fetch failed` in the verdict trace | Twenty isn't reachable — `curl http://localhost:3000` to confirm. Re-run `bash scripts/setup_twenty.sh`. |
| Bookmarklet does nothing | Twenty uses a strict Content-Security-Policy in some builds. Use the DevTools console snippet instead. |
| No verdict toast after a mutation | Open DevTools → console → look for `[Coco] SDK live against ...`. If absent, the SDK didn't attach. |

## What's wired where

```
coco-gateway (:8080) ── /api/validate ──── engine + SQLite audit
                   └── /api/scenarios/{id}/run?driver=twenty
                         └──▶ agents/twenty_agent.py
                                 ├── providers/twenty.py (live state)
                                 └── Twenty REST (live mutation)

Twenty tab (localhost:3000) ◀── /sdk/coco-sdk.js + /sdk/inject.js
                              (served by coco-gateway, same origin)
```
