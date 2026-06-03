"""Open Bank Project state adapter.

Builds the `ui_state` dict the `banking.wire_transfer` pack expects from an
OBP-shaped bank API. The OBP account read returns a healthy account with a
positive balance, so a caller that trusts the transaction API alone never
sees a sanctions hold. The hold lives in account attributes. This adapter
reads both and merges them, which is the whole point of the demo: the gap
between what the transaction API exposes and what the live account state
holds is exactly what the gateway gets to enforce on.

The adapter flattens the OBP `account_attributes` list into the scalars the
pack compares directly, because the DSL does not permit function calls.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import httpx

log = logging.getLogger("coco.providers.bank")

_FIXTURES_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "banking" / "accounts.json"


def _fixtures() -> Dict[str, Any]:
    return json.loads(_FIXTURES_PATH.read_text(encoding="utf-8"))


def _as_bool(value: Any) -> bool:
    return str(value).strip().lower() == "true"


def _flatten_attributes(attributes: list) -> Dict[str, str]:
    return {a["name"]: a["value"] for a in attributes if "name" in a}


class BankStateProvider:
    """Returns a pack-ready `ui_state` for an OBP-shaped wire transfer."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        *,
        bank_id: str = "coco-demo-bank",
        view_id: str = "owner",
        client: Optional[httpx.Client] = None,
        timeout: float = 10.0,
    ):
        port = os.environ.get("COCO_PORT", "8080")
        self.base_url = (base_url or os.environ.get("COCO_GATEWAY_URL", f"http://localhost:{port}")).rstrip("/")
        self.bank_id = bank_id
        self.view_id = view_id
        if client is not None:
            self.client = client
            self._owns_client = False
        else:
            self.client = httpx.Client(base_url=self.base_url, timeout=timeout)
            self._owns_client = True

    def close(self) -> None:
        if self._owns_client:
            self.client.close()

    def transfer_state(
        self,
        account_id: str,
        payee: str,
        amount: float,
        *,
        currency: str = "USD",
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        """Return ``(ui_state, account_view)`` for ``banking.wire_transfer``.

        ``account_view`` is the OBP account read, the "valid" view a caller
        sees from the transaction API. ``ui_state`` adds the hold and the
        beneficiary check the read never carried.
        """
        record = self._fetch(account_id)
        account = record["account"]
        attrs = _flatten_attributes(record["account_attributes"])

        beneficiaries = [b.strip() for b in attrs.get("approved_beneficiaries", "").split(",") if b.strip()]
        ui_state = {
            "account": {
                "id": account.get("id"),
                "status": attrs.get("status", "active"),
                "sanctions_hold": _as_bool(attrs.get("sanctions_hold")),
                "balance": account.get("balance"),
            },
            "transfer": {
                "amount": float(amount),
                "currency": currency,
                "payee": payee,
                "payee_approved": payee in beneficiaries,
            },
        }
        return ui_state, account

    # --- fetch with fixtures fallback --------------------------------

    def _fetch(self, account_id: str) -> Dict[str, Any]:
        base = f"/mock-obp/v5.1.0/banks/{self.bank_id}/accounts/{account_id}/{self.view_id}"
        try:
            account = self._get(f"{base}/account")
            attributes = self._get(f"{base}/attributes").get("account_attributes", [])
            return {"account": account, "account_attributes": attributes}
        except httpx.HTTPError as exc:
            log.warning("mock OBP fetch failed (%s) — reading fixtures directly", exc)
            record = _fixtures().get("accounts", {}).get(account_id)
            if record is None:
                raise KeyError(f"Unknown demo account: {account_id}") from exc
            return record

    def _get(self, path: str) -> Dict[str, Any]:
        resp = self.client.get(path)
        resp.raise_for_status()
        return resp.json()
