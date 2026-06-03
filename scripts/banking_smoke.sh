#!/usr/bin/env bash
# banking_smoke.sh — checks the agent-banking pipeline backend: gateway up
# with the banking pack, mock OBP returns a clean account while the hold
# sits in attributes, and the three scenarios return ALLOW / BLOCK / ESCALATE
# with audit rows written.
#
# Requires: conda env `coco`, uvicorn on PATH, curl, jq. No Twenty needed.

set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
RESET='\033[0m'

pass()  { printf "${GREEN}[pass]${RESET} %s\n" "$*"; }
fail()  { printf "${RED}[fail]${RESET} %s\n" "$*" 1>&2; exit 1; }
info()  { printf "${YELLOW}[info]${RESET} %s\n" "$*"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION="coco_bank_smoke_$$"
PORT=8091
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

info "Launching banking gateway in tmux session ${SESSION} on :${PORT}"
tmux new-session -d -s "${SESSION}" -c "${REPO_ROOT}/backend"
tmux send-keys -t "${SESSION}" \
  "conda activate coco && COCO_PORT=${PORT} COCO_GATEWAY_URL=${GATEWAY_URL} COCO_PACK_DIR=${REPO_ROOT}/data/banking/packs COCO_DB_PATH=${DB_PATH} PYTHONPATH=${REPO_ROOT} uvicorn main:app --host 0.0.0.0 --port ${PORT} 2>&1 | tee ${TMP_LOG}" \
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

# only the banking pack is loaded
PACKS="$(curl -s "${GATEWAY_URL}/health" | jq -r '.packs_loaded')"
[[ "${PACKS}" == "1" ]] && pass "banking pack loaded (packs_loaded=1)" || fail "expected 1 pack, got ${PACKS}"

# mock OBP account read is clean, the hold lives in attributes
ACCOUNT="$(curl -s "${GATEWAY_URL}/mock-obp/v5.1.0/banks/coco-demo-bank/accounts/treasury-002/owner/account")"
echo "${ACCOUNT}" | jq -e '.balance.amount' >/dev/null && pass "OBP account read returns a balance" || fail "account read missing balance"
echo "${ACCOUNT}" | jq -e 'has("sanctions_hold") | not' >/dev/null && pass "account read does NOT expose the hold" || fail "account read leaked the hold"

ATTRS="$(curl -s "${GATEWAY_URL}/mock-obp/v5.1.0/banks/coco-demo-bank/accounts/treasury-002/owner/attributes")"
HOLD="$(echo "${ATTRS}" | jq -r '.account_attributes[] | select(.name=="sanctions_hold") | .value')"
[[ "${HOLD}" == "true" ]] && pass "sanctions hold present in attributes" || fail "expected hold=true in attributes, got ${HOLD}"

# the three scenarios
check_verdict() {
  local label="$1" account="$2" payee="$3" amount="$4" expected="$5"
  local got
  got="$(curl -s -X POST "${GATEWAY_URL}/api/demo/bank_transfer" \
    -H 'Content-Type: application/json' \
    -d "{\"account_id\":\"${account}\",\"payee\":\"${payee}\",\"amount\":${amount},\"currency\":\"USD\"}" \
    | jq -r '.verdict')"
  [[ "${got}" == "${expected}" ]] && pass "${label}: ${got}" || fail "${label}: expected ${expected}, got ${got}"
}

check_verdict "payroll 5k"        "operating-au-001" "PayCycle Payroll Pty Ltd" 5000     "ALLOW"
check_verdict "sanctioned 2M"     "treasury-002"     "Hint Global Trading FZE"  2000000  "BLOCK"
check_verdict "vendor 250k"       "payments-003"     "Meridian Logistics Ltd"   250000   "ESCALATE"

# audit grew by three rows
ROWS="$(curl -s "${GATEWAY_URL}/api/audit?limit=50" | jq 'length')"
[[ "${ROWS}" -ge 3 ]] && pass "audit log has ${ROWS} rows" || fail "expected at least 3 audit rows, got ${ROWS}"

pass "banking backend smoke complete"
