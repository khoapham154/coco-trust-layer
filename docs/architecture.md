# CoCo Trust Layer — Architecture

## What it is

CoCo is the Trust Layer between AI agents and Enterprise SaaS. It enforces
behavioral contracts (Action Packs) at runtime, before an agent touches
the SaaS, and catches silent failures after the action by comparing the
observed UI state against post-conditions.

## Three pillars

- **Define** — Action Packs (YAML) describe what an agent is allowed to do.
- **Enforce** — The Gateway runs the pack against a live UI state on every
  request and returns a verdict.
- **Observe** — Every verdict is persisted to the audit log for
  traceability and compliance.

## Request flow

```
Agent ──► CoCo SDK ──► Gateway ──┬─► Pre-conditions  ─┐
(N8N,    (embedded    (FastAPI)  ├─► Constraints       ├─► Verdict
 Zapier,  in SaaS                └─► Post-conditions  ─┘   (ALLOW/BLOCK/
 custom)  frontend)                                        ESCALATE)
                                   │
                                   └─► SQLite audit log
```

Every request short-circuits on the first failing check and returns the
matching verdict from the pack's `on_fail` field.

## End-to-end with live Twenty CRM

The end-to-end path grounds every verdict in
actual CRM state rather than a fixture:

```
            ┌──────────────────────────── Dashboard (/dashboard) ──────────┐
            │                                                               │
            │   [Pack grid]   [Scenario grid]   [Verdict panel]   [Audit]   │
            │                                                               │
            └──────────────────────────▲──────────────────┬─────────────────┘
                                       │                  │
                              /api/scenarios              │ POST /api/scenarios/{id}/run
                              /api/audit                  │      ?driver=engine|twenty
                                       │                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  CoCo Gateway (FastAPI :8080)                                            │
│                                                                          │
│  routes/validate    ◄───── agent HTTP POST (sync httpx, threadpooled)    │
│  routes/scenarios   ─────► agents.TwentyAgent.run(id)                    │
│  routes/packs        read ─► data/twenty/packs/*.yaml                    │
│  routes/audit        read ─► db/audit.db                                 │
│  routes/dashboard   serve ─► backend/dashboard/templates/index.html      │
│  /sdk/* + /static/* serve ─► frontend/*.js + backend/dashboard/static/*  │
└──────────────────────────────────────▲───────────────────────────────────┘
                                       │
                                       │  TwentyStateProvider builds ui_state
                                       │  from live Twenty REST responses
                                       │
┌──────────────────────────────────────▼───────────────────────────────────┐
│  Twenty CRM (docker compose :3000)                                       │
│  /rest/opportunities, /rest/people, /rest/companies, /rest/tasks         │
└──────────────────────────────────────▲───────────────────────────────────┘
                                       │
                                       │  Bookmarklet injects CoCo SDK into
                                       │  the live Twenty tab (inject.js)
                                       │
                                  User's browser
```

Two drivers share the same gateway:

- **`driver=engine`** — scenario's fixture `ui_state` goes straight to
  the engine. Fast, no external services. Used by
  `run_twenty_scenarios.py` and `tests/test_dashboard.py`.
- **`driver=twenty`** — `TwentyAgent` loads the scenario, asks
  `TwentyStateProvider` to build live `ui_state` from Twenty REST, calls
  `/api/validate` (via a thread so sync httpx doesn't deadlock the
  event loop), and on `ALLOW` performs the real CRUD (PATCH stage,
  DELETE contact, PATCH field, …). On `BLOCK` or `ESCALATE` it records
  the refusal and skips the mutation.

When Twenty isn't running, `driver=twenty` degrades gracefully: the
agent falls back to the scenario's own fixture state, still calls the
real gateway, and still writes an audit row. This is what the
`smoke_e2e.sh` "driver=twenty path reachable" assertion is exercising.

## Data model

A pack (`data/twenty/packs/*.yaml`) has three sections:

- **`pre_conditions`** — checks that must pass before the action runs.
  Each check has a `type` (`exists`, `not_empty`, `equals`, `greater_than`,
  ...), a `path` into the UI state, an expected `value`, and an `on_fail`
  verdict.
- **`constraints`** — boolean DSL expressions. The DSL is a safe subset of
  Python (no calls, no imports, no dunder access) evaluated against the UI
  state. Keys of the state become top-level names:
  ```
  deal.amount < 50000 or deal.manager_field_filled == True
  ```
- **`post_conditions`** — same shape as `pre_conditions`, run *after* the
  action. This is the silent-failure detector: if the API returned 200 but
  the UI still shows the old value, post-conditions catch it.

## Why the DSL pre-aggregates list checks

The DSL does not allow function calls, so rules can't iterate lists
(`any(r.do_not_contact for r in email.recipients)` is illegal). Instead,
the state provider pre-computes aggregates *before* calling the gateway:

```json
{
  "email": {
    "recipient_count": 42,
    "has_flagged_recipient": false,
    "all_recipients_have_email": true
  }
}
```

The rule then becomes a simple comparison:

```
email.recipient_count <= 50
not email.has_flagged_recipient
```

This is how real state adapters already work (`state_provider.py` pattern),
and it keeps the DSL tiny and auditable — critical for a compliance
product.

The first concrete adapter is
[`backend/providers/twenty.py`](../backend/providers/twenty.py). It
exposes one method per pack family — `deal_state`, `contact_state`,
`opportunity_state`, `email_state`, `field_update_state` — each of
which hits Twenty REST and returns a dict that matches the
`ui_state` shape the corresponding pack expects. The
`TwentyAgent.run(scenario_id)` driver composes provider + gateway +
Twenty REST into one observable trace.

## Verdicts

- **`ALLOW`** — every check passed. The agent is cleared to execute.
- **`BLOCK`** — a hard rule was violated. The action must not run.
- **`ESCALATE`** — a soft rule was violated. A human must review before
  running.
- **`ROLLBACK`** — (reserved) post-action revert. Not implemented in the
  MVP.

## Short-circuit semantics

Checks run in order:

1. `pre_conditions` (or `post_conditions` when `phase == "post"`)
2. `constraints` (only on `phase == "pre"`)

The first failing check wins. Its `on_fail` verdict and `reason` are the
decision's `primary_reason`. All checks that ran are recorded in the
decision's `checks` array for audit.

## Audit log

Every call to `/api/validate` writes one row to `audit_log` (SQLite by
default, PostgreSQL is the production upgrade path). The row contains the
timestamp, pack_id, action, phase, verdict, primary_reason, and the full
decision JSON for replay.

## Scope boundary

This module is the **runtime enforcement layer**. It does not own:

- State capture from the browser — that is the SDK's job
  (`frontend/coco-sdk.js`).
- State pre-aggregation for list rules — the state provider in the partner
  SaaS adapter is responsible (`backend/providers/twenty.py` is the first
  reference implementation).
- Agent orchestration — N8N, Zapier, and custom agents call the gateway;
  the gateway does not call them. `agents/twenty_agent.py` is a reference
  driver that happens to live in this repo but could equally live in a
  customer's codebase.
- Hosting Twenty — the `scripts/setup_twenty.sh` self-host is a
  convenience for demos; production Twenty is whatever the customer runs.

What the gateway *does* own:

- The dashboard at `/dashboard` (`backend/dashboard/`).
- Serving the SDK + inject bootstrap at `/sdk/*`.
- `/api/scenarios` — exposing the 19 pre-built scenarios to the UI and
  running them against either driver.
