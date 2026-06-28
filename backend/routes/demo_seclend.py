"""Agent securities-lending pipeline demo — POST /api/demo/seclend/*.

Drives the runtime-enforcement stage of an agent operating a securities-lending
desk. The frontend sends what the agent wants to do, a booking, a collateral
post, a rate, a roll, or a regulatory submission. Each handler reads the live
blotter through the securities-lending provider, runs the matching
``securities_lending.*`` pack on the real gateway engine, records the verdict
in the audit log, and returns both the request the agent submitted and the live
state Coco enforced on.

The blotter reads are local fixtures, so unlike the banking demo there is no
network round-trip and no worker thread is needed.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from providers import SecLendStateProvider

log = logging.getLogger("coco.routes.demo_seclend")

router = APIRouter(prefix="/api/demo/seclend", tags=["demo"])


# --- request bodies, one per governed action -----------------------------


class BookLoanBody(BaseModel):
    security_id: str
    counterparty_id: str
    quantity: int


class PostCollateralBody(BaseModel):
    loan_id: str
    posted_value: float
    collateral_type: str = "cash"
    concentration_pct: float = 0.0


class CheckRateBody(BaseModel):
    security_id: str
    proposed_fee_bps: float


class RollLoanBody(BaseModel):
    loan_id: str
    action: str = "roll"


class SubmitReportBody(BaseModel):
    report_id: str


def _run_pack(
    request: Request,
    pack_id: str,
    action: str,
    ui_state: Dict[str, Any],
    extra: Dict[str, Any],
) -> Dict[str, Any]:
    """Validate a state against a pack, record the verdict, shape the response.

    Shared by every securities-lending action. ``extra`` carries the per-action
    view (the request the agent submitted, the blotter record it never read).
    """
    engine = request.app.state.engine
    if pack_id not in engine.packs:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Pack {pack_id} not loaded. Start the gateway with the "
                "securities-lending packs on the path."
            ),
        )

    decision = engine.validate(pack_id, action, ui_state, phase="pre")
    payload = decision.to_dict()

    audit = getattr(request.app.state, "audit_log", None)
    audit_id: Optional[int] = None
    if audit is not None:
        try:
            audit_id = audit.insert_decision(payload)
        except Exception as exc:  # audit must never break the verdict
            log.warning("audit insert failed: %s", exc)

    failing = next((c for c in payload["checks"] if not c["passed"]), None)
    out = {
        "verdict": payload["verdict"],
        "primary_reason": payload["primary_reason"],
        "checks": payload["checks"],
        "failing_check": failing,
        "ui_state": ui_state,
        "pack_id": pack_id,
        "action": action,
        "cdm_event": getattr(engine.packs[pack_id], "cdm_event", None),
        "audit_id": audit_id,
        "timestamp": payload["timestamp"],
    }
    out.update(extra)
    return out


@router.post("/book_loan")
async def book_loan(body: BookLoanBody, request: Request) -> Dict[str, Any]:
    provider = SecLendStateProvider()
    try:
        ui_state, booking_view = provider.loan_execution_state(
            body.security_id, body.counterparty_id, body.quantity
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    out = _run_pack(
        request,
        "securities_lending.loan_execution",
        "book_loan",
        ui_state,
        {"booking_view": booking_view},
    )
    out["platform_view"] = {
        "endpoint": "POST /trades (booking API)",
        "status": "ACCEPTED",
        "note": "The booking API accepts the request. It has no live-inventory, exposure or recall gate.",
    }
    return out


@router.post("/post_collateral")
async def post_collateral(body: PostCollateralBody, request: Request) -> Dict[str, Any]:
    provider = SecLendStateProvider()
    try:
        ui_state, loan_view = provider.collateral_state(
            body.loan_id, body.posted_value, body.collateral_type, body.concentration_pct
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return _run_pack(
        request,
        "securities_lending.collateral",
        "post_collateral",
        ui_state,
        {"loan_view": loan_view},
    )


@router.post("/check_rate")
async def check_rate(body: CheckRateBody, request: Request) -> Dict[str, Any]:
    provider = SecLendStateProvider()
    try:
        ui_state, rate_view = provider.rate_state(body.security_id, body.proposed_fee_bps)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return _run_pack(
        request,
        "securities_lending.rate",
        "agree_rate",
        ui_state,
        {"rate_view": rate_view},
    )


@router.post("/roll_loan")
async def roll_loan(body: RollLoanBody, request: Request) -> Dict[str, Any]:
    provider = SecLendStateProvider()
    try:
        ui_state, loan_view = provider.recall_state(body.loan_id, body.action)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return _run_pack(
        request,
        "securities_lending.recall",
        "roll_loan",
        ui_state,
        {"loan_view": loan_view},
    )


@router.post("/submit_report")
async def submit_report(body: SubmitReportBody, request: Request) -> Dict[str, Any]:
    provider = SecLendStateProvider()
    try:
        ui_state, report_view = provider.reporting_state(body.report_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return _run_pack(
        request,
        "securities_lending.reporting",
        "submit_report",
        ui_state,
        {"report_view": report_view},
    )
