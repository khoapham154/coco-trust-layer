"""Seed audit history for the three secondary banking packs.

Runs each pack through the real gateway engine over representative states and
writes the verdicts into the audit log, so the Agent Bank workspace shows a
populated Live feed, Audit ledger and Escalations queue for the beneficiary,
card and data-export contracts. Verdicts are genuine engine output, not
hand-written. Re-running replaces only these three packs' rows; the Twenty
packs and the wire-transfer history are left untouched.

Run (against the live demo DB):
    COCO_DB_PATH=$PWD/data/runtime/coco_demo.db python scripts/seed_banking.py
"""

from __future__ import annotations

import logging
import random
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from config import settings  # noqa: E402
from db.audit_log import AuditLog  # noqa: E402
from engine.gateway import GatewayEngine  # noqa: E402
from engine.pack_schema import AgentActionPack  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("seed_banking")

SEED = 1234
PACK_IDS = ("banking.add_beneficiary", "banking.card_controls", "banking.data_export")

# State factories per (pack, verdict). The gating fields drive the verdict; the
# engine is the source of truth and each row is checked against its intent.
STATES = {
    "banking.add_beneficiary": {
        "action": "add_beneficiary",
        "ALLOW": {"account": {"status": "active"}, "counterparty": {"account_verified": True, "first_time_in_monitored_region": False}},
        "BLOCK": {"account": {"status": "active"}, "counterparty": {"account_verified": False, "first_time_in_monitored_region": False}},
        "ESCALATE": {"account": {"status": "active"}, "counterparty": {"account_verified": True, "first_time_in_monitored_region": True}},
    },
    "banking.card_controls": {
        "action": "update_card_limit",
        "ALLOW": {"card": {"status": "active", "reported_lost": False}, "request": {"requested_limit": 20000}},
        "BLOCK": {"card": {"status": "active", "reported_lost": True}, "request": {"requested_limit": 10000}},
        "ESCALATE": {"card": {"status": "active", "reported_lost": False}, "request": {"requested_limit": 250000}},
    },
    "banking.data_export": {
        "action": "export_customer_records",
        "ALLOW": {"policy": {"exports_enabled": True}, "request": {"purpose_declared": True, "record_count": 200, "cross_border": False}},
        "BLOCK": {"policy": {"exports_enabled": True}, "request": {"purpose_declared": False, "record_count": 200, "cross_border": False}},
        "ESCALATE": {"policy": {"exports_enabled": True}, "request": {"purpose_declared": True, "record_count": 20000, "cross_border": False}},
    },
}

# How many rows of each verdict per pack. Mostly clean traffic, a few holds.
MIX = {
    "banking.add_beneficiary": {"ALLOW": 14, "BLOCK": 2, "ESCALATE": 3},
    "banking.card_controls": {"ALLOW": 12, "BLOCK": 1, "ESCALATE": 3},
    "banking.data_export": {"ALLOW": 10, "BLOCK": 2, "ESCALATE": 2},
}


def _clear_existing(db_path: Path) -> int:
    """Remove prior rows for the three packs so the seed is idempotent."""
    conn = sqlite3.connect(str(db_path))
    try:
        ids = [r[0] for r in conn.execute(
            f"SELECT id FROM audit_log WHERE pack_id IN ({','.join('?' * len(PACK_IDS))})", PACK_IDS
        ).fetchall()]
        conn.executemany("DELETE FROM escalation_status WHERE audit_id = ?", [(i,) for i in ids])
        conn.execute(
            f"DELETE FROM audit_log WHERE pack_id IN ({','.join('?' * len(PACK_IDS))})", PACK_IDS
        )
        conn.commit()
        return len(ids)
    finally:
        conn.close()


def main() -> int:
    random.seed(SEED)
    packs = AgentActionPack.load_all_dirs(settings.pack_dirs)
    engine = GatewayEngine(packs)
    missing = [p for p in PACK_IDS if p not in packs]
    if missing:
        log.error("packs not loaded: %s", missing)
        return 1

    audit = AuditLog(settings.db_path)
    removed = _clear_existing(settings.db_path)
    log.info("cleared %d existing rows for the banking action packs", removed)

    # Build the full work list, then assign spread-out timestamps so the rows
    # interleave over the last day and a half with the newest inserted last.
    rows = []
    for pack_id, mix in MIX.items():
        action = STATES[pack_id]["action"]
        for verdict, n in mix.items():
            for _ in range(n):
                rows.append((pack_id, action, verdict))
    random.shuffle(rows)

    now = datetime.now(timezone.utc)
    span_minutes = 36 * 60
    stamps = sorted(now - timedelta(minutes=random.randint(5, span_minutes)) for _ in rows)

    counts = {"ALLOW": 0, "BLOCK": 0, "ESCALATE": 0}
    for (pack_id, action, want), ts in zip(rows, stamps):
        decision = engine.validate(pack_id, action, STATES[pack_id][want], phase="pre")
        got = decision.verdict.value if hasattr(decision.verdict, "value") else str(decision.verdict)
        if got != want:
            log.error("verdict mismatch for %s: got %s, want %s", pack_id, got, want)
            return 1
        payload = decision.to_dict()
        payload["timestamp"] = ts.isoformat()
        audit.insert_decision(payload)
        counts[got] += 1

    log.info("seeded %d banking-action rows: %d ALLOW, %d BLOCK, %d ESCALATE",
             len(rows), counts["ALLOW"], counts["BLOCK"], counts["ESCALATE"])
    log.info("db: %s", settings.db_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
