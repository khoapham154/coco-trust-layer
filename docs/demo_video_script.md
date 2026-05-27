# Coco Trust Layer · Customer Journey Demo · Video Script

Hand this to the editor recording the demo. One continuous customer
journey, around five minutes. Every button, modal, and screen line is
verbatim, so the recording matches the script.

## At a glance

| Scene | Title | Time |
|---|---|---|
| 1 | Cold open | 0:00-0:20 |
| 2 | Where Coco sits | 0:20-0:50 |
| 3 | The operator's surface | 0:50-2:05 |
| 4 | The admin's Live view | 2:05-2:50 |
| 5 | Escalation queue | 2:50-3:15 |
| 6 | Edit policy, no redeploy | 3:15-4:00 |
| 7 | Audit ledger | 4:00-4:25 |
| 8 | How it ships | 4:25-4:50 |
| 9 | Close | 4:50-5:10 |

Shorter cut: drop scenes 5 and 7 for roughly three minutes.

## Setup

The demo runs on the editor's own Windows machine, straight from the
GitHub repo. No tunnel, no dependency on Khoa's server staying up.

**One-time, on the editor's PC.**

1. Install Python 3.11 from python.org. Tick "Add python.exe to PATH".
2. Get the repo from `github.com/khoapham154/coco-trust-layer`: click
   **Code → Download ZIP** and unzip, or `git clone` it. If the repo is
   private, Khoa adds the editor as a collaborator first.
3. Double-click `run_demo.bat` in that folder. The first run installs
   dependencies and seeds sample verdicts, so the Live feed and ledger
   have rows. Leave the black window open while recording.

**Then, in Chrome.** Window 1440 x 900, page zoom 110%, bookmarks bar
and notifications hidden, OS large-cursor on. Open two tabs:

1. `http://localhost:8080/dashboard`
2. `http://localhost:8080/sandbox/twenty`

To stop the server, press Ctrl+C in the black window and close it. If a
page fails to load, check the black window is still open and shows
"Application startup complete", then refresh.

## Voice and music

Warm, confident B2B explainer, around 150 words per minute. No
exclamation marks, no words like "powerful" or "seamless". One ambient
music track at about -22 dB, cut to silence on the BLOCK modal in scene
3, resume on scene 4. Brand purple `#a78bfa`, ALLOW green `#10b981`,
BLOCK red `#ef4444`, ESCALATE amber `#f59e0b`.

---

## Scene 1 · Cold open · 0:00-0:20

**On screen.** Dark background, two lines of white text fade in:

> AI agents are writing to your CRM right now.
> Most of them did not ask permission.

**Voiceover.** AI agents are powerful. They do not ask permission.
Once an agent has API access, it can update your CRM, move money, or
change records, with no human in the loop and no audit trail behind it.

**Transition.** Cross-fade to the diagram.

## Scene 2 · Where Coco sits · 0:20-0:50

**On screen.** Static diagram: AI agent → Coco Trust Gateway (ALLOW ·
BLOCK · ESCALATE) → System of record, with an immutable audit log
dropping out of the gateway. Reuse the layout from
`ideas_testing/01_pitch_and_application/2026-05_Coco_Pitch_Script_Short.md`.

**Voiceover.** Coco is the trust layer between AI agents and the
systems they act on. Every action the agent wants to take comes to our
gateway first. We return a verdict in milliseconds: ALLOW, BLOCK, or
ESCALATE. Every decision lands in an immutable audit log.

**Lower third.** Coco · Trust layer for AI agents.

**Transition.** Cut to the sandbox tab.

## Scene 3 · The operator's surface · 0:50-2:05

The user-facing layer, and the centrepiece of the video.

**On screen.** Sandbox tab, `<BASE_URL>/sandbox/twenty`. Deal card:
Stage NEW, Amount 82,000, Owner Ada Chen, Prev-stage tasks All
complete, Manager field empty. Four buttons below. Coco badge
bottom-right reads `Coco · Gateway · 5 packs · Validate`, green dot.

**Voiceover.** This is what an operator sees. A deal in Twenty CRM. In
the corner, the Coco badge. Green dot means the gateway is healthy and
five policy packs are live.

**The BLOCK.** Click **Move stage NEW → NEGOTIATION (skip)**. Badge
pulses amber, then a centred modal slides in:

> ● BLOCKED · Action blocked by policy
> Cannot skip deal stages
> Policy: twenty.deal_stage_move · Rule: sequential_stage (constraint)
> [ See policy ]   [ Cancel ]

Hold three seconds, music to silence.

**Voiceover.** An AI agent tried to move this deal straight to
negotiation, skipping the screening stage. Coco intercepts and names
the policy and the rule that fired.

**See policy.** Click **See policy**. Right drawer slides in with the
pack YAML, the `sequential_stage` rule highlighted in purple:

```yaml
- id: sequential_stage
  rule: deal.is_sequential_stage_move == true
  on_fail: BLOCK
  reason: Cannot skip deal stages
```

Hold four seconds.

**Voiceover.** One click opens the policy. The rule, the verdict, the
reason in plain English. RevOps wrote this file. Engineering did not
ship code for this guardrail to exist.

Press Esc to close the drawer.

**Three more verdicts.** Click each, let the pill show for a beat:

- **Move stage NEW → SCREENING** → amber ESCALATE card, "Deals over
  $50K require the manager field to be filled."
- **Delete contact** → green ALLOW card, "Contact has no open deals."
- **Send 80-recipient blast** → BLOCK modal, "Batch exceeds 50
  recipients. Policy: twenty.bulk_email."

