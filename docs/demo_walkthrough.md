# CoCo Trust Layer — Team Demo Walkthrough

A 7-minute live click-through. Run this in a team huddle once the gateway
is up and (optionally) Twenty is up. No slides needed — the dashboard is
the slide deck.

## Before the call — 2-minute setup

```bash
cd /mnt/khoa/coco/coco-trust-layer

# 1. Gateway in tmux
tmux new-session -d -s coco_demo -c $PWD
tmux send-keys -t coco_demo \
  'conda activate coco && PYTHONPATH=$PWD uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8080' Enter
sleep 3
curl -s localhost:8080/health | jq    # expect status: ok, packs_loaded: 5

# 2. (Optional) Twenty — skip if first-time setup would eat the clock
bash scripts/setup_twenty.sh          # ~60s first time
export TWENTY_API_KEY="..."
python scripts/seed_twenty.py

# 3. Open two browser tabs
open http://localhost:8080/dashboard  # CoCo
open http://localhost:3000            # Twenty (if running)
```

Keep a terminal visible for the audit-log reveal at the end.

---

## The script

### 0. Frame it (30 seconds)

> "CoCo is the Trust Layer between AI agents and enterprise SaaS. When
> an agent wants to move a deal, delete a contact, or send a bulk email,
> it asks CoCo first. CoCo reads the live UI state, runs it through a
> YAML behavioral contract, and returns ALLOW, BLOCK, or ESCALATE. Every
> verdict is audited. That's the whole product. Let me show you."

### 1. The dashboard (1 min)

**Open** `http://localhost:8080/dashboard`.

Point at each section:

- **Top bar** — "Gateway is live, 5 packs loaded, 19 scenarios staged."
- **Flow strip** — "Agent captures state → sends to gateway → engine
  runs the pack → verdict + audit."
- **Pack grid** — "Five Twenty CRM packs. Each one is a YAML file a
  product manager can edit without touching code."
- **Click `twenty.deal_stage_move`.**
  > "This pack governs pipeline transitions. Pre-conditions check the
  > deal has an owner. Constraints say 'amount below 50k or manager field
  > filled.' Post-conditions verify the move actually landed — that's
  > our silent-failure detector."

### 2. Run a scenario — engine driver (1 min)

**Scroll to the scenario grid. Keep the driver toggle on `engine`.**

> "19 scenarios cover every pack — green expected ALLOW, red expected
> BLOCK, amber expected ESCALATE. Let me run a known ALLOW."

**Click `deal_stage_move_allow`.**

- Verdict panel fills with a green ALLOW badge.
- Check rows tick through pre-conditions, constraints, post-conditions.
- Primary reason: "All checks passed."

> "That's the happy path. Now the same pack, deal with no owner."

**Click `deal_stage_move_block_no_owner`.**

- Red BLOCK badge.
- First failing check highlighted: `deal.owner not_empty → FAIL`.
- Primary reason: "Deal has no assigned owner."

> "The agent now has a machine-readable reason to refuse the action."

### 3. The audit log (30 sec)

**Scroll to the audit table at the bottom.**

> "Every verdict writes one row to SQLite. Timestamp, pack, action,
> phase, verdict, primary reason. Production upgrade path is Postgres —
> same schema."

**Switch to terminal briefly:**
```bash
curl -s localhost:8080/api/audit?limit=5 | jq '.[0]'
```

### 4. Real Twenty CRUD — the hero moment (2 min)

If Twenty is up, skip to this. If not, say: "Twenty's running on my
laptop in its own Docker stack — same demo, just faster to show here."

**Open the Twenty tab.** Point at Opportunities → Northwind Labs.

> "This is the real Twenty CRM, not a simulator. Seeded with 5
> companies, 10 people, 3 opportunities by a Python script."

**Back to CoCo dashboard.** **Flip driver toggle to `twenty`.**

> "Now the same scenario runs against live Twenty. The provider reads
> Twenty's REST — opportunity, tasks, stage — and builds a real `ui_state`.
> Pack verdicts it. On ALLOW, the agent actually PATCHes Twenty."

**Click `deal_stage_move_allow` with driver=twenty.**

- Green ALLOW.
- Verdict panel shows `twenty_response` with the new stage.
- **Switch to Twenty tab, refresh** — opportunity has moved stages.

> "Real CRUD. Driven by the verdict."

**Click `deal_stage_move_block_no_owner` with driver=twenty.**

- Red BLOCK.
- `twenty_response: null` — no mutation ran.
- **Refresh Twenty tab** — opportunity is untouched.

> "This is the core guarantee: if the gateway says no, Twenty doesn't
> move. The agent doesn't get a second opinion."

### 5. The SDK bookmarklet (1 min)

**Open `scripts/inject_bookmarklet.html` in a new tab.** Drag the
bookmarklet to the bookmarks bar.

**Switch to the Twenty tab. Click the bookmarklet.**

- A small floating CoCo badge appears bottom-right.
- Green dot — gateway reachable.
- "Validate current page" button.

**Click it.**

- Toast: "Verdict: ALLOW / BLOCK / ESCALATE" based on current page
  state.

> "That's the zero-code integration path. No fork, no frontend rebuild.
> Drop this script tag into any SaaS and every governed action gets
> a verdict. This is how we onboard a customer in under an hour."

### 6. Close (30 sec)

> "45 tests green. 19/19 pack regression green. The whole thing boots
> in 3 seconds, runs on SQLite for dev, PostgreSQL for prod. Questions?"

---

## Anticipated questions

| Q | Short answer |
|---|---|
| "What if the gateway is down?" | SDK fails open by default, configurable. The audit table shows nothing was verdicted, so the gap is observable. |
| "Latency?" | 3-6ms per verdict local, 20-40ms with Twenty REST. DSL is AST-evaluated in-process. |
| "Who writes the packs?" | Product managers. YAML + a tiny expression DSL. No Python needed. |
| "Why not just use OPA / Cedar?" | Both are great for API-layer decisions. Neither reads browser UI state. CoCo is the only layer that catches silent UI failures post-action. |
| "How do I add a new pack?" | Drop a YAML into `data/<saas>/packs/`, restart. Packs are data, not code. |
| "Can it replay?" | Audit table stores the full decision JSON. Yes. |

## Shutdown

```bash
tmux kill-session -t coco_demo
docker compose -f twenty/packages/twenty-docker/docker-compose.yml down
```
