#!/usr/bin/env bash
# Render entrypoint: start the gateway, then seed the securities-lending audit
# ledger once so the dashboard lands populated on a cold start. Render's free
# plan resets /tmp/audit.db on every restart, so the seed runs each boot, but
# only when the ledger is empty so a redeploy never double-seeds a warm disk.
set -uo pipefail

PORT="${PORT:-8080}"
BASE="http://localhost:${PORT}"

uvicorn main:app --host 0.0.0.0 --port "${PORT}" &
GATEWAY_PID=$!
trap 'kill -TERM "${GATEWAY_PID}" 2>/dev/null || true' TERM INT

# Wait for the gateway to answer health before seeding.
for _ in $(seq 1 30); do
  curl -fsS "${BASE}/health" >/dev/null 2>&1 && break
  sleep 1
done

seed() { curl -s -X POST "${BASE}$1" -H 'Content-Type: application/json' -d "$2" >/dev/null 2>&1 || true; }

ROWS="$(curl -s "${BASE}/api/audit?limit=5" 2>/dev/null | python -c 'import sys,json; print(len(json.load(sys.stdin)))' 2>/dev/null || echo 0)"
if [ "${ROWS:-0}" -lt 1 ]; then
  seed /api/demo/seclend/book_loan       '{"security_id":"AAPL","counterparty_id":"citadel-sec","quantity":10000}'
  seed /api/demo/seclend/book_loan       '{"security_id":"GME","counterparty_id":"meridian-bd","quantity":20000}'
  seed /api/demo/seclend/book_loan       '{"security_id":"AAPL","counterparty_id":"jane-street","quantity":10000}'
  seed /api/demo/seclend/book_loan       '{"security_id":"TSLA","counterparty_id":"citadel-sec","quantity":5000}'
  seed /api/demo/seclend/book_loan       '{"security_id":"AAPL","counterparty_id":"citadel-sec","quantity":50000}'
  seed /api/demo/seclend/post_collateral '{"loan_id":"loan-001","posted_value":2000000,"collateral_type":"cash","concentration_pct":0}'
  seed /api/demo/seclend/post_collateral '{"loan_id":"loan-001","posted_value":1900000,"collateral_type":"cash","concentration_pct":0}'
  seed /api/demo/seclend/post_collateral '{"loan_id":"loan-001","posted_value":2000000,"collateral_type":"equity","concentration_pct":30}'
  seed /api/demo/seclend/check_rate      '{"security_id":"AAPL","proposed_fee_bps":35}'
  seed /api/demo/seclend/check_rate      '{"security_id":"GME","proposed_fee_bps":200}'
  seed /api/demo/seclend/check_rate      '{"security_id":"AAPL","proposed_fee_bps":70}'
  seed /api/demo/seclend/roll_loan       '{"loan_id":"loan-001","action":"roll"}'
  seed /api/demo/seclend/roll_loan       '{"loan_id":"loan-002","action":"roll"}'
  seed /api/demo/seclend/roll_loan       '{"loan_id":"loan-003","action":"roll"}'
  seed /api/demo/seclend/submit_report   '{"report_id":"rpt-clean"}'
  seed /api/demo/seclend/submit_report   '{"report_id":"rpt-missing-uti"}'
  seed /api/demo/seclend/submit_report   '{"report_id":"rpt-late"}'
fi

wait "${GATEWAY_PID}"
