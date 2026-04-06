# CoCo Trust Layer — MVP

Runtime governance between AI agents and Enterprise SaaS. This repo is
the enforcement runtime: a FastAPI gateway, a vanilla JS SDK, five Action
Packs for Twenty CRM, and a test suite that proves the whole thing works
end to end.

## What's in here

```
coco-trust-layer/
├── backend/    Python FastAPI gateway + engine (Pydantic, safe DSL, SQLite audit log)
├── frontend/   Vanilla JS SDK + browser smoke-test page
├── data/       YAML Action Packs and JSON test scenarios (domain data, no code)
├── tests/      pytest suite + end-to-end scenario runner
├── deploy/     Docker Compose for local dev
└── docs/       Architecture + how-to-run
```

- **backend/** is the enforcement runtime. All Python lives here.
- **frontend/** is the embeddable SDK. One JS file, no build, no deps.
- **data/** is where Product Managers edit packs without touching code.
- **tests/** protects the contract between all three.
- **deploy/** boots the whole stack with one command.
- **docs/** tells you how the pieces fit.

## Quick start

```bash
# Conda dev path
conda create -n coco python=3.11 -y
conda activate coco
pip install -r backend/requirements.txt
pytest tests/ -v
python tests/run_twenty_scenarios.py

# Docker path
docker compose -f deploy/docker-compose.yml up --build -d
curl -s localhost:8080/health | jq
python tests/run_twenty_scenarios.py --base-url http://localhost:8080
```

See `docs/how_to_run.md` for more detail and `docs/architecture.md` for
the design.

## The five Twenty CRM Action Packs

| Pack                        | Action              | Governs                                  |
|-----------------------------|---------------------|------------------------------------------|
| `twenty.deal_stage_move`    | `move_stage`        | Pipeline transitions, high-value review  |
| `twenty.contact_delete`     | `delete_contact`    | Contact lifecycle, role enforcement      |
| `twenty.opportunity_create` | `create_opportunity`| Deal creation, data integrity            |
| `twenty.bulk_email`         | `send_bulk_email`   | Outreach governance, do-not-contact      |
| `twenty.field_update`       | `update_field`      | Data integrity, required fields          |

## API

| Method | Path                  | Purpose                        |
|--------|-----------------------|--------------------------------|
| POST   | `/api/validate`       | Validate an agent action       |
| GET    | `/api/packs`          | List loaded packs              |
| GET    | `/api/packs/{id}`     | Get pack detail                |
| GET    | `/api/audit?limit=N`  | Recent audit log               |
| GET    | `/health`             | Liveness + packs loaded count  |

## Verdicts

- `ALLOW` — everything passes, agent may proceed
- `BLOCK` — hard failure, must not proceed
- `ESCALATE` — soft failure, needs human review

