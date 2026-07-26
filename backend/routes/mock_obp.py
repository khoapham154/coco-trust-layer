"""Mock Open Bank Project endpoints for the banking demo.

These reproduce the shape of the real OBP v5.1.0 account API so the demo
can show a transaction-facing read returning a healthy account while the
beneficiary register sits in account attributes the read never returns. The
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
_RESOURCES_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "banking" / "resources.json"


@functools.lru_cache(maxsize=1)
def _fixtures() -> Dict[str, Any]:
    return json.loads(_FIXTURES_PATH.read_text(encoding="utf-8"))


@functools.lru_cache(maxsize=1)
def _resources() -> Dict[str, Any]:
    return json.loads(_RESOURCES_PATH.read_text(encoding="utf-8"))


def _account_record(account_id: str) -> Dict[str, Any]:
    record = _fixtures().get("accounts", {}).get(account_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"OBP-30001: Account {account_id} not found")
    return record


def _resource_record(collection: str, key: str, code: str) -> Dict[str, Any]:
    record = _resources().get(collection, {}).get(key)
    if record is None:
        raise HTTPException(status_code=404, detail=f"{code}: {key} not found")
    return record


@router.get("/banks/{bank_id}/accounts/{account_id}/{view_id}/account")
async def get_account(bank_id: str, account_id: str, view_id: str) -> Dict[str, Any]:
    """The OBP account read. Returns balance and routing, never the register."""
    return _account_record(account_id)["account"]


@router.get("/banks/{bank_id}/accounts/{account_id}/{view_id}/attributes")
async def get_account_attributes(bank_id: str, account_id: str, view_id: str) -> Dict[str, Any]:
    """Account attributes. The compliance state the transaction API omits."""
    return {"account_attributes": _account_record(account_id)["account_attributes"]}


@router.get("/banks/{bank_id}/counterparties/{counterparty_id}")
async def get_counterparty(bank_id: str, counterparty_id: str) -> Dict[str, Any]:
    """A payee record with its verification result and monitored-region flag."""
    return _resource_record("counterparties", counterparty_id, "OBP-50001")


@router.get("/banks/{bank_id}/cards/{card_id}")
async def get_card(bank_id: str, card_id: str) -> Dict[str, Any]:
    """A corporate card with its status, lost flag and current limit."""
    return _resource_record("cards", card_id, "OBP-30201")


@router.get("/banks/{bank_id}/datasets/{dataset_id}")
async def get_dataset(bank_id: str, dataset_id: str) -> Dict[str, Any]:
    """A customer dataset with its export policy."""
    return _resource_record("datasets", dataset_id, "OBP-31001")
