"""GET /api/packs — pack listing and detail."""

from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, Request

router = APIRouter()


@router.get("/api/packs")
async def list_packs(request: Request) -> List[Dict[str, Any]]:
    engine = request.app.state.engine
    out: List[Dict[str, Any]] = []
    for pack in engine.packs.values():
        out.append(
            {
                "id": pack.id,
                "action": pack.action,
                "description": pack.description,
                "cdm_event": pack.cdm_event,
                "check_count": pack.check_count(),
                "pre_count": len(pack.pre_conditions),
                "constraint_count": len(pack.constraints),
                "post_count": len(pack.post_conditions),
            }
        )
    return out


@router.get("/api/packs/{pack_id}")
async def get_pack(request: Request, pack_id: str) -> Dict[str, Any]:
    engine = request.app.state.engine
    pack = engine.packs.get(pack_id)
    if pack is None:
        raise HTTPException(status_code=404, detail=f"Pack not found: {pack_id}")
    return pack.model_dump(mode="json")
