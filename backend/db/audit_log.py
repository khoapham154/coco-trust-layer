"""SQLite-backed audit log. Stdlib only, no ORM."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List

_SCHEMA = """
CREATE TABLE IF NOT EXISTS audit_log (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp      TEXT NOT NULL,
    pack_id        TEXT NOT NULL,
    action         TEXT NOT NULL,
    phase          TEXT NOT NULL,
    verdict        TEXT NOT NULL,
    primary_reason TEXT,
    decision_json  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp DESC);
"""


class AuditLog:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(
            self.db_path, isolation_level=None, check_same_thread=False
        )
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _init_schema(self) -> None:
        with self._lock, self._connect() as conn:
            conn.executescript(_SCHEMA)

    def insert_decision(self, decision: Dict[str, Any]) -> int:
        with self._lock, self._connect() as conn:
            cur = conn.execute(
                """
                INSERT INTO audit_log
                    (timestamp, pack_id, action, phase, verdict, primary_reason, decision_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    decision.get("timestamp"),
                    decision.get("pack_id"),
                    decision.get("action"),
                    decision.get("phase"),
                    decision.get("verdict"),
                    decision.get("primary_reason"),
                    json.dumps(decision),
                ),
            )
            return int(cur.lastrowid or 0)

    def list_recent(self, limit: int = 50) -> List[Dict[str, Any]]:
        limit = max(1, min(int(limit), 500))
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, timestamp, pack_id, action, phase, verdict, primary_reason, decision_json
                FROM audit_log
                ORDER BY id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        out: List[Dict[str, Any]] = []
        for row in rows:
            out.append(
                {
                    "id": row["id"],
                    "timestamp": row["timestamp"],
                    "pack_id": row["pack_id"],
                    "action": row["action"],
                    "phase": row["phase"],
                    "verdict": row["verdict"],
                    "primary_reason": row["primary_reason"],
                    "decision": json.loads(row["decision_json"]),
                }
            )
        return out

    def count(self) -> int:
        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT COUNT(*) AS n FROM audit_log").fetchone()
        return int(row["n"]) if row else 0
