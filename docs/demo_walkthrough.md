# Product walkthrough

This doc walks through the Trust Layer the way a real user touches it.
Six journeys, written from each user's point of view. Each step lists
the input the user gives and the response the product returns.

The walkthrough doubles as product docs and as a recording outline.

## Surfaces

- **Dashboard.** `http://localhost:8080/dashboard`. Where admins,
  policy authors and auditors work.
- **Twenty CRM overlay.** Small badge, modal and drawer injected into a
  Twenty tab by the SDK or bookmarklet. Where end users see Coco.

## Pre-flight

Gateway up in tmux:

```bash
tmux new-session -d -s coco_gateway -c /mnt/khoa/coco/coco-trust-layer
tmux send-keys -t coco_gateway \
  'conda activate coco && PYTHONPATH=$PWD COCO_ALLOW_DEMO_RESET=1 uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8080' Enter
sleep 3
curl -s localhost:8080/health
# {"status":"ok","packs_loaded":5}
```

Open `http://localhost:8080/dashboard`. Verify the **Live** view loads
with tiles populated, the sidebar shows nav items, and the health pill
top-right is green.

---

## Journey A · Integrator installs Coco

The first time someone opens the dashboard.

| Step | User | Product |
|---|---|---|
| A1 | Lands on `#/onboarding` (or `#/integrations`) | Four-step card stack: Gateway up ✓, Connect Twenty, Install SDK, Watch first verdict. |
| A2 | Goes to **Integrations** | Three cards: Twenty CRM (needs creds), JavaScript SDK (copy-paste snippet + bookmarklet), Coco Gateway (healthy). |
| A3 | Pastes Twenty base URL and API key, hits **Test connection** | Spinner → green "Connected" pill. Creds saved to `localStorage`. |
| A4 | Drags the purple bookmarklet to the bookmarks bar, opens Twenty, clicks it | Coco badge appears bottom-right inside Twenty (`Coco · Gateway · 5 packs · Validate`). |
| A5 | Returns to dashboard | Onboarding step 4 is now active. Live feed will pick up the first verdict as soon as one fires. |

## Journey B · Admin's daily Live view

Default landing after install. The "watch the gateway" view.

