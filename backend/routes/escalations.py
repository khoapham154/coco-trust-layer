"""Escalations queue — list, approve, deny.

A verdict with `ESCALATE` lands in the audit log already. The escalation
queue surfaces those rows that haven't been resolved yet (approved or
denied). Decisions persist via a `status` column added to audit_log on
startup if it doesn't exist.
"""

from __future__ import annotations

import datetime as dt
import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter()


class EscalationBody(BaseModel):
    comment: Optional[str] = ""


@router.get("/api/escalations")
async def list_escalations(request: Request) -> List[Dict[str, Any]]:
    audit = request.app.state.audit_log
    rows = audit.list_pending_escalations()
    return [_shape_escalation(r) for r in rows]


@router.post("/api/escalations/{eid}/approve")
async def approve_escalation(request: Request, eid: int, body: EscalationBody) -> Dict[str, Any]:
    audit = request.app.state.audit_log
    row = audit.set_status(eid, "approved", body.comment or "")
    if row is None:
        raise HTTPException(status_code=404, detail=f"Escalation {eid} not found.")
    # Write a follow-up audit entry for the operator action so the
    # ledger contains the full story (escalation → approval).
    follow = _follow_up(row, verdict="ALLOW", reason=f"Operator approval (#{eid}). {body.comment or ''}".strip())
    new_id = audit.insert_decision(follow)
    return {"id": eid, "status": "approved", "follow_up_id": new_id}


@router.post("/api/escalations/{eid}/deny")
async def deny_escalation(request: Request, eid: int, body: EscalationBody) -> Dict[str, Any]:
    audit = request.app.state.audit_log
    row = audit.set_status(eid, "denied", body.comment or "")
    if row is None:
        raise HTTPException(status_code=404, detail=f"Escalation {eid} not found.")
    follow = _follow_up(row, verdict="BLOCK", reason=f"Operator denial (#{eid}). {body.comment or ''}".strip())
    new_id = audit.insert_decision(follow)
    return {"id": eid, "status": "denied", "follow_up_id": new_id}


def _shape_escalation(row: Dict[str, Any]) -> Dict[str, Any]:
    decision = row.get("decision") or {}
    ui_state = decision.get("ui_state") or {}
    return {
        "id": row["id"],
        "timestamp": row["timestamp"],
        "pack_id": row["pack_id"],
        "action": row["action"],
        "phase": row["phase"],
        "verdict": row["verdict"],
        "primary_reason": row["primary_reason"],
        "current_state": ui_state,
        "proposed": {"action": row["action"], "pack": row["pack_id"]},
        "decision": decision,
    }


def _follow_up(row: Dict[str, Any], verdict: str, reason: str) -> Dict[str, Any]:
    base = row.get("decision") or {}
    return {
        **base,
        "verdict": verdict,
        "primary_reason": reason,
        "phase": base.get("phase", "post"),
        "timestamp": dt.datetime.now(dt.timezone.utc).isoformat(),
        "follow_up_to": row["id"],
    }
