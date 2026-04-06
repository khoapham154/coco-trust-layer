"""GET /api/audit — recent decisions from the audit log."""

from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Query, Request

router = APIRouter()


@router.get("/api/audit")
async def list_audit(
    request: Request,
    limit: int = Query(50, ge=1, le=500),
) -> List[Dict[str, Any]]:
    audit = request.app.state.audit_log
    return audit.list_recent(limit=limit)
