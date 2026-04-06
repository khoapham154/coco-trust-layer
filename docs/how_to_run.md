# How to run the CoCo Trust Layer

Two paths: local dev (conda) and Docker.

## 1. Local dev (conda)

```bash
# One-time: create the env
conda create -n coco python=3.11 -y
conda activate coco
pip install -r backend/requirements.txt

# Run the gateway in a tmux session
tmux new-session -d -s coco_gateway -c /mnt/khoa/coco/coco-trust-layer/backend
tmux send-keys -t coco_gateway \
  'conda activate coco && uvicorn main:app --host 0.0.0.0 --port 8080 --reload' \
  Enter

# Check it
curl -s localhost:8080/health | jq
curl -s localhost:8080/api/packs | jq
```

### Run the tests

```bash
cd /mnt/khoa/coco/coco-trust-layer
conda run -n coco pytest tests/ -v
conda run -n coco python tests/run_twenty_scenarios.py
```

The scenario runner uses the in-process ASGI client by default (no server
needed).

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
| coco-redis   | 6379 | Job queue (wired, idle in this build) |

Packs are mounted read-only from `data/twenty/packs/`. The SQLite audit
log lives at `data/runtime/audit.db` and is writable from the container.

## 3. Browser smoke test (SDK)

```bash
# From any machine that can reach the gateway:
cd /mnt/khoa/coco/coco-trust-layer/frontend
python -m http.server 8000
# Open http://localhost:8000/example.html
```

Click Validate. You should see the verdict render with a colored badge
(green ALLOW / red BLOCK / yellow ESCALATE). No CORS errors — the gateway
sets `allow_origins=["*"]` in dev.

## Common issues

- **`ModuleNotFoundError: No module named 'engine'`** — run from
  `backend/` or make sure `tests/conftest.py` is loaded (it puts
  `backend/` on `sys.path`).
- **`Pack directory not found`** — check `COCO_PACK_DIR`. Default resolves
  to `<repo>/data/twenty/packs`. In Docker it's `/app/packs/twenty/packs`.
- **Healthcheck timing out** — first build pulls the slim image; allow
  ~30s. After that, cold boot is ~3s.
