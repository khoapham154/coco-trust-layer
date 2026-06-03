# How to run

Three paths: local dev with conda, Docker, and live Twenty CRM end to
end. The Twenty-specific details are in [twenty_integration.md](twenty_integration.md).

## 1. Local dev (conda)

```bash
conda create -n coco python=3.11 -y
conda activate coco
pip install -r backend/requirements.txt

tmux new-session -d -s coco_gateway -c /mnt/khoa/coco/coco-trust-layer
tmux send-keys -t coco_gateway \
  'conda activate coco && PYTHONPATH=$PWD COCO_ALLOW_DEMO_RESET=1 \
   uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8080 --reload' Enter

curl -s localhost:8080/health | jq
curl -s localhost:8080/api/packs | jq 'length'         # → 6 (5 Twenty + 1 banking)
curl -s localhost:8080/api/scenarios | jq 'length'     # → 19

open http://localhost:8080/dashboard
open http://localhost:8080/dashboard#/banking          # agent-banking pipeline demo
open http://localhost:8080/sandbox/twenty
```

The gateway loads packs from `data/twenty/packs` and `data/banking/packs`
together, so the dashboard serves the Twenty governance views and the
Agent Banking demo from one process. The banking demo drives the live
`banking.wire_transfer` pack through `POST /api/demo/bank_transfer`.

`PYTHONPATH` points at the repo root so the gateway can import `agents`
and `providers` when a scenario runs with `driver=twenty`.
`COCO_ALLOW_DEMO_RESET=1` enables the override flow on the Twenty-side
overlay; safe in dev.

### Tests

```bash
cd /mnt/khoa/coco/coco-trust-layer
PYTHONPATH=$PWD pytest tests/ -v                        # 45 unit tests
PYTHONPATH=$PWD python tests/run_twenty_scenarios.py    # 19/19 regression
bash scripts/journeys_smoke.sh                          # 6 product journeys
bash scripts/smoke_e2e.sh                               # gateway end-to-end
```

`journeys_smoke.sh` walks the six product journeys against a running
gateway. Treat it as a deploy gate.

### Scenarios against a live gateway

```bash
python tests/run_twenty_scenarios.py --base-url http://localhost:8080
```

## 2. Docker

```bash
docker compose -f deploy/docker-compose.yml up --build -d

curl -s localhost:8080/health | jq
curl -s localhost:8080/api/packs | jq 'length'

python tests/run_twenty_scenarios.py --base-url http://localhost:8080

docker compose -f deploy/docker-compose.yml down
```

| Service      | Port | Purpose                                |
|--------------|------|----------------------------------------|
| coco-gateway | 8080 | FastAPI enforcement runtime            |
| coco-redis   | 6379 | Job queue, wired but idle in this build |

Packs mount read-only from `data/twenty/packs/`. The SQLite audit log
lives at `data/runtime/audit.db` and stays writable.

## 3. Try the user-facing overlay (no Twenty needed)

```bash
open http://localhost:8080/sandbox/twenty
```

The sandbox is a synthetic Twenty page with the Coco SDK pre-loaded.
Click any action button: a verdict streams back from the real gateway
and shows up in the corner badge or, for BLOCK, a centred modal. The
"See policy" button opens the right-side drawer with the firing YAML
rule highlighted.

Use this when you want to demo the user surface without booting Twenty.

## 4. Live Twenty CRM end to end

```bash
cd /mnt/khoa/coco/coco-trust-layer

bash scripts/setup_twenty.sh        # clones twentyhq/twenty, ~5 min first time
# Open http://localhost:3000, create an account,
# Settings → Developers → API keys, copy the eyJ... token.

export TWENTY_API_KEY="eyJ..."
python scripts/seed_twenty.py       # 5 companies, 10 people, 3 deals

python -m agents.cli --scenario deal_stage_move_allow
python -m agents.cli --scenario deal_stage_move_block_no_owner
```

Or drive the same flow from the dashboard's Integrations page: paste
the API key, hit "Test connection", drag the bookmarklet to your
bookmarks bar, click it on the Twenty tab.

The dashboard's driver toggle on the scenarios switches between engine
mode (fixture → engine → verdict) and Twenty mode (live state → agent
→ gateway → real PATCH on ALLOW). Both write to the same audit log.

## Common issues

- **`ModuleNotFoundError: No module named 'engine'`.** Run from
  `backend/` or load `tests/conftest.py` (it puts `backend/` on
  `sys.path`).
- **`ModuleNotFoundError: No module named 'agents'`.** The gateway
  needs `PYTHONPATH=<repo-root>` so `driver=twenty` can import
  `agents.twenty_agent` and `providers.twenty`.
- **`attempt to write a readonly database`.** A Docker container as
  root created `data/runtime/audit.db`. Fix with
  `sudo chown $USER:$USER data/runtime/audit.db`.
- **`driver=twenty` hangs.** Early builds deadlocked because the
  agent's sync `httpx` call back to `/api/validate` blocked the event
  loop. The current code wraps `agent.run()` in `asyncio.to_thread`.
- **`Pack directory not found`.** Check `COCO_PACK_DIR`. Default is
  `<repo>/data/twenty/packs`. In Docker it's `/app/packs/twenty/packs`.
- **Healthcheck slow.** First image pull is ~30s. Cold boot after that
  is ~3s.
- **Twenty 401s.** `TWENTY_API_KEY` missing or wrong. Generate one in
  Settings → Developers → API keys, then re-export.