| Step | User | Product |
|---|---|---|
| B1 | Opens `#/live` | Four tiles: Verdicts/hour, Block rate (with delta), p95 latency, Escalations pending. Feed shows the last 100 verdicts, newest top. |
| B2 | Clicks any row | Right drawer slides in. Top: verdict badge + plain-English reason. Mid: meta grid (pack, action, phase, time, audit ID). Then: per-check pass/fail list with observed values. Then: highlighted YAML of the policy that fired. Footer: "Open pack" and "View in audit" links. |
| B3 | Hits **Esc** | Drawer closes. |
| B4 | Hits **j** / **k** | Selection moves down/up the feed. **Enter** opens the drawer for the selected row. |
| B5 | Types in the search bar `"skip"` | Feed filters to BLOCK rows about skipping deal stages. URL updates → refresh keeps the filter. |
| B6 | Clicks the **BLOCK** chip | Feed and tiles both narrow to BLOCK verdicts only. |
| B7 | Hits **⌘K** / **/** | Command palette opens. Jump to any view, pack, or scenario. |

## Journey C · Admin handles an escalation

| Step | User | Product |
|---|---|---|
| C1 | Sidebar shows orange badge "9" on Escalations. Clicks it. | Queue view: each ESCALATE row as a card. Pack, action, time, plain reason, side-by-side current state vs proposed action, Approve / Deny / Details buttons. |
| C2 | Clicks **Approve** on a card | Prompt for optional comment → POST `/api/escalations/{id}/approve`. Card removed from queue. A follow-up ALLOW audit row is written, visible in Live + Audit. |
| C3 | Clicks **Deny** on another | Same flow, follow-up BLOCK row written. |
| C4 | Clicks **Details** | Verdict drawer opens with the full original decision and YAML. |

## Journey D · Admin edits a policy

The product's central promise: change policy without redeploying code.

| Step | User | Product |
|---|---|---|
| D1 | From a Live drawer, clicks **Open pack** | Routes to `#/packs/twenty.bulk_email`, that pack pre-selected. Sidebar shows all five packs. |
| D2 | Sees the pack header (name, action, description, version chip), the YAML viewer, and a list of attached regression scenarios with last-run verdict colors. | · |
| D3 | Clicks **Edit** | YAML viewer flips to a textarea editor. Save / Cancel buttons appear. |
| D4 | Bumps `max_recipients` from 50 to 250, hits **Save** | Backend validates YAML, snapshots the current version to `data/twenty/packs/_versions/<pack_id>/<timestamp>.yaml`, writes the new file, hot-reloads the engine. Toast: *"Pack saved · live now."* Version chip updates. |
| D5 | Clicks **Run** on the `bulk_email_block_over_limit` scenario row | POST `/api/scenarios/.../run`. New verdict is ALLOW now (was BLOCK with the old threshold). Toast confirms. |
| D6 | Returns to Live | Top of the feed shows the new ALLOW row. |

## Journey E · End user inside Twenty hits a block

The user-facing surface. What an actual CRM operator sees.

| Step | User | Product |
|---|---|---|
| E1 | In Twenty, on a deal page. Coco badge sits in the corner. | Badge dot: green = gateway OK. Text: `Gateway · 5 packs`. |
| E2 | Clicks the Coco **Validate** button (or triggers an action wired to the SDK). | Badge dot pulses amber while validating. |
| E3 | If verdict = BLOCK | Centered modal slides over Twenty. Pill: BLOCKED. Title: *Action blocked by policy*. Body: plain-English reason. Below, a compact code block names the policy + the failing rule. Foot buttons: **See policy** · **Request override** · **Cancel** (default). |
| E4 | Clicks **See policy** | Right-side drawer slides in. Drawer body: full YAML of the policy with the firing rule highlighted in purple, auto-scrolled into view. |
| E5 | Closes drawer (× or Esc), clicks **Request override** | Prompt for a reason. POST `/api/demo/escalate`. Modal closes. Verdict card flips to amber ESCALATE *"Pending review · manager will be notified."* Escalation appears in the admin's queue (Journey C). |
| E6 | If verdict = ALLOW | Small corner card slides in with a green ALLOW pill. Auto-dismisses in 14 seconds. |

## Journey F · Auditor exports the quarter

| Step | User | Product |
|---|---|---|
| F1 | Opens **Audit Ledger** | Full-width table. Filter bar: search by reason text, pack dropdown, ALLOW/BLOCK/ESCALATE chips, date range. |
| F2 | Sets date range Q1, clicks BLOCK chip. | Table updates. Footer: *"1,247 rows · 14 packs"*. URL updates so the filter is shareable. |
| F3 | Clicks **Export CSV** | Browser download. Every row has full decision JSON in the `decision` column. The CSV respects the active filters. |
| F4 | Wants to drill into a specific row | Clicks the row → drawer opens with the full decision. |

---

## Keyboard reference

| Key | What it does |
|---|---|
| `⌘K` / `Ctrl-K` / `/` | Open command palette |
| `j` / `k` | Move selection down / up the Live feed |
| `Enter` | Open drawer for the selected row |
| `Esc` | Close palette > drawer > modal (whichever is open) |

## URL state

All filters and selections live in the URL hash:

- `#/live?v=BLOCK&pack=twenty.bulk_email&q=skip`
- `#/packs/twenty.deal_stage_move?q=stage`
- `#/audit?v=BLOCK&from=2026-01-01&to=2026-03-31`
- `#/audit?id=142` (deep-link to a specific audit row)

Refresh keeps state. Links are shareable.

## Where things live

| File / route | Purpose |
|---|---|
| `backend/dashboard/templates/index.html` | App shell (sidebar + topbar + main + drawer + palette + toasts). |
| `backend/dashboard/static/styles.css` + `tokens.css` | Design tokens and component styles. |
| `backend/dashboard/static/app.js` | Router + per-view renderers + shared components. |
| `frontend/inject.js` | Twenty-side overlay (badge, verdict card, blocked modal, policy drawer). Renders into a shadow DOM root. |
| `frontend/coco-sdk.js` | Stateless validate client. |
| `backend/routes/metrics.py` | `/api/metrics/live`, tiles. |
| `backend/routes/escalations.py` | `/api/escalations` + approve/deny. |
| `backend/routes/audit_advanced.py` | `/api/audit/search` + `/api/audit/export.csv`. |
| `backend/routes/packs_yaml.py` | `/api/packs/{id}/yaml` (GET/PUT), `/versions`, `/revert`. |
| `data/twenty/packs/*.yaml` | The 5 default packs. |
| `data/twenty/packs/_versions/<pack>/` | Auto-snapshotted prior versions. |
| `data/runtime/audit.db` | SQLite audit log (+ escalation_status table). |

## Shutdown

```bash
tmux kill-session -t coco_gateway
```
