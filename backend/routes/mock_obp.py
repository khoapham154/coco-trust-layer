"""Mock Open Bank Project endpoints for the banking demo.

These reproduce the shape of the real OBP v5.1.0 account API so the demo
can show a transaction-facing read returning a healthy account while the
sanctions hold sits in account attributes the read never returns. The
agent-banking pipeline demo points the bank state provider at these routes.

This is demo scaffolding, not a real bank. Swap the base URL for a real
OBP sandbox and the provider keeps working.
"""

from __future__ import annotations

import functools
import json
import logging
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, HTTPException

log = logging.getLogger("coco.routes.mock_obp")

router = APIRouter(prefix="/mock-obp/v5.1.0", tags=["mock-obp"])

_FIXTURES_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "banking" / "accounts.json"


@functools.lru_cache(maxsize=1)
def _fixtures() -> Dict[str, Any]:
    return json.loads(_FIXTURES_PATH.read_text(encoding="utf-8"))


def _account_record(account_id: str) -> Dict[str, Any]:
    record = _fixtures().get("accounts", {}).get(account_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"OBP-30001: Account {account_id} not found")
    return record


@router.get("/banks/{bank_id}/accounts/{account_id}/{view_id}/account")
async def get_account(bank_id: str, account_id: str, view_id: str) -> Dict[str, Any]:
    """The OBP account read. Returns balance and routing, never the hold."""
    return _account_record(account_id)["account"]


@router.get("/banks/{bank_id}/accounts/{account_id}/{view_id}/attributes")
async def get_account_attributes(bank_id: str, account_id: str, view_id: str) -> Dict[str, Any]:
    """Account attributes. The compliance state the transaction API omits."""
    return {"account_attributes": _account_record(account_id)["account_attributes"]}
