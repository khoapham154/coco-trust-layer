# How to run the Coco Trust Layer

Three paths here: local dev (conda), Docker, and live Twenty CRM
end-to-end. See `docs/twenty_integration.md` for the Twenty-specific
deep dive.

## 1. Local dev (conda)

```bash
# One-time: create the env
conda create -n coco python=3.11 -y
conda activate coco
pip install -r backend/requirements.txt

# Run the gateway in a tmux session
tmux new-session -d -s coco_gateway -c /mnt/khoa/coco/coco-trust-layer/backend
tmux send-keys -t coco_gateway \
  'conda activate coco && PYTHONPATH=/mnt/khoa/coco/coco-trust-layer uvicorn main:app --host 0.0.0.0 --port 8080 --reload' \
  Enter

# Check it
curl -s localhost:8080/health | jq
curl -s localhost:8080/api/packs | jq
curl -s localhost:8080/api/scenarios | jq 'length'   # → 19

# Open the dashboard
open http://localhost:8080/dashboard
```

`PYTHONPATH` points at the repo root so the gateway can import the
`agents` and `providers` packages when a scenario runs with
`driver=twenty`.

### Run the tests

```bash
cd /mnt/khoa/coco/coco-trust-layer
conda run -n coco pytest tests/ -v                        # 45 tests
conda run -n coco python tests/run_twenty_scenarios.py    # 19/19 pack regression
bash scripts/smoke_e2e.sh                                  # gateway smoke
```

- `pytest tests/` covers the engine, DSL, provider (httpx MockTransport),
  agent (with stubbed gateway + Twenty), and dashboard routes.
- `run_twenty_scenarios.py` drives every scenario fixture through the
  engine in-process — no server and no Twenty required.
- `smoke_e2e.sh` launches the gateway in a tmux session, hits every
  endpoint, runs 3 scenarios via HTTP, and asserts the audit log grew.

### Run scenarios against a live gateway

```bash
conda run -n coco python tests/run_twenty_scenarios.py \
  --base-url http://localhost:8080
```

## 2. Docker

```bash
cd /mnt/khoa/coco/coco-trust-layer
docker compose -f deploy/docker-compose.yml up --build -d

# Wait ~15s for the healthcheck to go green, then:
curl -s localhost:8080/health | jq
curl -s localhost:8080/api/packs | jq 'length'

# Scenario runner against the live container:
conda run -n coco python tests/run_twenty_scenarios.py \
  --base-url http://localhost:8080

# Stop
docker compose -f deploy/docker-compose.yml down
```

### What's running

| Service      | Port | Purpose                                    |
|--------------|------|--------------------------------------------|
| coco-gateway | 8080 | FastAPI enforcement runtime                |
| coco-redis   | 6379 | Job queue (wired, idle in this build)      |

Packs are mounted read-only from `data/twenty/packs/`. The SQLite audit
log lives at `data/runtime/audit.db` and is writable from the container.

## 3. Browser smoke test (SDK)

```bash
# From any machine that can reach the gateway:
cd /mnt/khoa/coco/coco-trust-layer/frontend
python -m http.server 8000
# Open http://localhost:8000/  (index.html is the smoke test page)
```

Click Validate. You should see the verdict render with a colored badge
(green ALLOW / red BLOCK / yellow ESCALATE). No CORS errors — the gateway
sets `allow_origins=["*"]` in dev.

## 4. Live Twenty CRM end-to-end

```bash
cd /mnt/khoa/coco/coco-trust-layer

# Clone + boot Twenty in its own docker compose (takes ~60s first time)
bash scripts/setup_twenty.sh

# Pull an API key from the running Twenty instance
#   http://localhost:3000 → Settings → Developers → API keys
export TWENTY_API_KEY="eyJ..."

# Seed deterministic records (idempotent — safe to re-run)
python scripts/seed_twenty.py

# Run a scenario end-to-end: agent reads live state, calls gateway,
# mutates Twenty only on ALLOW
python -m agents.cli --scenario deal_stage_move_allow
python -m agents.cli --scenario deal_stage_move_block_no_owner

# Or drive them from the dashboard's "Driver: twenty" toggle
open http://localhost:8080/dashboard
```

The dashboard's driver toggle switches between engine mode (scenario
fixture → engine → verdict) and Twenty mode (live Twenty state → agent →
gateway → verdict → real PATCH if ALLOW). Both write to the same audit
log and update the verdict panel with per-check pass/fail.

To inject Coco into the running Twenty tab itself, open
`scripts/inject_bookmarklet.html` in a browser and drag the bookmarklet
to your bookmarks bar. See `docs/twenty_integration.md`.

## Common issues

- **`ModuleNotFoundError: No module named 'engine'`** — run from
  `backend/` or make sure `tests/conftest.py` is loaded (it puts
  `backend/` on `sys.path`).
- **`ModuleNotFoundError: No module named 'agents'`** — the gateway
  needs `PYTHONPATH=<repo-root>` (not just `backend/`) so `driver=twenty`
  can import `agents.twenty_agent` and `providers.twenty`.
- **`attempt to write a readonly database`** — the audit DB at
  `data/runtime/audit.db` was created by a Docker container running as
  root. Fix with `sudo chown $USER:$USER data/runtime/audit.db`.
- **`driver=twenty` request hangs** — early builds had this: the agent's
  sync httpx call back to `/api/validate` deadlocked the event loop.
  Fixed by wrapping `agent.run()` in `asyncio.to_thread` inside
  `backend/routes/scenarios.py`.
- **`Pack directory not found`** — check `COCO_PACK_DIR`. Default resolves
  to `<repo>/data/twenty/packs`. In Docker it's `/app/packs/twenty/packs`.
- **Healthcheck timing out** — first build pulls the slim image; allow
  ~30s. After that, cold boot is ~3s.
- **Twenty 401s from the agent** — `TWENTY_API_KEY` missing or wrong.
  Generate one in Settings → Developers → API keys, then re-export.
