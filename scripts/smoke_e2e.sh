#!/usr/bin/env bash
# smoke_e2e.sh — end-to-end check: gateway up, dashboard reachable,
# 3 representative scenarios run, audit grows, clean shutdown.
#
# Requires: conda env `coco`, uvicorn on PATH, curl, jq.
# Twenty is NOT required — we run driver=engine. A separate script
# (out of scope here) drives the live Twenty path.

set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
RESET='\033[0m'

pass()  { printf "${GREEN}[pass]${RESET} %s\n" "$*"; }
fail()  { printf "${RED}[fail]${RESET} %s\n" "$*" 1>&2; exit 1; }
info()  { printf "${YELLOW}[info]${RESET} %s\n" "$*"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION="coco_smoke_$$"
GATEWAY_URL="http://localhost:8080"
TMP_LOG="/tmp/${SESSION}.log"

cleanup() {
  info "Cleaning up tmux session ${SESSION}"
  tmux kill-session -t "${SESSION}" 2>/dev/null || true
}
trap cleanup EXIT

command -v conda >/dev/null 2>&1 || fail "conda not on PATH"
command -v tmux  >/dev/null 2>&1 || fail "tmux not on PATH"
command -v curl  >/dev/null 2>&1 || fail "curl not on PATH"
command -v jq    >/dev/null 2>&1 || fail "jq not on PATH"

info "Launching gateway in tmux session ${SESSION}"
tmux new-session -d -s "${SESSION}" -c "${REPO_ROOT}/backend"
tmux send-keys -t "${SESSION}" \
  "conda activate coco && PYTHONPATH=${REPO_ROOT} uvicorn main:app --host 0.0.0.0 --port 8080 2>&1 | tee ${TMP_LOG}" \
  Enter

info "Waiting up to 20s for /health"
for i in $(seq 1 20); do
  if curl -fsS --max-time 1 "${GATEWAY_URL}/health" >/dev/null 2>&1; then
    pass "gateway healthy after ${i}s"
    break
  fi
  sleep 1
done
curl -fsS --max-time 2 "${GATEWAY_URL}/health" >/dev/null || fail "gateway never came up — check ${TMP_LOG}"

# 1 - dashboard HTML
[[ "$(curl -s -o /dev/null -w '%{http_code}' ${GATEWAY_URL}/dashboard)" == "200" ]] \
  && pass "/dashboard returns 200" \
  || fail "/dashboard did not return 200"

# 2 - static assets
for path in /static/styles.css /static/app.js /sdk/coco-sdk.js /sdk/inject.js; do
  [[ "$(curl -s -o /dev/null -w '%{http_code}' ${GATEWAY_URL}${path})" == "200" ]] \
    && pass "${path} 200" \
    || fail "${path} missing"
done

# 3 - scenarios list
SCENARIO_COUNT=$(curl -s "${GATEWAY_URL}/api/scenarios" | jq 'length')
[[ "${SCENARIO_COUNT}" == "19" ]] && pass "19 scenarios listed" || fail "expected 19 scenarios, got ${SCENARIO_COUNT}"

# 4 - audit baseline
BEFORE=$(curl -s "${GATEWAY_URL}/api/audit?limit=500" | jq 'length')
info "audit rows before: ${BEFORE}"

# 5 - run 3 representative scenarios
for sid in deal_stage_move_allow deal_stage_move_block_no_owner bulk_email_allow; do
  VERDICT=$(curl -s -X POST "${GATEWAY_URL}/api/scenarios/${sid}/run" | jq -r '.decision.verdict')
  info "ran ${sid} → ${VERDICT}"
done

# 6 - audit grew by >= 3
AFTER=$(curl -s "${GATEWAY_URL}/api/audit?limit=500" | jq 'length')
DELTA=$((AFTER - BEFORE))
if (( DELTA >= 3 )); then
  pass "audit grew by ${DELTA} rows (>= 3 expected)"
else
  fail "audit only grew by ${DELTA} rows"
fi

# 7 - scenarios map to expected verdicts
ALLOW=$(curl -s -X POST "${GATEWAY_URL}/api/scenarios/deal_stage_move_allow/run" | jq -r '.decision.verdict')
BLOCK=$(curl -s -X POST "${GATEWAY_URL}/api/scenarios/deal_stage_move_block_no_owner/run" | jq -r '.decision.verdict')
[[ "${ALLOW}" == "ALLOW" ]] && pass "deal_stage_move_allow → ALLOW" || fail "wrong verdict for deal_stage_move_allow: ${ALLOW}"
[[ "${BLOCK}" == "BLOCK" ]] && pass "deal_stage_move_block_no_owner → BLOCK" || fail "wrong verdict: ${BLOCK}"

# 8 - driver=twenty returns a well-formed trace (Twenty unreachable, agent falls back to scenario fixture)
TWENTY_VERDICT=$(curl -s -X POST "${GATEWAY_URL}/api/scenarios/deal_stage_move_allow/run?driver=twenty" | jq -r '.decision.verdict')
[[ "${TWENTY_VERDICT}" == "ALLOW" ]] && pass "driver=twenty path reachable" || fail "driver=twenty returned ${TWENTY_VERDICT}"

printf "\n${GREEN}smoke_e2e: all checks passed${RESET}\n"
