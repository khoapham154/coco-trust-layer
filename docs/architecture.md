# Architecture

Coco sits between AI agents and the SaaS they act on. Before the agent
mutates a record, it asks Coco. The gateway evaluates a YAML policy
against live state, returns a verdict, and writes the decision to the
audit log.

## Three pillars

- **Define.** Action Packs (YAML) describe what an agent is allowed to do.
- **Enforce.** The gateway evaluates the pack against live UI state on
  each call and returns a verdict.
- **Observe.** Every verdict lands in the audit ledger for compliance
  and replay.

## Request flow

```
Agent ──► Coco SDK ──► Gateway ──┬─► Pre-conditions  ─┐
(N8N,     (embedded   (FastAPI)  ├─► Constraints      ├─► Verdict
 Zapier,   in SaaS               └─► Post-conditions  ─┘   (ALLOW /
 custom)   frontend)                                       BLOCK /
                                  │                        ESCALATE)
                                  └─► SQLite audit log
```

Every request short-circuits on the first failing check. The matching
`on_fail` verdict and `reason` become the decision's primary reason.

## Live Twenty path

The dashboard and the agent share the same gateway. The agent reads
Twenty REST and projects it into the pack-ready `ui_state` shape.

```
            ┌──────────── Dashboard (/dashboard) ─────────────┐
            │                                                 │
            │  Live · Escalations · Packs · Audit · Settings  │
            │                                                 │
            └──────────────────▲─────────────┬────────────────┘
                               │             │
                       /api/audit             │ POST /api/scenarios/{id}/run
                       /api/metrics/live      │      ?driver=engine|twenty
                       /api/escalations       │
                       /api/packs[/yaml]      ▼
┌──────────────────────────────────────────────────────────────┐
│  Coco Gateway (FastAPI :8080)                                │
│  validate · packs · packs_yaml · scenarios · metrics ·       │
│  escalations · audit · audit_advanced · twenty_ops · demo    │
└──────────────────▲───────────────────────────────────────────┘
                   │ TwentyStateProvider reads /rest/* and
                   │ projects it to ui_state.
┌──────────────────▼───────────────────────────────────────────┐
│  Twenty CRM (docker compose :3000)                           │
└──────────────────▲───────────────────────────────────────────┘
                   │ Bookmarklet or extension injects
                   │ coco-sdk.js + inject.js (shadow DOM)
                   │
              User's browser
```

Two drivers share the same evaluator:

- `driver=engine` runs the scenario's fixture `ui_state` straight through
  the engine. No external services. Used by the regression runner.
- `driver=twenty` lets the agent build `ui_state` from live Twenty,
  call the gateway, and on `ALLOW` execute the mutation.

When Twenty is unreachable, the agent falls back to the scenario's own
fixture state. The gateway still runs, the audit row still lands.

## Pack model

Each pack (`data/twenty/packs/*.yaml`) has three sections:

- **`pre_conditions`.** Typed checks that must pass before the action
  runs. Each one has a `type` (`exists`, `not_empty`, `equals`,
  `greater_than`, ...), a `path` into the UI state, an expected `value`,
  and an `on_fail` verdict.
- **`constraints`.** Boolean DSL expressions. The DSL is a safe subset
  of Python (no calls, no imports, no dunders). State keys become
  top-level names:
  ```
  deal.amount < 50000 or deal.manager_field_filled == True
  ```
- **`post_conditions`.** Same shape as `pre_conditions`. They run after
  the mutation and catch silent failures (API returned 200 but the UI
  still shows the old value).

## Why state is pre-aggregated

The DSL forbids function calls, so rules cannot iterate lists. Instead
the state provider pre-computes aggregates before calling the gateway:

```json
{
  "email": {
    "recipient_count": 42,
    "has_flagged_recipient": false,
    "all_recipients_have_email": true
  }
}
```

A rule then reduces to a comparison:

```
email.recipient_count <= 50
not email.has_flagged_recipient
```

This keeps the DSL tiny and auditable, which is what a compliance
product needs.

The first concrete provider is `backend/providers/twenty.py`. It exposes
one method per pack family: `deal_state`, `contact_state`,
`opportunity_state`, `email_state`, `field_update_state`. Each hits
Twenty REST and returns a dict shaped for the matching pack.
`agents/twenty_agent.py` composes provider, gateway and Twenty mutation
into one traceable run.

## Verdicts

- **`ALLOW`.** Every check passed. The agent proceeds.
- **`BLOCK`.** A hard rule was violated. The action must not run.
- **`ESCALATE`.** A soft rule was violated. A human reviews it in the
  dashboard. Approve writes a follow-up ALLOW; deny writes a follow-up
  BLOCK.
- **`ROLLBACK`.** Reserved for post-action revert. Not in the MVP.

## Short-circuit semantics

Checks run in order:

1. `pre_conditions` (or `post_conditions` when `phase == "post"`).
2. `constraints` (only when `phase == "pre"`).

The first failing check wins. Its `on_fail` verdict and `reason` become
the decision's `primary_reason`. All checks that ran are recorded in
the decision's `checks` array.

## Audit log

Every `/api/validate` call writes one row to `audit_log` (SQLite by
default, PostgreSQL the production upgrade path). The row contains
timestamp, pack_id, action, phase, verdict, primary_reason and the full
decision JSON for replay. Escalation approve/deny decisions live in a
sibling `escalation_status` table and also write follow-up audit rows.

## Pack edits

`PUT /api/packs/{id}/yaml` validates with the existing pydantic schema,
snapshots the previous version to
`data/twenty/packs/_versions/<pack id>/<timestamp>.yaml`, writes the
new file, and hot-reloads the engine. The next verdict uses the new
policy. Revert restores any snapshot.

## Scope

The gateway owns:

- `/dashboard` (`backend/dashboard/`).
- SDK delivery at `/sdk/*`.
- `/api/scenarios` and the engine/twenty drivers.
- The sandbox at `/sandbox/twenty` for trying the user-facing overlay
  without standing up Twenty.

The gateway does not own:

- Browser state capture (the SDK handles that).
- State pre-aggregation for list rules (a provider's job).
- Agent orchestration (N8N, Zapier and custom agents call the gateway,
  not the other way round).
- Hosting Twenty (`scripts/setup_twenty.sh` is a demo convenience).
