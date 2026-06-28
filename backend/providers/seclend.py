"""Securities-lending state adapter.

Builds the ``ui_state`` dict each ``securities_lending.*`` pack expects from
the desk blotter. The blotter is a set of JSON fixtures standing in for a
lending platform such as an extended FINOS TraderX: per-security inventory and
recall flags, per-counterparty exposure, open-loan agreements, and pending
regulatory reports. A booking, collateral or roll request carries only what
the agent decided; the live inventory, the recall flag, the borrower's running
exposure and the agreed margin threshold sit in the blotter. The gap between
what the request carries and what the blotter holds is exactly what the gateway
enforces on.

The DSL forbids function calls, so this adapter pre-aggregates the few derived
values a contract needs (notional, exposure after the booking, required margin,
distance from the rate benchmark, recall warning window) into plain scalars
before the gateway runs.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, Tuple

log = logging.getLogger("coco.providers.seclend")

_DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "securities_lending"

# A roll inside this many days of a recall deadline is escalated, not auto-run.
_RECALL_WARNING_WINDOW_DAYS = 5
# A fee further than this fraction of the benchmark away is escalated for review.
_BENCHMARK_DEVIATION_FRACTION = 0.5


def _load(name: str) -> Dict[str, Any]:
    return json.loads((_DATA_DIR / name).read_text(encoding="utf-8"))


class SecLendStateProvider:
    """Returns a pack-ready ``ui_state`` for each securities-lending action.

    Reads the blotter fixtures directly. No network hop, so unlike the banking
    provider it never calls back into the gateway and needs no worker thread.
    """

    def __init__(self) -> None:
        self._securities = _load("securities.json").get("securities", {})
        self._counterparties = _load("counterparties.json").get("counterparties", {})
        self._loans = _load("loans.json").get("loans", {})
        self._reports = _load("reports.json").get("reports", {})

    # --- lookups with a clear error on a bad id ----------------------

    def _security(self, security_id: str) -> Dict[str, Any]:
        rec = self._securities.get(security_id)
        if rec is None:
            raise KeyError(f"Unknown demo security: {security_id}")
        return rec

    def _counterparty(self, counterparty_id: str) -> Dict[str, Any]:
        rec = self._counterparties.get(counterparty_id)
        if rec is None:
            raise KeyError(f"Unknown demo counterparty: {counterparty_id}")
        return rec

    def _loan(self, loan_id: str) -> Dict[str, Any]:
        rec = self._loans.get(loan_id)
        if rec is None:
            raise KeyError(f"Unknown demo loan: {loan_id}")
        return rec

    def _report(self, report_id: str) -> Dict[str, Any]:
        rec = self._reports.get(report_id)
        if rec is None:
            raise KeyError(f"Unknown demo report: {report_id}")
        return rec

    # --- one method per pack family ----------------------------------

    def loan_execution_state(
        self,
        security_id: str,
        counterparty_id: str,
        quantity: int,
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        """``securities_lending.loan_execution`` — guards the booking.

        The booking API would accept a well-formed request against a funded
        desk. The inventory level, the recall flag and the borrower's running
        exposure live in the blotter, not in the request.
        """
        security = self._security(security_id)
        counterparty = self._counterparty(counterparty_id)

        price = float(security.get("price", 0) or 0)
        notional = round(float(quantity) * price, 2)
        exposure_after = float(counterparty.get("current_exposure", 0)) + notional

        ui_state = {
            "security": {
                "id": security.get("id"),
                "loanable": bool(security.get("loanable")),
                "available_inventory": int(security.get("available_inventory", 0)),
                "recall_active": bool(security.get("recall_active")),
                "corporate_action_active": bool(security.get("corporate_action_active")),
            },
            "counterparty": {
                "id": counterparty.get("id"),
                "exposure_cap": float(counterparty.get("exposure_cap", 0)),
            },
            "request": {
                "quantity": int(quantity),
                "notional": notional,
                "exposure_after": round(exposure_after, 2),
            },
        }
        booking_view = {
            "security": security.get("name"),
            "quantity": int(quantity),
            "price": price,
            "notional": notional,
            "counterparty": counterparty.get("name"),
        }
        return ui_state, booking_view

    def collateral_state(
        self,
        loan_id: str,
        posted_value: float,
        collateral_type: str,
        concentration_pct: float,
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        """``securities_lending.collateral`` — guards posting and substitution.

        The required margin threshold and the eligible collateral set come from
        the loan agreement; the posted value, type and resulting concentration
        come from the agent's request.
        """
        loan = self._loan(loan_id)
        loaned_value = float(loan.get("loaned_value", 0))
        threshold_pct = float(loan.get("required_threshold_pct", 100))
        required_value = round(loaned_value * threshold_pct / 100.0, 2)
        eligible_set = loan.get("eligible_collateral", [])

        ui_state = {
            "loan": {
                "id": loan.get("id"),
                "loaned_value": loaned_value,
                "required_threshold_pct": threshold_pct,
                "required_value": required_value,
            },
            "collateral": {
                "posted_value": float(posted_value),
                "type": collateral_type,
                "eligible": collateral_type in eligible_set,
                "concentration_pct": float(concentration_pct),
            },
        }
        loan_view = {
            "loan_id": loan.get("id"),
            "loaned_value": loaned_value,
            "required_threshold_pct": threshold_pct,
            "required_value": required_value,
            "eligible_collateral": eligible_set,
        }
        return ui_state, loan_view

    def rate_state(
        self,
        security_id: str,
        proposed_fee_bps: float,
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        """``securities_lending.rate`` — guards the fee on execution.

        The approved band and the benchmark come from the desk rate card; the
        proposed fee comes from the agent. Distance from the benchmark is
        pre-aggregated to a boolean because the DSL cannot take an absolute
        value.
        """
        security = self._security(security_id)
        benchmark = float(security.get("benchmark_bps", 0))
        proposed = float(proposed_fee_bps)
        far_from_benchmark = abs(proposed - benchmark) > benchmark * _BENCHMARK_DEVIATION_FRACTION

        ui_state = {
            "security": {
                "id": security.get("id"),
                "hard_to_borrow": bool(security.get("hard_to_borrow")),
                "fee_floor_bps": float(security.get("fee_floor_bps", 0)),
                "fee_ceiling_bps": float(security.get("fee_ceiling_bps", 0)),
            },
            "request": {
                "proposed_fee_bps": proposed,
                "far_from_benchmark": far_from_benchmark,
            },
        }
        rate_view = {
            "security": security.get("name"),
            "fee_floor_bps": security.get("fee_floor_bps"),
            "fee_ceiling_bps": security.get("fee_ceiling_bps"),
            "benchmark_bps": benchmark,
            "proposed_fee_bps": proposed,
        }
        return ui_state, rate_view

    def recall_state(
        self,
        loan_id: str,
        action: str,
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        """``securities_lending.recall`` — guards rolls and extensions.

        The recall flag and deadline come from the loan record; the agent only
        carries the intent to roll or extend.
        """
        loan = self._loan(loan_id)
        recall_active = bool(loan.get("recall_active"))
        deadline_days = int(loan.get("recall_deadline_days", 9999))
        in_warning_window = (not recall_active) and deadline_days <= _RECALL_WARNING_WINDOW_DAYS

        ui_state = {
            "loan": {
                "id": loan.get("id"),
                "recall_active": recall_active,
                "recall_deadline_days": deadline_days,
                "in_warning_window": in_warning_window,
            },
            "request": {"action": action},
        }
        loan_view = {
            "loan_id": loan.get("id"),
            "security_id": loan.get("security_id"),
            "recall_active": recall_active,
            "recall_deadline_days": deadline_days,
            "action": action,
        }
        return ui_state, loan_view

    def reporting_state(
        self,
        report_id: str,
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        """``securities_lending.reporting`` — guards regulatory submission.

        Field completeness, internal consistency and the T+1 deadline are read
        from the desk's own record of the report, not asserted by the agent.
        """
        report = self._report(report_id)
        ui_state = {
            "report": {
                "has_uti": bool(report.get("has_uti")),
                "has_lei": bool(report.get("has_lei")),
                "has_collateral_type": bool(report.get("has_collateral_type")),
                "values_consistent": bool(report.get("values_consistent")),
                "filed_within_deadline": bool(report.get("filed_within_deadline")),
            },
        }
        report_view = {
            "report_id": report.get("id"),
            "loan_id": report.get("loan_id"),
            "regime": report.get("regime"),
        }
        return ui_state, report_view
