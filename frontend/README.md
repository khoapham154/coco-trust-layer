# CoCo SDK

Vanilla JS, no dependencies, one file. Embed in a SaaS frontend to capture
UI state and validate agent actions against the CoCo gateway before they
run.

## Quick start

```html
<script src="/path/to/coco-sdk.js"></script>
<script>
  CoCo.init({ gatewayUrl: "http://localhost:8080", appId: "twenty" });

  // On each agent action, capture state and ask the gateway:
  async function onAgentMoveDealStage(targetStage) {
    const state = {
      deal: {
        owner: CoCo.captureState({ x: "[data-testid='deal-owner']" }).x,
        amount: Number(document.querySelector("[data-testid='deal-amount']").dataset.cocoValue),
        target_stage: targetStage,
        prev_stage_tasks_completed: true,
        is_sequential_stage_move: true,
        manager_field_filled: false,
      },
      user: { role: "sales" },
    };
    const decision = await CoCo.validate(
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

### `CoCo.init({ gatewayUrl, appId? })`
Set the gateway URL and app identifier. Must be called before `validate`.

### `CoCo.captureState(selectors)`
Read DOM values into a plain object. Selectors are CSS selectors; values
come from `[data-coco-value]`, `el.value`, or `el.textContent` in that
order.

Nested selector objects produce nested state:
```js
CoCo.captureState({
  deal: {
    owner: "[data-testid='owner']",
    amount: "[data-testid='amount']"
  }
});
```

### `CoCo.validate(action, uiState, packId, phase?)`
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

### `CoCo.onVerdict(cb)`
Register a callback fired on every verdict (useful for logging or a
global "blocked" banner).

### `CoCo.reset()`
Clear config + handlers. Intended for tests.

## Smoke test

Open `example.html` in a browser, set the gateway URL, pick a pack, edit
the JSON state, click Validate. The verdict renders below with colored
badge.

## Integration points

In a SaaS frontend, wire `CoCo.validate(...)` into the click handler
for any agent-initiated action. When the verdict is not `ALLOW`, show the
`primary_reason` to the user and return early.
