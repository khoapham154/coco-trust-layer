"""Securities-lending packs + provider, exercised through the gateway engine.

Loads the five ``securities_lending.*`` packs, builds each ``ui_state`` with the
real provider, and asserts the verdict the gateway returns. No HTTP, no
FastAPI: this is the fast regression that proves the contracts and the
state-aggregation agree.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from tests.conftest import REPO_ROOT

from engine import AgentActionPack, GatewayEngine, Verdict
from providers.seclend import SecLendStateProvider

SECLEND_PACK_DIR = REPO_ROOT / "data" / "securities_lending" / "packs"


@pytest.fixture(scope="module")
def engine() -> GatewayEngine:
    return GatewayEngine(AgentActionPack.load_all(SECLEND_PACK_DIR))


@pytest.fixture(scope="module")
def provider() -> SecLendStateProvider:
    return SecLendStateProvider()


def test_five_packs_load_and_are_cdm_anchored(engine: GatewayEngine):
    sl = {pid: p for pid, p in engine.packs.items() if pid.startswith("securities_lending.")}
    assert len(sl) == 5
    assert all(p.cdm_event for p in sl.values()), "every SL pack must name a CDM event"


# ---------- loan execution (book_loan) ----------

@pytest.mark.parametrize(
    "security_id,counterparty_id,quantity,expected",
    [
        ("AAPL", "citadel-sec", 10000, Verdict.ALLOW),     # routine
        ("GME", "meridian-bd", 20000, Verdict.BLOCK),      # inventory short
        ("AAPL", "jane-street", 10000, Verdict.BLOCK),     # over the cap
        ("TSLA", "citadel-sec", 5000, Verdict.BLOCK),      # recall live
        ("AAPL", "citadel-sec", 50000, Verdict.ESCALATE),  # large notional
    ],
)
def test_loan_execution(engine, provider, security_id, counterparty_id, quantity, expected):
    ui_state, _ = provider.loan_execution_state(security_id, counterparty_id, quantity)
    decision = engine.validate("securities_lending.loan_execution", "book_loan", ui_state)
    assert decision.verdict == expected


# ---------- collateral (post_collateral) ----------

@pytest.mark.parametrize(
    "posted_value,collateral_type,concentration,expected",
    [
        (2000000, "cash", 0, Verdict.ALLOW),
        (1900000, "cash", 0, Verdict.BLOCK),       # below threshold
        (2000000, "equity", 30, Verdict.ESCALATE),  # over concentration limit
    ],
)
def test_collateral(engine, provider, posted_value, collateral_type, concentration, expected):
    ui_state, _ = provider.collateral_state("loan-001", posted_value, collateral_type, concentration)
    decision = engine.validate("securities_lending.collateral", "post_collateral", ui_state)
    assert decision.verdict == expected


# ---------- rate (agree_rate) ----------

@pytest.mark.parametrize(
    "security_id,fee_bps,expected",
    [
        ("AAPL", 35, Verdict.ALLOW),
        ("GME", 200, Verdict.BLOCK),      # below the hard-to-borrow floor
        ("AAPL", 70, Verdict.ESCALATE),   # in band but far from benchmark
    ],
)
def test_rate(engine, provider, security_id, fee_bps, expected):
    ui_state, _ = provider.rate_state(security_id, fee_bps)
    decision = engine.validate("securities_lending.rate", "agree_rate", ui_state)
    assert decision.verdict == expected


# ---------- recall (roll_loan) ----------

@pytest.mark.parametrize(
    "loan_id,expected",
    [
        ("loan-001", Verdict.ALLOW),      # no recall, deadline far
        ("loan-002", Verdict.BLOCK),      # recall live
        ("loan-003", Verdict.ESCALATE),   # deadline inside the warning window
    ],
)
def test_recall(engine, provider, loan_id, expected):
    ui_state, _ = provider.recall_state(loan_id, "roll")
    decision = engine.validate("securities_lending.recall", "roll_loan", ui_state)
    assert decision.verdict == expected


# ---------- reporting (submit_report) ----------

@pytest.mark.parametrize(
    "report_id,expected",
    [
        ("rpt-clean", Verdict.ALLOW),
        ("rpt-missing-uti", Verdict.BLOCK),
        ("rpt-late", Verdict.ESCALATE),
    ],
)
def test_reporting(engine, provider, report_id, expected):
    ui_state, _ = provider.reporting_state(report_id)
    decision = engine.validate("securities_lending.reporting", "submit_report", ui_state)
    assert decision.verdict == expected
