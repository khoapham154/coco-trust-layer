#!/usr/bin/env bash
# banking_smoke.sh — checks the agent-banking pipeline backend: gateway up
# with the banking pack, mock OBP returns a clean account while the
# beneficiary register sits in attributes, and the three scenarios return
# ALLOW / BLOCK / ESCALATE with audit rows written.
#
# Requires: conda env `coco` (or the venv at ~/khoa/installs/venvs/coco),
# uvicorn on PATH, curl, jq. No Twenty needed.

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

command -v tmux  >/dev/null 2>&1 || fail "tmux not on PATH"
command -v curl  >/dev/null 2>&1 || fail "curl not on PATH"
command -v jq    >/dev/null 2>&1 || fail "jq not on PATH"

VENV_ACTIVATE="${HOME}/khoa/installs/venvs/coco/bin/activate"
if command -v conda >/dev/null 2>&1; then
  ACTIVATE="conda activate coco"
elif [[ -f "${VENV_ACTIVATE}" ]]; then
  ACTIVATE="source ${VENV_ACTIVATE}"
else
  fail "no conda on PATH and no venv at ${VENV_ACTIVATE}"
fi

info "Launching banking gateway in tmux session ${SESSION} on :${PORT}"
tmux new-session -d -s "${SESSION}" -c "${REPO_ROOT}/backend"
tmux send-keys -t "${SESSION}" \
  "${ACTIVATE} && COCO_PORT=${PORT} COCO_GATEWAY_URL=${GATEWAY_URL} COCO_PACK_DIR=${REPO_ROOT}/data/banking/packs COCO_DB_PATH=${DB_PATH} PYTHONPATH=${REPO_ROOT} uvicorn main:app --host 0.0.0.0 --port ${PORT} 2>&1 | tee ${TMP_LOG}" \
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

# the gateway always bundles the banking and securities-lending packs; with
# COCO_PACK_DIR pointed at banking that is 4 banking + 5 seclend
PACKS="$(curl -s "${GATEWAY_URL}/health" | jq -r '.packs_loaded')"
[[ "${PACKS}" == "9" ]] && pass "banking + seclend packs loaded (packs_loaded=9)" || fail "expected 9 packs, got ${PACKS}"

# mock OBP account read is clean, the beneficiary register lives in attributes
ACCOUNT="$(curl -s "${GATEWAY_URL}/mock-obp/v5.1.0/banks/coco-demo-bank/accounts/treasury-002/owner/account")"
echo "${ACCOUNT}" | jq -e '.balance.amount' >/dev/null && pass "OBP account read returns a balance" || fail "account read missing balance"
echo "${ACCOUNT}" | jq -e 'has("beneficiary_accounts") | not' >/dev/null && pass "account read does NOT expose the register" || fail "account read leaked the register"

ATTRS="$(curl -s "${GATEWAY_URL}/mock-obp/v5.1.0/banks/coco-demo-bank/accounts/treasury-002/owner/attributes")"
REGISTER="$(echo "${ATTRS}" | jq -r '.account_attributes[] | select(.name=="beneficiary_accounts") | .value')"
[[ "${REGISTER}" == *"Harbourline Manufacturing Co="* ]] && pass "beneficiary register present in attributes" || fail "expected Harbourline in beneficiary_accounts, got ${REGISTER}"

# the three scenarios
check_verdict() {
  local label="$1" account="$2" payee="$3" amount="$4" expected="$5" destination="${6:-}"
  local body="{\"account_id\":\"${account}\",\"payee\":\"${payee}\",\"amount\":${amount},\"currency\":\"USD\"}"
  if [[ -n "${destination}" ]]; then
    body="{\"account_id\":\"${account}\",\"payee\":\"${payee}\",\"amount\":${amount},\"currency\":\"USD\",\"destination_account\":\"${destination}\"}"
  fi
  local got
  got="$(curl -s -X POST "${GATEWAY_URL}/api/demo/bank_transfer" \
    -H 'Content-Type: application/json' \
    -d "${body}" \
    | jq -r '.verdict')"
  [[ "${got}" == "${expected}" ]] && pass "${label}: ${got}" || fail "${label}: expected ${expected}, got ${got}"
}

check_verdict "payroll 5k"          "operating-au-001" "PayCycle Payroll Pty Ltd"     5000     "ALLOW"
check_verdict "tampered invoice 2M" "treasury-002"     "Harbourline Manufacturing Co" 2000000  "BLOCK"    "AU72 0100 3344 9021 6691 42"
check_verdict "vendor 250k"         "payments-003"     "Meridian Logistics Ltd"       250000   "ESCALATE"

# a mock OBP counterparty read carries the verification attribute the request omits
CP="$(curl -s "${GATEWAY_URL}/mock-obp/v5.1.0/banks/coco-demo-bank/counterparties/sterling-offshore")"
echo "${CP}" | jq -e '.counterparty_attributes[] | select(.name=="account_verified") | .value == "false"' >/dev/null \
  && pass "counterparty read carries the verification flag" || fail "counterparty read missing the verification flag"

# the other three governed actions
check_post() {
  local label="$1" endpoint="$2" json="$3" expected="$4"
  local got
  got="$(curl -s -X POST "${GATEWAY_URL}${endpoint}" -H 'Content-Type: application/json' -d "${json}" | jq -r '.verdict')"
  [[ "${got}" == "${expected}" ]] && pass "${label}: ${got}" || fail "${label}: expected ${expected}, got ${got}"
}

check_post "beneficiary clean"      "/api/demo/add_beneficiary" '{"account_id":"operating-au-001","counterparty_id":"brightwave-au"}'     "ALLOW"
check_post "beneficiary unverified" "/api/demo/add_beneficiary" '{"account_id":"operating-au-001","counterparty_id":"sterling-offshore"}' "BLOCK"
check_post "beneficiary first-time" "/api/demo/add_beneficiary" '{"account_id":"operating-au-001","counterparty_id":"kepler-fze"}'        "ESCALATE"
check_post "card limit 20k"        "/api/demo/card_limit"      '{"card_id":"card-ops-01","requested_limit":20000}'                       "ALLOW"
check_post "card reported lost"    "/api/demo/card_limit"      '{"card_id":"card-travel-09","requested_limit":10000}'                    "BLOCK"
check_post "card limit 250k"       "/api/demo/card_limit"      '{"card_id":"card-exec-02","requested_limit":250000}'                     "ESCALATE"
check_post "export with purpose"   "/api/demo/data_export"     '{"dataset_id":"crm-contacts","purpose_declared":true,"record_count":200,"cross_border":false}'   "ALLOW"
check_post "export no purpose"     "/api/demo/data_export"     '{"dataset_id":"crm-contacts","purpose_declared":false,"record_count":200,"cross_border":false}'  "BLOCK"
check_post "export bulk"           "/api/demo/data_export"     '{"dataset_id":"crm-contacts","purpose_declared":true,"record_count":20000,"cross_border":false}' "ESCALATE"

# audit grew by the twelve posted decisions
ROWS="$(curl -s "${GATEWAY_URL}/api/audit?limit=50" | jq 'length')"
[[ "${ROWS}" -ge 12 ]] && pass "audit log has ${ROWS} rows" || fail "expected at least 12 audit rows, got ${ROWS}"

pass "banking backend smoke complete"
