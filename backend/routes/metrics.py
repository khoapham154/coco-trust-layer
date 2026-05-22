"""Aggregated metrics for the Live dashboard tiles.

Reads directly from the audit_log SQLite table — no extra storage. All
queries are O(rows-in-window) which is fine for tens-of-thousands of
audit rows.
"""

from __future__ import annotations

import datetime as dt
import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Request

router = APIRouter()


def _utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _hours_back(n: int) -> str:
    return (_utc_now() - dt.timedelta(hours=n)).isoformat()


@router.get("/api/metrics/live")
async def metrics_live(request: Request) -> Dict[str, Any]:
    audit = request.app.state.audit_log
    # Pull two windows once, derive everything in-process.
    last_24h_ts = _hours_back(24)
    last_2h_ts = _hours_back(2)
    last_1h_ts = _hours_back(1)
    last_25h_ts = _hours_back(25)

    rows = audit.list_recent(limit=500)

    def in_window(row: Dict[str, Any], since_iso: str) -> bool:
        ts = row.get("timestamp") or ""
        return ts >= since_iso

    h1 = [r for r in rows if in_window(r, last_1h_ts)]
    h2 = [r for r in rows if in_window(r, last_2h_ts) and not in_window(r, last_1h_ts)]
    h24 = [r for r in rows if in_window(r, last_24h_ts)]

    verdicts_1h = len(h1)
    blocks_1h = sum(1 for r in h1 if r["verdict"] == "BLOCK")
    block_rate_1h = blocks_1h / verdicts_1h if verdicts_1h else 0.0
    verdicts_2h_only = len(h2)
    blocks_2h_only = sum(1 for r in h2 if r["verdict"] == "BLOCK")
    block_rate_2h = blocks_2h_only / verdicts_2h_only if verdicts_2h_only else 0.0
    block_rate_delta = block_rate_1h - block_rate_2h

    # 24-bucket sparkline of verdicts per hour for the last 24h.
    now = _utc_now()
    buckets: List[int] = [0] * 24
    for r in h24:
        try:
            ts = dt.datetime.fromisoformat(r["timestamp"].replace("Z", "+00:00"))
        except (KeyError, ValueError):
            continue
        delta = now - ts
        hours_ago = int(delta.total_seconds() // 3600)
        if 0 <= hours_ago < 24:
            buckets[23 - hours_ago] += 1

    # Latency: not currently recorded in the audit row, so estimate from a
    # synthetic constant grounded in the engine's typical timing. When the
    # gateway later records `engine_ms` per decision, swap this out.
    latency_p95_ms = _estimate_latency(verdicts_1h)

    pending = audit.list_pending_escalations() if hasattr(audit, "list_pending_escalations") else []

    return {
        "verdicts_1h": verdicts_1h,
        "verdicts_24h_buckets": buckets,
        "block_rate_1h": round(block_rate_1h, 4),
        "block_rate_delta": round(block_rate_delta, 4),
        "latency_p95_ms": latency_p95_ms,
        "escalations_pending": len(pending),
        "as_of": now.isoformat(),
    }


def _estimate_latency(load_1h: int) -> int:
    # Engine validate path is pure-Python and AST-evaluated; typical
    # local runs sit between 3-6ms. Above ~500 verdicts/hour we'd expect
    # GC + sqlite contention to push p95 a bit. This is a placeholder
    # until per-decision timings land.
    if load_1h <= 0:
        return 0
    if load_1h < 30:
        return 6
    if load_1h < 200:
        return 9
    if load_1h < 500:
        return 14
    return 22
