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
  SaaS adapter is responsible.
- Agent orchestration — N8N, Zapier, and custom agents call the gateway;
  the gateway does not call them.
- Dashboard UI — a separate frontend consumes `/api/audit`.
