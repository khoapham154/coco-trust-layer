# Coco Trust Layer

Runtime governance for AI agents acting on enterprise SaaS. The agent asks before it acts. Coco checks the request against a YAML policy, returns **ALLOW**, **BLOCK** or **ESCALATE**, and writes the verdict to an audit log.

![license](https://img.shields.io/badge/license-MIT-1d4ed8)
![tests](https://img.shields.io/badge/tests-51%2F51-047857)
![packs](https://img.shields.io/badge/packs-9-047857)

![Live dashboard](docs/images/dashboard_live.png)

One gateway serves two workspaces in the dashboard: a Twenty CRM governance demo and an agent-banking trust pipeline. The toggle top-left switches between them.

## What it does

Three building blocks:

1. **Action Packs.** Plain YAML that describes what an action must look like to be valid. The team that owns the rules writes them, not engineering.
2. **Gateway.** A FastAPI service. It takes the agent's intent, reads live state from the system of record, evaluates the pack, and returns a verdict.
3. **Audit ledger.** SQLite. Every verdict, every reason, every policy version that fired.

| Verdict | Effect |
|---|---|
| `ALLOW` | Action proceeds. Mutation lands. Row written. |
| `BLOCK` | Action stopped. Reason logged. |
| `ESCALATE` | Action paused. A human reviews it in the dashboard. |

## Why

Copilots now write to CRMs, banks and finance tools faster than human RBAC was built for. Vendor permissions cover users, not agents that take twenty actions a minute. When an agent does the wrong thing, the blast radius is large and the trail is thin.

Hard-coded guards do not scale. Each tenant has different stages, limits and review thresholds, and the people who know the rules cannot edit Python. YAML packs let them write the policy; Coco enforces it and logs every call.

## Quickstart

```bash
git clone git@github.com:khoapham154/coco-trust-layer.git
cd coco-trust-layer

conda create -n coco python=3.11 -y
conda activate coco
pip install -r backend/requirements.txt

tmux new-session -d -s coco_gateway -c $PWD
tmux send-keys -t coco_gateway \
  'COCO_ALLOW_DEMO_RESET=1 PYTHONPATH=$PWD uvicorn main:app \
     --app-dir backend --host 0.0.0.0 --port 8080' Enter

curl -s localhost:8080/health
# {"status":"ok","packs_loaded":9}

open http://localhost:8080/dashboard
```

The dashboard needs no external service. Open `/sandbox/twenty` to try the user-facing overlay.

## The dashboard

The toggle top-left switches workspace. Each shows only its own packs, verdicts and escalations.

- **Live.** Verdicts stream in. Tiles for throughput, block rate, p95 latency and escalations pending. Click a row for the full decision and the YAML rule that fired.
- **Action Packs.** Edit a pack as YAML, save, and the gateway hot-reloads. Prior versions snapshot to disk for revert.
- **Escalations.** Verdicts that need a human. Approve to retry, deny to keep the block. Both write follow-up rows.
- **Audit Ledger.** Filter by pack, verdict, date and reason. Export to CSV with each decision's JSON.

![Escalations](docs/images/dashboard_escalations.png)

Inside Twenty, a Shadow-DOM overlay shows a corner badge and, on a blocked action, a modal that names the policy, the failing rule and the reason.

![Sandbox block](docs/images/sandbox_block_modal.png)

## Connect a real Twenty

The dashboard works standalone. To drive a live Twenty instance you need Docker. Run `bash scripts/setup_twenty.sh`, create an API key in Settings → Developers, seed it with `python scripts/seed_twenty.py`, then paste the key into Integrations. Full steps in [docs/twenty_integration.md](docs/twenty_integration.md) and [docs/demo_walkthrough.md](docs/demo_walkthrough.md).

## Agent-banking demo

An AI agent moves money through the six layers of the agent-banking trust stack. Coco is stage four: it reads the live account state and rules before the transfer executes.

The hero case is a $2M wire that every API layer accepts. A sanctions hold sits in the account state the payment API never exposes, so Coco reads that state, blocks the transfer before it reaches SWIFT, and logs why. Stage four runs live on the real engine; the other five layers are illustrative. The bank is a mock of the Open Bank Project v5.1.0 API.

The Agent actions view governs the rest of what an agent does to a bank on the same engine: adding a payee, changing a card limit, exporting customer records. The narration is in [docs/banking_demo_script.md](docs/banking_demo_script.md); the design is in [docs/architecture.md](docs/architecture.md).

## Action Packs

Twenty CRM:

| Pack | Action | Governs |
|---|---|---|
| `twenty.deal_stage_move` | `move_stage` | Pipeline transitions, high-value review |
| `twenty.contact_delete` | `delete_contact` | Contact lifecycle, role enforcement |
| `twenty.opportunity_create` | `create_opportunity` | Deal creation, data integrity |
| `twenty.bulk_email` | `send_bulk_email` | Outreach limits, do-not-contact |
| `twenty.field_update` | `update_field` | Required fields, archived records |

Agent Bank:

| Pack | Action | Governs |
|---|---|---|
| `banking.wire_transfer` | `initiate_transfer` | Sanctions hold, approved payee, auto-approve limit |
| `banking.add_beneficiary` | `add_beneficiary` | Payee screening, jurisdiction, first-time review |
| `banking.card_controls` | `update_card_limit` | Frozen or lost cards, limit ceiling |
| `banking.data_export` | `export_customer_records` | Export purpose, bulk and cross-border review |

Packs live in `data/twenty/packs/` and `data/banking/packs/`. Each is about 30 lines of YAML. The DSL is an AST-safe subset of Python: comparisons, booleans and dotted reads, with no calls, dunders or imports. See [`backend/engine/dsl.py`](backend/engine/dsl.py).

## Testing

```bash
PYTHONPATH=$PWD pytest tests/ -v                        # 51 unit tests
PYTHONPATH=$PWD python tests/run_twenty_scenarios.py    # 19/19 regression
bash scripts/banking_smoke.sh                           # banking backend, every verdict
bash scripts/journeys_smoke.sh                          # 6 product journeys
```

## Repo

```
coco-trust-layer/
├── backend/
│   ├── engine/             pydantic models, AST-safe DSL
│   ├── routes/             validate, packs, packs_yaml, audit, audit_advanced, scenarios,
│   │                       metrics, escalations, twenty_ops, demo, demo_bank, mock_obp, dashboard
│   ├── providers/          twenty.py (CRM state) + bank.py (OBP state)
│   ├── dashboard/          templates/index.html + static/{app.js, styles.css, tokens.css}
│   └── db/audit_log.py     SQLite ledger + escalation_status
├── agents/                 Python agent (Twenty REST via the gateway)
├── frontend/               coco-sdk.js + inject.js (Shadow-DOM overlay)
├── browser-extension/      Chromium MV3 content scripts
├── data/
│   ├── twenty/packs/       5 CRM packs + auto-snapshotted _versions/
│   ├── twenty/scenarios/   19 JSON scenario fixtures
│   └── banking/            4 banking packs + OBP fixtures (accounts, resources)
├── tests/                  pytest + scenario regression
├── scripts/                setup_twenty.sh, seed_twenty.py, seed_banking.py,
│                           banking_smoke.sh, journeys_smoke.sh, snapshot.py
├── docs/                   architecture, how_to_run, twenty_integration,
│                           demo_walkthrough, banking_demo_script, images/
└── README.md
```

## License

MIT. See [LICENSE](LICENSE).

Copyright © 2026 Team Coco.
