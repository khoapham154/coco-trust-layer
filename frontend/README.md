# Coco SDK

Vanilla JS, no dependencies, one file. Embed in a SaaS frontend to capture
UI state and validate agent actions against the Coco gateway before they
run.

## Quick start

```html
<script src="/path/to/coco-sdk.js"></script>
<script>
  Coco.init({ gatewayUrl: "http://localhost:8080", appId: "twenty" });

  // On each agent action, capture state and ask the gateway:
  async function onAgentMoveDealStage(targetStage) {
    const state = {
      deal: {
        owner: Coco.captureState({ x: "[data-testid='deal-owner']" }).x,
        amount: Number(document.querySelector("[data-testid='deal-amount']").dataset.cocoValue),
        target_stage: targetStage,
        prev_stage_tasks_completed: true,
        is_sequential_stage_move: true,
        manager_field_filled: false,
      },
      user: { role: "sales" },
    };
    const decision = await Coco.validate(
      "move_stage",
      state,
      "twenty.deal_stage_move",
      "pre"
    );
    if (decision.verdict === "BLOCK") {
      alert("Blocked: " + decision.primary_reason);
      return false;
    }
    return true;
  }
</script>
```

## API

### `Coco.init({ gatewayUrl, appId? })`
Set the gateway URL and app identifier. Must be called before `validate`.

### `Coco.captureState(selectors)`
Read DOM values into a plain object. Selectors are CSS selectors; values
come from `[data-coco-value]`, `el.value`, or `el.textContent` in that
order.

Nested selector objects produce nested state:
```js
Coco.captureState({
  deal: {
    owner: "[data-testid='owner']",
    amount: "[data-testid='amount']"
  }
});
```

### `Coco.validate(action, uiState, packId, phase?)`
POST to `${gatewayUrl}/api/validate`. Returns the full decision:
```js
{
  verdict: "ALLOW" | "BLOCK" | "ESCALATE",
  pack_id, action, phase,
  primary_reason,
  checks: [{ check_id, kind, passed, reason, observed }],
  timestamp
}
```
Throws on HTTP error.

### `Coco.onVerdict(cb)`
Register a callback fired on every verdict (useful for logging or a
global "blocked" banner).

### `Coco.reset()`
Clear config + handlers. Intended for tests.

## Smoke test

```bash
cd frontend
python -m http.server 8000
# open http://localhost:8000/ in a browser
```

Set the gateway URL (default `http://localhost:8080`), pick a pack, edit
the JSON state, click Validate. The verdict renders below with a colored
badge.

## Integration points

In a SaaS frontend, wire `Coco.validate(...)` into the click handler
for any agent-initiated action. When the verdict is not `ALLOW`, show the
`primary_reason` to the user and return early.
