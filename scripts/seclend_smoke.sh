#!/usr/bin/env bash
# seclend_smoke.sh — checks the agent securities-lending pipeline backend.
# Boots the full gateway (Twenty + banking + securities-lending packs all
# loaded), confirms the five securities-lending packs are present, and runs
# every governed action so each returns ALLOW / BLOCK / ESCALATE with audit
# rows written.
#
# Requires: conda env `coco`, uvicorn on PATH, curl, jq. No external service.

set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
RESET='\033[0m'

pass()  { printf "${GREEN}[pass]${RESET} %s\n" "$*"; }
fail()  { printf "${RED}[fail]${RESET} %s\n" "$*" 1>&2; exit 1; }
info()  { printf "${YELLOW}[info]${RESET} %s\n" "$*"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION="coco_seclend_smoke_$$"
PORT=8092
GATEWAY_URL="http://localhost:${PORT}"
DB_PATH="/tmp/${SESSION}_audit.db"
TMP_LOG="/tmp/${SESSION}.log"

cleanup() {
  info "Cleaning up tmux session ${SESSION}"
  tmux kill-session -t "${SESSION}" 2>/dev/null || true
  rm -f "${DB_PATH}"
}
trap cleanup EXIT

command -v conda >/dev/null 2>&1 || fail "conda not on PATH"
command -v tmux  >/dev/null 2>&1 || fail "tmux not on PATH"
command -v curl  >/dev/null 2>&1 || fail "curl not on PATH"
command -v jq    >/dev/null 2>&1 || fail "jq not on PATH"

info "Launching full gateway in tmux session ${SESSION} on :${PORT}"
tmux new-session -d -s "${SESSION}" -c "${REPO_ROOT}/backend"
tmux send-keys -t "${SESSION}" \
  "conda activate coco && COCO_PORT=${PORT} COCO_GATEWAY_URL=${GATEWAY_URL} COCO_DB_PATH=${DB_PATH} PYTHONPATH=${REPO_ROOT} uvicorn main:app --host 0.0.0.0 --port ${PORT} 2>&1 | tee ${TMP_LOG}" \
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

# all three verticals coexist on one gateway
PACKS="$(curl -s "${GATEWAY_URL}/health" | jq -r '.packs_loaded')"
[[ "${PACKS}" == "14" ]] && pass "all verticals loaded (packs_loaded=14)" || fail "expected 14 packs, got ${PACKS}"

SL_COUNT="$(curl -s "${GATEWAY_URL}/api/packs" | jq '[.[] | select(.id | startswith("securities_lending."))] | length')"
[[ "${SL_COUNT}" == "5" ]] && pass "five securities-lending packs present" || fail "expected 5 SL packs, got ${SL_COUNT}"

# every pack carries its CDM event anchor
NO_CDM="$(curl -s "${GATEWAY_URL}/api/packs" | jq '[.[] | select(.id | startswith("securities_lending.")) | select(.cdm_event == null)] | length')"
[[ "${NO_CDM}" == "0" ]] && pass "every SL pack is anchored to a CDM event" || fail "${NO_CDM} SL packs missing cdm_event"

check() {
  local label="$1" endpoint="$2" json="$3" expected="$4"
  local got
  got="$(curl -s -X POST "${GATEWAY_URL}${endpoint}" -H 'Content-Type: application/json' -d "${json}" | jq -r '.verdict')"
  [[ "${got}" == "${expected}" ]] && pass "${label}: ${got}" || fail "${label}: expected ${expected}, got ${got}"
}

info "Loan execution (book_loan)"
check "book routine"        "/api/demo/seclend/book_loan"      '{"security_id":"AAPL","counterparty_id":"citadel-sec","quantity":10000}' "ALLOW"
check "book inventory short" "/api/demo/seclend/book_loan"     '{"security_id":"GME","counterparty_id":"meridian-bd","quantity":20000}'  "BLOCK"
check "book over cap"        "/api/demo/seclend/book_loan"     '{"security_id":"AAPL","counterparty_id":"jane-street","quantity":10000}' "BLOCK"
check "book under recall"    "/api/demo/seclend/book_loan"     '{"security_id":"TSLA","counterparty_id":"citadel-sec","quantity":5000}'  "BLOCK"
check "book large notional"  "/api/demo/seclend/book_loan"     '{"security_id":"AAPL","counterparty_id":"citadel-sec","quantity":50000}' "ESCALATE"

info "Collateral (post_collateral)"
check "collateral ok"        "/api/demo/seclend/post_collateral" '{"loan_id":"loan-001","posted_value":2000000,"collateral_type":"cash","concentration_pct":0}'    "ALLOW"
check "collateral short"     "/api/demo/seclend/post_collateral" '{"loan_id":"loan-001","posted_value":1900000,"collateral_type":"cash","concentration_pct":0}'    "BLOCK"
check "collateral concentr"  "/api/demo/seclend/post_collateral" '{"loan_id":"loan-001","posted_value":2000000,"collateral_type":"equity","concentration_pct":30}' "ESCALATE"

info "Rate (check_rate)"
check "rate in band"         "/api/demo/seclend/check_rate"     '{"security_id":"AAPL","proposed_fee_bps":35}'  "ALLOW"
check "rate below floor"     "/api/demo/seclend/check_rate"     '{"security_id":"GME","proposed_fee_bps":200}'  "BLOCK"
check "rate off benchmark"   "/api/demo/seclend/check_rate"     '{"security_id":"AAPL","proposed_fee_bps":70}'  "ESCALATE"

info "Recall (roll_loan)"
check "roll clean"           "/api/demo/seclend/roll_loan"      '{"loan_id":"loan-001","action":"roll"}' "ALLOW"
check "roll under recall"    "/api/demo/seclend/roll_loan"      '{"loan_id":"loan-002","action":"roll"}' "BLOCK"
check "roll near deadline"   "/api/demo/seclend/roll_loan"      '{"loan_id":"loan-003","action":"roll"}' "ESCALATE"

info "Reporting (submit_report)"
check "report clean"         "/api/demo/seclend/submit_report"  '{"report_id":"rpt-clean"}'        "ALLOW"
check "report missing uti"   "/api/demo/seclend/submit_report"  '{"report_id":"rpt-missing-uti"}'  "BLOCK"
check "report late"          "/api/demo/seclend/submit_report"  '{"report_id":"rpt-late"}'         "ESCALATE"

# audit grew by the seventeen posted decisions
ROWS="$(curl -s "${GATEWAY_URL}/api/audit?limit=50" | jq 'length')"
[[ "${ROWS}" -ge 17 ]] && pass "audit log has ${ROWS} rows" || fail "expected at least 17 audit rows, got ${ROWS}"

pass "securities-lending backend smoke complete"
