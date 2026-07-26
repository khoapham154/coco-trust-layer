"""Open Bank Project state adapter.

Builds the `ui_state` dict the `banking.wire_transfer` pack expects from an
OBP-shaped bank API. The OBP account read returns a healthy account with a
positive balance, so a caller that trusts the transaction API alone never
sees the beneficiary register: which payees are approved, and which account
each payee is approved to receive at. That register lives in account
attributes. This adapter reads both and merges them, which is the whole
point of the demo: the gap between what the transaction API exposes and
what the live account state holds is exactly what the gateway gets to
enforce on.

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
_RESOURCES_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "banking" / "resources.json"


def _fixtures() -> Dict[str, Any]:
    return json.loads(_FIXTURES_PATH.read_text(encoding="utf-8"))


def _resources() -> Dict[str, Any]:
    return json.loads(_RESOURCES_PATH.read_text(encoding="utf-8"))


def _as_bool(value: Any) -> bool:
    return str(value).strip().lower() == "true"


def _flatten_attributes(attributes: list) -> Dict[str, str]:
    return {a["name"]: a["value"] for a in attributes if "name" in a}


def _parse_beneficiary_accounts(raw: str) -> Dict[str, str]:
    """Parse a ``Name=ACCT;Name=ACCT`` attribute into a payee → account map."""
    out: Dict[str, str] = {}
    for pair in raw.split(";"):
        name, sep, acct = pair.partition("=")
        if sep and name.strip() and acct.strip():
            out[name.strip()] = acct.strip()
    return out


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
        # Self-call target: prefer COCO_PORT, then the platform's PORT (Render
        # injects it), then the local default. Keeps the mock-OBP round-trip
        # working wherever the gateway listens.
        port = os.environ.get("COCO_PORT") or os.environ.get("PORT") or "8080"
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
        destination_account: Optional[str] = None,
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        """Return ``(ui_state, account_view)`` for ``banking.wire_transfer``.

        ``account_view`` is the OBP account read, the "valid" view a caller
        sees from the transaction API. ``ui_state`` adds the beneficiary
        register the read never carried: whether the payee is approved, and
        which account that payee is approved to receive at. When the request
        names no destination, the agent is taken to have used the account on
        file.
        """
        record = self._fetch(account_id)
        account = record["account"]
        attrs = _flatten_attributes(record["account_attributes"])

        beneficiaries = [b.strip() for b in attrs.get("approved_beneficiaries", "").split(",") if b.strip()]
        on_file = _parse_beneficiary_accounts(attrs.get("beneficiary_accounts", "")).get(payee)
        ui_state = {
            "account": {
                "id": account.get("id"),
                "status": attrs.get("status", "active"),
                "auto_release_limit": float(attrs.get("auto_release_limit", 0) or 0),
                "balance": account.get("balance"),
            },
            "transfer": {
                "amount": float(amount),
                "currency": currency,
                "payee": payee,
                "payee_approved": payee in beneficiaries,
                "destination_account": destination_account or on_file,
                "payee_account_on_file": on_file,
            },
        }
        return ui_state, account

    def beneficiary_state(
        self,
        account_id: str,
        counterparty_id: str,
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        """Return ``(ui_state, counterparty_view)`` for ``banking.add_beneficiary``.

        The verification result and jurisdiction tier come from the
        counterparty record, which the agent's add request never carries.
        """
        account = self._fetch(account_id)
        acct_attrs = _flatten_attributes(account["account_attributes"])

        record = self._fetch_resource("counterparties", counterparty_id)
        cp = record["counterparty"]
        cp_attrs = _flatten_attributes(record["counterparty_attributes"])

        ui_state = {
            "account": {"status": acct_attrs.get("status", "active")},
            "counterparty": {
                "name": cp.get("name"),
                "jurisdiction": cp.get("jurisdiction"),
                "account_verified": _as_bool(cp_attrs.get("account_verified")),
                "first_time_in_monitored_region": _as_bool(cp_attrs.get("first_time_in_monitored_region")),
            },
        }
        return ui_state, cp

    def card_state(
        self,
        card_id: str,
        requested_limit: float,
        *,
        currency: str = "USD",
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        """Return ``(ui_state, card_view)`` for ``banking.card_controls``."""
        record = self._fetch_resource("cards", card_id)
        card = record["card"]
        attrs = _flatten_attributes(record["card_attributes"])

        ui_state = {
            "card": {
                "id": card.get("card_id"),
                "label": card.get("label"),
                "status": card.get("status", "active"),
                "reported_lost": _as_bool(attrs.get("reported_lost")),
                "current_limit": float(attrs.get("current_limit", 0) or 0),
            },
            "request": {"requested_limit": float(requested_limit), "currency": currency},
        }
        return ui_state, card

    def data_export_state(
        self,
        dataset_id: str,
        purpose_declared: bool,
        record_count: int,
        cross_border: bool,
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        """Return ``(ui_state, dataset_view)`` for ``banking.data_export``.

        The export switch comes from the dataset; the purpose, volume and
        destination come from the agent's request.
        """
        record = self._fetch_resource("datasets", dataset_id)
        dataset = record["dataset"]
        attrs = _flatten_attributes(record["dataset_attributes"])

        ui_state = {
            "policy": {"exports_enabled": _as_bool(attrs.get("exports_enabled"))},
            "request": {
                "purpose_declared": bool(purpose_declared),
                "record_count": int(record_count),
                "cross_border": bool(cross_border),
                "dataset": dataset_id,
            },
        }
        return ui_state, dataset

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

    def _fetch_resource(self, collection: str, key: str) -> Dict[str, Any]:
        """Read a banking resource (counterparty, card, dataset) by id.

        Hits the mock OBP route, falling back to the fixtures file if the
        round-trip fails, the same way the account read does.
        """
        try:
            return self._get(f"/mock-obp/v5.1.0/banks/{self.bank_id}/{collection}/{key}")
        except httpx.HTTPError as exc:
            log.warning("mock OBP fetch failed (%s) — reading fixtures directly", exc)
            record = _resources().get(collection, {}).get(key)
            if record is None:
                raise KeyError(f"Unknown demo {collection}: {key}") from exc
            return record

    def _get(self, path: str) -> Dict[str, Any]:
        resp = self.client.get(path)
        resp.raise_for_status()
        return resp.json()