**Voiceover.** Same gateway, four verdicts. Skip a stage, blocked. A
high-value move with no manager, escalated. A safe delete, allowed. An
oversized blast, blocked. Different packs, one engine.

**Transition.** Click **← Back to Coco dashboard** (top-right).

## Scene 4 · The admin's Live view · 2:05-2:50

**On screen.** Dashboard `#/live`. Four tiles: verdicts last hour,
block rate, p95 latency, escalations pending. Feed shows the rows from
scene 3 on top.

**Voiceover.** Same gateway, admin view. Every verdict the operator
triggered streams in here. Throughput, block rate, latency, escalations
waiting.

Click the top BLOCK row. A drawer opens: verdict, plain reason, meta
grid, per-check pass/fail with observed values, the firing YAML rule
highlighted, footer links.

**Voiceover.** Every row opens to the full decision. The reason, the
state the gateway observed, the rule that fired, the YAML version. Any
decision is replayable, no guessing what the agent saw.

Press Esc, then click the **BLOCK** chip.

**Voiceover.** Filter to BLOCKs. The URL updates and refresh keeps it.
Send the link to a teammate, they see the same view.

**Transition.** Sidebar → **Escalations**.

## Scene 5 · Escalation queue · 2:50-3:15

**On screen.** `#/escalations`. Cards with an ESCALATE pill, pack,
reason, current state vs proposed action, Approve / Deny / Details.

**Voiceover.** Some verdicts need a human. Current state on the left,
the action the agent wants on the right, the reason it paused in the
middle.

Click **Approve**, type "Manager unavailable, confirmed with VP",
submit. Card disappears, toast confirms.

**Voiceover.** Approve writes a follow-up ALLOW row, deny writes a
follow-up BLOCK. Both land in the audit log. Nothing is lost.

**Transition.** Sidebar → **Action Packs**.

## Scene 6 · Edit policy, no redeploy · 3:15-4:00

The central promise. Take your time here.

**On screen.** `#/packs`. Click **twenty.bulk_email**. The pack YAML
shows on the right with a version chip.

**Voiceover.** This is the central promise. Policy in YAML, not code.
Compliance writes the rules, Coco enforces them. Let me change one.

Click **Edit**, find `rule: email.recipient_count <= 50`, change 50 to
250, click **Save**. Toast: "Pack saved · live now."

**Voiceover.** Save. The gateway hot-reloads. The previous version
snapshots to disk so you can revert.

Switch to the sandbox tab, click **Send 80-recipient blast** again.
Green ALLOW card slides in.

**Voiceover.** Same action that was blocked a moment ago. Now ALLOW. No
deploy, no merge, no engineer on call. The team that owns the policy
changed it, the gateway adapted in seconds.

**Transition.** Back to the dashboard, sidebar → **Audit Ledger**.

## Scene 7 · Audit ledger · 4:00-4:25

**On screen.** `#/audit`. Full-width table with search, pack dropdown,
verdict chips, date range.

**Voiceover.** Every verdict, every reason, every pack version that
fired. Filter by pack, verdict, or date. Search the reason text.

Click the **BLOCK** chip, set the date range, then click **Export
CSV**. Download bar appears.

**Voiceover.** Export to CSV. Every row carries the full decision JSON.
Internal audit, regulators, incident reviews get the trail they need.

**Transition.** Sidebar → **Integrations**.

## Scene 8 · How it ships · 4:25-4:50

**On screen.** `#/integrations`. Three cards: Twenty CRM (base URL +
API key), JavaScript SDK (script snippet + the `Coco · drag me` pill),
Coco Gateway (Healthy, endpoints listed).

**Voiceover.** Install is three pieces. Connect the SaaS you want
governed, drop the SDK into the frontend, the gateway is already
running. The bookmarklet lets a non-engineer try Coco on Twenty before
anyone redeploys anything.

**Voiceover.** One SDK, one gateway, one YAML pack per integration. A
new vertical is a new pack, not a new product. Banking, support, ERP,
internal tools, same engine, different rulebooks.

**Transition.** Fade to the closing card.

## Scene 9 · Close · 4:50-5:10

**On screen.** Dark closing card, Coco wordmark on top, three lines fade
in one per beat:

> Verdict in milliseconds.
> Audit trail every time.
> Policy you can read.

**Voiceover.** Coco. Trust layer for AI agents. Verdict in
milliseconds, audit trail every time, policy your team can read and
own.

Beat.

**Voiceover.** We are recruiting design partners. Pick one agent flow,
we write the first pack with your team. Shadow mode for a week, then
flip to enforce.

**On screen.** Contact card:

> Khoa Pham · khoa.pham@monash.edu
> github.com/khoapham154/coco-trust-layer

Hold three seconds, fade to black.

**End.**

---

## Editor notes

- **Captions.** Burn in every voiceover line, bottom centre. Most
  viewers watch muted.
- **Aspect ratios.** Master 1920 x 1080. For a 9:16 social cut, keep
  scenes 1, 2, 3, 6, 9 and re-frame the sandbox so the deal card and
  modal stay centred.
- **Three-minute cut.** Drop scenes 5 and 7. End scene 6 with one line:
  "Every decision lands in the audit ledger; install is one SDK and one
  YAML pack per integration."
- **Do not** record real customer data, show any terminal, or mention
  "L2" or "L3" in the voiceover. They are roadmap, not this build.
- **Hand-off.** Final master and cuts go to Khoa before publication.
