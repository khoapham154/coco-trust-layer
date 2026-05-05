# Coco Trust Layer

> Runtime governance between AI agents and Enterprise SaaS.
> Validates every agent action against a YAML behavioral contract,
> returns **ALLOW / BLOCK / ESCALATE**, and writes an immutable
> audit log — all without the agent knowing the difference.

![license](https://img.shields.io/badge/license-MIT-1d4ed8)
![tests](https://img.shields.io/badge/tests-45%2F45%20green-047857)
![packs](https://img.shields.io/badge/packs-5%20loaded-047857)

---

## Table of contents

1. [What Coco is](#1-what-coco-is)
2. [Why it exists](#2-why-it-exists)
3. [Architecture at a glance](#3-architecture-at-a-glance)
4. [5-minute quickstart (gateway only)](#4-5-minute-quickstart-gateway-only)
5. [End-to-end demo with Twenty CRM](#5-end-to-end-demo-with-twenty-crm)
6. [Chromium browser extension](#6-chromium-browser-extension)
7. [The five Twenty Action Packs](#7-the-five-twenty-action-packs)
8. [Testing](#8-testing)
9. [Repo layout](#9-repo-layout)
10. [License](#10-license)

---

## 1. What Coco is

Coco is a lightweight runtime that sits between an AI agent and the SaaS
applications it acts on. When the agent tries to mutate a record — move
a deal stage, delete a contact, send a bulk email — Coco validates the
request against a **YAML Action Pack** that spells out the business
rules.

Every pack has three parts:
- **Pre-conditions** — state that must hold before the action runs
  (owner assigned, tasks completed, user has the right role).
- **Constraints** — DSL expressions over live state
  (no more than 50 recipients, amount within budget, no do-not-contact
  flag).
- **Post-conditions** — drift checks that run after the mutation lands
  (required fields still filled, stage didn't skip).

Three verdicts:

| Verdict    | Effect                                                      |
|------------|-------------------------------------------------------------|
| `ALLOW`    | Agent proceeds, mutation lands in SaaS, audit row written.  |
| `BLOCK`    | Mutation is skipped, refusal is logged with the reason.     |
| `ESCALATE` | Mutation is skipped, a human-review ticket is recorded.     |

Every verdict is written to an immutable audit ledger
(`data/runtime/audit.db`).

## 2. Why it exists

**The agent-action problem.** Copilots now push updates into CRMs, EHRs,
ticketing systems, and finance tools. The SaaS vendor's own RBAC was
designed for humans, not for an agent that completes twenty actions a
minute. When an agent does the wrong thing — skips a deal stage, deletes
a contact with open opportunities, emails a do-not-contact list — the
blast radius is large and the root cause is hard to trace.

**Why not hard-code guards.** Every vendor has a different pipeline, a
different stage enum, a different retention policy. Hard-coded guards
turn into a maintenance nightmare; the people who know the rules (RevOps,
Compliance, Legal) can't edit code. YAML packs let the right humans
author the rules and Coco enforces them without rebuilding the agent.

**Why compile-time guards aren't enough.** The agent's plan is generated
at runtime; static analysis sees a benign LLM call. Coco intercepts the
HTTP mutation itself, checks live state at the moment of the action, and
writes a receipt that ties agent → action → verdict → outcome.

## 3. Architecture at a glance

```
  ┌────────┐     ┌────────────┐     ┌────────────────┐
  │ Agent  │────▶│  Coco SDK  │────▶│  Coco Gateway  │─┐
  └────────┘     └────────────┘     └────────────────┘ │
                                          │ POST /api/ │
                                          │  validate  │
                                          ▼            │
                                    ┌────────────┐     │
                                    │  Packs +   │     │
                                    │ State +    │─────┼──▶ Twenty CRM
                                    │ DSL engine │     │   (live REST)
                                    └────────────┘     │
                                          │            │
                                          ▼            │
                                    ┌────────────┐     │
                                    │ Audit log  │◀────┘
                                    │ (SQLite)   │
                                    └────────────┘
```

- **Gateway** — FastAPI process on `:8080`. Loads YAML packs at startup,
  exposes `/api/validate`, `/api/packs`, `/api/audit`, `/api/scenarios`,
  `/dashboard`, `/sdk/*`, `/browser-extension.zip`, `/health`.
- **Provider** — Python adapter (`backend/providers/twenty.py`) that
  reads live Twenty REST state and projects it into the pack-ready
  `ui_state` shape. Version-tolerant filter grammar baked in
  (works against Twenty 0.30 and 0.32).
- **Agent** — `agents/twenty_agent.py` composes provider → gateway →
  Twenty mutation. On `ALLOW` it PATCHes the record; on `BLOCK` /
  `ESCALATE` it records the refusal and stops.
- **SDK** — Vanilla JS, no build, no deps (`frontend/coco-sdk.js`).
  Captures DOM state into a plain object and calls `POST /api/validate`.
- **Dashboard** — Pure HTML + CSS + JS served by the gateway at
  `/dashboard`. Six-step Twenty onboarding wizard, live scenario runner,
  audit viewer.
- **Browser extension** — Chromium MV3, loads the SDK in the page's
  MAIN world at `document_idle`. Zero configuration once installed.

## 4. 5-minute quickstart (gateway only)

```bash
# 1. Clone
git clone git@github.com:khoapham154/coco-trust-layer.git
cd coco-trust-layer

# 2. Environment
conda create -n coco python=3.11 -y
conda activate coco
pip install -r backend/requirements.txt

# 3. Gateway in tmux (mandatory per project convention)
tmux new-session -d -s coco_gateway -c $PWD
tmux send-keys -t coco_gateway \
  'PYTHONPATH=$PWD uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8080' Enter

# 4. Verify
curl -s http://localhost:8080/health | jq
# → {"status":"ok","packs_loaded":5}

# 5. Open the dashboard
open http://localhost:8080/dashboard
```

The dashboard works standalone — the "driver: Engine" toggle runs
scenarios against shipped fixtures, no Twenty required.

## 5. End-to-end demo with Twenty CRM

The dashboard's Twenty panel is a **six-step wizard**. Complete it and
the gateway drives a real deal-stage change in Twenty.

### Prerequisites

- Docker installed and in PATH
- `git` (for the Twenty clone)
- ~2 GB free disk (Twenty's Postgres + images)

### Step 0 — Enable the wizard's seed subprocess

The wizard's "Run seed" button spawns `scripts/seed_twenty.py` as a
subprocess. For safety it's gated on an env var. Restart the gateway
with:

```bash
tmux send-keys -t coco_gateway C-c
tmux send-keys -t coco_gateway \
  'COCO_ALLOW_WIZARD_EXEC=1 PYTHONPATH=$PWD uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8080' Enter
```

### Step 1 — Gateway health (wizard step 1)

Click **Check /health**. Should go green with "5 packs loaded".

### Step 2 — Boot Twenty (wizard step 2)

```bash
tmux new-session -d -s twenty_up -c $PWD
tmux send-keys -t twenty_up \
  'bash scripts/setup_twenty.sh 2>&1 | tee logs/twenty_up.log' Enter
```

First run pulls Docker images (~5 min). When `docker ps` shows 4
`twenty-*` containers healthy, you're ready.

Open `http://localhost:3000` → create an admin account → Settings →
Developers → API keys → **Create key**. Copy the `eyJ…` token.

### Step 3 — Connect API key (wizard step 3)

Paste the token into the **API key** field. Click **Test connection**.
The gateway calls Twenty's `/rest/companies?limit=1` with your token;
green pill = 200 OK.

### Step 4 — Seed fixtures (wizard step 4)

Click **Run seed**. Creates 5 companies, 10 people, 3 opportunities in
your Twenty instance, and PATCHes a `pointOfContactId` (deal owner)
onto each opportunity so the `deal_stage_move` pack's pre-condition
passes. IDs land in `data/twenty/fixtures/seeded.json`.

### Step 5 — Install the browser extension (wizard step 5)

Click **Download extension (.zip)**, unzip, `chrome://extensions` →
Developer mode → **Load unpacked** → pick the folder. Reload the
Twenty tab — a floating Coco pill appears bottom-right.

### Step 6 — Run a live scenario (wizard step 6)

Click **Run deal_stage_move_allow**. The agent:
1. Reads the live opportunity state (owner assigned, stage = NEW)
2. Calls `POST /api/validate` on the gateway
3. Gateway evaluates `twenty.deal_stage_move` — all checks pass
4. Agent PATCHes Twenty's opportunity with `stage=SCREENING`
5. Audit row lands in the ledger

**Expected verdict card:**
`ALLOW · twenty.deal_stage_move` + `Twenty mutation applied ✓`

Refresh the "Northwind Labs — Enterprise Trust Layer" opportunity in
Twenty — stage has advanced NEW → SCREENING.

## 6. Chromium browser extension

`browser-extension/` is a Chromium MV3 extension that auto-injects the
SDK into every matching Twenty tab.

### Install

1. Download `http://localhost:8080/browser-extension.zip` (served fresh
   from the running gateway), or zip `browser-extension/` yourself.
2. Unzip anywhere.
3. `chrome://extensions` → **Developer mode** (top-right) →
   **Load unpacked** → pick the unzipped folder.

### Use

- On `http://localhost:3000/*` or `https://*.twenty.com/*`, the MAIN-world
  content script loads `bootstrap-config.js → coco-sdk.js → inject.js`
  at `document_idle`.
- A floating **Coco** pill renders bottom-right with health status and a
  "Validate current page" button.
- Click the extension toolbar icon to change the gateway URL, toggle the
  extension, or jump to the dashboard.

### Why MAIN-world content scripts

Earlier versions used `chrome.scripting.executeScript({world: "MAIN"})`
from the service worker, which silently failed on some SPA tabs.
Manifest V3's native `"world": "MAIN"` (Chrome 111+) is the bulletproof
path — no message passing, no fetch, no CSP dance.

## 7. The five Twenty Action Packs

All live under `data/twenty/packs/` as editable YAML. Product Managers
can extend them without touching Python.

| Pack                        | Action               | Governs                                  |
|-----------------------------|----------------------|------------------------------------------|
| `twenty.deal_stage_move`    | `move_stage`         | Pipeline transitions, high-value review  |
| `twenty.contact_delete`     | `delete_contact`     | Contact lifecycle, role enforcement      |
| `twenty.opportunity_create` | `create_opportunity` | Deal creation, data integrity            |
| `twenty.bulk_email`         | `send_bulk_email`    | Outreach governance, do-not-contact list |
| `twenty.field_update`       | `update_field`       | Required fields, archived records        |

Each pack is auditable in ~50 lines of YAML. The DSL is a safe AST
subset of Python: comparisons, boolean operators, dotted attribute reads.
No calls, no dunders, no imports, no lambdas. See
[`backend/engine/dsl.py`](backend/engine/dsl.py).

## 8. Testing

```bash
conda activate coco
PYTHONPATH=$PWD pytest tests/ -v                        # 45 tests, all green
PYTHONPATH=$PWD python tests/run_twenty_scenarios.py    # 19/19 pack regression
bash scripts/smoke_e2e.sh                               # gateway end-to-end
```

`tests/run_twenty_scenarios.py --base-url http://localhost:8080` runs
the same 19 scenarios against a live gateway container instead of
in-process.

## 9. Repo layout

```
coco-trust-layer/
├── backend/             FastAPI gateway, engine, Twenty provider, dashboard
│   ├── engine/          Pydantic models, AST-safe DSL, decision short-circuit
│   ├── routes/          validate, packs, audit, scenarios, twenty_ops, dashboard
│   ├── providers/       TwentyStateProvider — pre-aggregates list state for DSL
│   ├── dashboard/       templates/index.html + static/{app.js, styles.css, wizard.js, assets/}
│   └── db/              SQLite audit log
├── agents/              Python agent driving Twenty REST CRUD via the gateway
├── frontend/            Vanilla JS SDK + bootstrap inject.js + smoke-test page
├── browser-extension/   Chromium MV3 extension (MAIN-world content scripts)
├── data/twenty/
│   ├── packs/           5 YAML Action Packs (PM-editable, no code)
│   ├── scenarios/       19 JSON scenario fixtures
│   └── fixtures/        Twenty seed-data IDs (runtime — gitignored)
├── tests/               pytest suite (45 tests) + pack-engine regression runner
├── scripts/             setup_twenty.sh, seed_twenty.py, smoke_e2e.sh
├── deploy/              Docker Compose for local dev
├── docs/                architecture, how_to_run, twenty_integration, demo walkthrough
├── LICENSE              MIT
└── README.md            (this file)
```

## 10. License

MIT — see [LICENSE](LICENSE).

Copyright © 2026 Khoa Pham.
