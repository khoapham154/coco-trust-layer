"""Agent-banking pipeline demo — POST /api/demo/bank_transfer.

Drives the runtime-enforcement stage of the agent-banking trust pipeline.
The frontend sends a transfer an AI agent wants to make; this reads the
OBP account state through the bank provider, runs the `banking.wire_transfer`
pack on the real gateway engine, records the verdict in the audit log, and
returns both the OBP "valid" view and the live state Coco enforced on.

Unlike the Twenty demo routes, this one is read-only against the bank and
never mutates, so it needs no demo-reset gate.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from providers import BankStateProvider

log = logging.getLogger("coco.routes.demo_bank")

router = APIRouter(prefix="/api/demo", tags=["demo"])

PACK_ID = "banking.wire_transfer"
ACTION = "initiate_transfer"


class BankTransferBody(BaseModel):
    account_id: str
    payee: str
    amount: float
    currency: str = "USD"


def _resolve(body: BankTransferBody) -> Dict[str, Any]:
    """Read OBP state and shape it for the pack. Runs off the event loop.

    The provider calls the gateway's own mock-OBP routes over httpx, so it
    has to run in a worker thread, otherwise it blocks the single event loop
    against itself.
    """
    provider = BankStateProvider()
    try:
        ui_state, account_view = provider.transfer_state(
            body.account_id, body.payee, body.amount, currency=body.currency
        )
    finally:
        provider.close()
    return {"ui_state": ui_state, "account_view": account_view}


@router.post("/bank_transfer")
async def bank_transfer(body: BankTransferBody, request: Request) -> Dict[str, Any]:
    engine = request.app.state.engine
    if PACK_ID not in engine.packs:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Pack {PACK_ID} not loaded. Start the gateway with "
                "COCO_PACK_DIR pointed at data/banking/packs."
            ),
        )

    try:
        resolved = await asyncio.to_thread(_resolve, body)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    decision = engine.validate(PACK_ID, ACTION, resolved["ui_state"], phase="pre")
    payload = decision.to_dict()

    audit = getattr(request.app.state, "audit_log", None)
    audit_id: Optional[int] = None
    if audit is not None:
        try:
            audit_id = audit.insert_decision(payload)
        except Exception as exc:  # audit must never break the verdict
            log.warning("audit insert failed: %s", exc)

    failing = next((c for c in payload["checks"] if not c["passed"]), None)
    return {
        "verdict": payload["verdict"],
        "primary_reason": payload["primary_reason"],
        "checks": payload["checks"],
        "failing_check": failing,
        "account_view": resolved["account_view"],
        "ui_state": resolved["ui_state"],
        "obp_view": {
            "endpoint": (
                f"POST /obp/v5.1.0/banks/coco-demo-bank/accounts/{body.account_id}"
                "/owner/transaction-request-types/SANDBOX_TAN/transaction-requests"
            ),
            "status": "INITIATED",
            "note": "OBP accepts the request. It has no sanctions or beneficiary gate.",
        },
        "audit_id": audit_id,
        "timestamp": payload["timestamp"],
    }
