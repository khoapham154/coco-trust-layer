"""Filterable audit search + CSV export for the Audit Ledger view."""

from __future__ import annotations

import csv
import io
import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

router = APIRouter()


def _matches(row: Dict[str, Any], q: str, pack: str, verdicts: List[str], from_ts: str, to_ts: str) -> bool:
    if verdicts and row.get("verdict") not in verdicts:
        return False
    if pack and row.get("pack_id") != pack:
        return False
    if q:
        haystack = " ".join([
            row.get("primary_reason") or "",
            row.get("pack_id") or "",
            row.get("action") or "",
        ]).lower()
        if q.lower() not in haystack:
            return False
    ts = row.get("timestamp") or ""
    if from_ts and ts < from_ts:
        return False
    if to_ts and ts > to_ts:
        return False
    return True


def _filter_rows(rows: List[Dict[str, Any]], params: Dict[str, str]) -> List[Dict[str, Any]]:
    q = params.get("q", "") or ""
    pack = params.get("pack", "") or ""
    v = params.get("v", "") or ""
    verdicts = [x for x in v.split(",") if x]
    from_param = params.get("from", "") or ""
    to_param = params.get("to", "") or ""
    from_ts = (from_param + "T00:00:00+00:00") if from_param and "T" not in from_param else from_param
    to_ts = (to_param + "T23:59:59+00:00") if to_param and "T" not in to_param else to_param
    return [r for r in rows if _matches(r, q, pack, verdicts, from_ts, to_ts)]


@router.get("/api/audit/search")
async def audit_search(
    request: Request,
    q: str = Query("", description="Text search across reason, pack, action"),
    pack: str = Query("", description="Pack ID exact match"),
    v: str = Query("", description="Comma-separated verdicts (ALLOW,BLOCK,ESCALATE)"),
) -> List[Dict[str, Any]]:
    # `from`/`to` are Python keywords — pull straight off raw query params.
    from_ = request.query_params.get("from", "")
    to_ = request.query_params.get("to", "")
    audit = request.app.state.audit_log
    rows = audit.list_recent(limit=500)
    return _filter_rows(rows, {"q": q, "pack": pack, "v": v, "from": from_, "to": to_})


@router.get("/api/audit/export.csv")
async def audit_export_csv(request: Request) -> StreamingResponse:
    audit = request.app.state.audit_log
    rows = audit.list_recent(limit=500)
    params = dict(request.query_params)
    filtered = _filter_rows(rows, params)

    def gen():
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow([
            "id", "timestamp", "pack_id", "action", "phase", "verdict",
            "primary_reason", "decision_json",
        ])
        yield buf.getvalue()
        buf.seek(0); buf.truncate(0)
        for r in filtered:
            writer.writerow([
                r.get("id", ""),
                r.get("timestamp", ""),
                r.get("pack_id", ""),
                r.get("action", ""),
                r.get("phase", ""),
                r.get("verdict", ""),
                r.get("primary_reason", ""),
                json.dumps(r.get("decision") or {}),
            ])
            yield buf.getvalue()
            buf.seek(0); buf.truncate(0)

    return StreamingResponse(
        gen(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="coco-audit.csv"'},
    )
