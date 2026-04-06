"""POST /api/validate — primary enforcement endpoint."""

from __future__ import annotations

from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

router = APIRouter()


class ValidateRequest(BaseModel):
    pack_id: str
    action: str
    ui_state: Dict[str, Any] = Field(default_factory=dict)
    phase: Literal["pre", "post"] = "pre"


@router.post("/api/validate")
async def validate(request: Request, body: ValidateRequest) -> Dict[str, Any]:
    engine = request.app.state.engine
    audit = request.app.state.audit_log

    decision = engine.validate(
        pack_id=body.pack_id,
        action=body.action,
        ui_state=body.ui_state,
        phase=body.phase,
    )

    payload = decision.to_dict()
    try:
        audit.insert_decision(payload)
    except Exception as exc:  # pragma: no cover - defensive
        # Audit failures must never break enforcement.
        payload["audit_error"] = str(exc)
    return payload
