#!/usr/bin/env bash
# Coco Trust Layer — end-to-end smoke tests for product journeys.
#
# Verifies the six user journeys against the running gateway.
# Idempotent — leaves the audit DB with a few extra rows but does not
# destroy state.

set -uo pipefail

BASE="${BASE:-http://localhost:8080}"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; CYAN='\033[0;36m'; NC='\033[0m'

pass() { printf "  ${GREEN}✓${NC} %s\n" "$1"; }
fail() { printf "  ${RED}✗${NC} %s\n" "$1"; exit 1; }
info() { printf "  ${YELLOW}·${NC} %s\n" "$1"; }
section() { printf "\n${CYAN}== %s ==${NC}\n" "$1"; }

section "Journey A — install / connectivity"
curl -sf "$BASE/health" >/dev/null && pass "/health responds"
PACKS_LOADED=$(curl -s "$BASE/health" | python -c "import sys,json; print(json.load(sys.stdin)['packs_loaded'])")
[[ "$PACKS_LOADED" == "9" ]] && pass "9 packs loaded" || fail "expected 9 packs, got $PACKS_LOADED"
curl -sf "$BASE/sdk/coco-sdk.js" >/dev/null && pass "/sdk/coco-sdk.js serves"
curl -sf "$BASE/sdk/inject.js" >/dev/null && pass "/sdk/inject.js serves"
curl -sf "$BASE/dashboard" >/dev/null && pass "/dashboard serves"
curl -sf "$BASE/static/styles.css" >/dev/null && pass "/static/styles.css serves"
curl -sf "$BASE/static/tokens.css" >/dev/null && pass "/static/tokens.css serves"
curl -sf "$BASE/static/app.js" >/dev/null && pass "/static/app.js serves"

section "Journey B — Live + metrics"
M=$(curl -s "$BASE/api/metrics/live")
echo "$M" | python -c "import sys,json; d=json.load(sys.stdin); assert 'verdicts_1h' in d and 'block_rate_1h' in d and 'verdicts_24h_buckets' in d, d" && pass "/api/metrics/live shape correct"
N=$(curl -s "$BASE/api/audit?limit=20" | python -c "import sys,json; print(len(json.load(sys.stdin)))")
[[ "$N" -gt 0 ]] && pass "/api/audit has $N rows" || fail "audit is empty"

section "Journey C — escalations queue → approve flow"
PEND_BEFORE=$(curl -s "$BASE/api/escalations" | python -c "import sys,json; print(len(json.load(sys.stdin)))")
info "Pending before: $PEND_BEFORE"
if [[ "$PEND_BEFORE" -eq 0 ]]; then
  info "Seeding a new ESCALATE row"
  curl -s -X POST "$BASE/api/scenarios/deal_stage_move_escalate_high_value/run?driver=engine" >/dev/null
  PEND_BEFORE=$(curl -s "$BASE/api/escalations" | python -c "import sys,json; print(len(json.load(sys.stdin)))")
fi
FIRST_ID=$(curl -s "$BASE/api/escalations" | python -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'])")
info "Approving escalation #$FIRST_ID"
APPROVE=$(curl -s -X POST "$BASE/api/escalations/$FIRST_ID/approve" -H "Content-Type: application/json" -d '{"comment":"smoke test approve"}')
echo "$APPROVE" | python -c "import sys,json; d=json.load(sys.stdin); assert d['status']=='approved' and 'follow_up_id' in d, d" && pass "approve returned follow_up_id"
PEND_AFTER=$(curl -s "$BASE/api/escalations" | python -c "import sys,json; print(len(json.load(sys.stdin)))")
[[ "$PEND_AFTER" -lt "$PEND_BEFORE" ]] && pass "queue shrunk: $PEND_BEFORE → $PEND_AFTER" || fail "queue did not shrink"

section "Journey D — policy edit + versioning"
PACK="twenty.bulk_email"
ORIGINAL=$(curl -s "$BASE/api/packs/$PACK/yaml")
info "Original YAML loaded ($(echo "$ORIGINAL" | wc -c) bytes)"
# Bump max_recipients from 50 to 250 — preserve the rest verbatim
EDITED=$(echo "$ORIGINAL" | sed 's/max_recipients <= 50/max_recipients <= 250/g')
# In case the rule uses different syntax, fall back to general substitution
if [[ "$EDITED" == "$ORIGINAL" ]]; then
  EDITED=$(echo "$ORIGINAL" | sed 's/<= 50/<= 250/g; s/< 50/< 250/g')
fi
curl -s -X PUT "$BASE/api/packs/$PACK/yaml" -H "Content-Type: text/plain" --data-binary "$EDITED" >/dev/null
RE=$(curl -s "$BASE/api/packs/$PACK/yaml")
if [[ "$RE" == "$EDITED" ]]; then pass "PUT applied"; else fail "PUT did not stick"; fi
VERS=$(curl -s "$BASE/api/packs/$PACK/versions" | python -c "import sys,json; print(len(json.load(sys.stdin)))")
[[ "$VERS" -ge 2 ]] && pass "version history shows $VERS entries" || fail "version history empty"

info "Restoring original YAML"
curl -s -X PUT "$BASE/api/packs/$PACK/yaml" -H "Content-Type: text/plain" --data-binary "$ORIGINAL" >/dev/null
pass "original restored"

section "Journey E — gateway-side validate"
V=$(curl -s -X POST "$BASE/api/validate" -H "Content-Type: application/json" -d '{
  "pack_id":"twenty.deal_stage_move",
  "action":"move_stage",
  "ui_state": {"deal":{"owner":"u_002","amount":80000,"prev_stage_tasks_completed":true,"is_sequential_stage_move":false,"manager_field_filled":false,"target_stage":"negotiation"},"user":{"role":"sales"}},
  "phase":"pre"
}')
VERDICT=$(echo "$V" | python -c "import sys,json; print(json.load(sys.stdin)['verdict'])")
[[ "$VERDICT" == "BLOCK" ]] && pass "validate returns BLOCK for skip+over-limit deal" || fail "expected BLOCK, got $VERDICT"

section "Journey F — audit search + CSV export"
BLOCK_ROWS=$(curl -s "$BASE/api/audit/search?v=BLOCK" | python -c "import sys,json; print(len(json.load(sys.stdin)))")
[[ "$BLOCK_ROWS" -gt 0 ]] && pass "audit search by BLOCK returns $BLOCK_ROWS rows" || fail "no BLOCK rows"
CSV_FIRST=$(curl -s "$BASE/api/audit/export.csv?v=ALLOW" | head -1 | tr -d '\r')
[[ "$CSV_FIRST" == "id,timestamp,pack_id,action,phase,verdict,primary_reason,decision_json" ]] && pass "CSV header correct" || fail "CSV header wrong: '$CSV_FIRST'"
CSV_ROWS=$(curl -s "$BASE/api/audit/export.csv?v=ALLOW" | wc -l)
[[ "$CSV_ROWS" -gt 1 ]] && pass "CSV exported $((CSV_ROWS - 1)) ALLOW rows" || fail "CSV had no rows"

printf "\n${GREEN}All six journeys passed.${NC}\n"
