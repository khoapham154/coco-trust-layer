"""Tests for providers.twenty — the Twenty state adapter.

Uses httpx.MockTransport so the provider talks to a stub that returns
canned Twenty payloads. Every pack's `ui_state` builder is exercised.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Callable, Dict

import httpx
import pytest

from tests.conftest import BACKEND_DIR  # noqa: F401  (sys.path side effect)

from providers.twenty import TwentyStateProvider


def _make_client(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    transport = httpx.MockTransport(handler)
    return httpx.Client(base_url="http://twenty-mock", transport=transport)


def _envelope(key: str, payload) -> Dict:
    return {"data": {key: payload}}


# --- deal_state --------------------------------------------------------


def test_deal_state_sequential_move_allow():
    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/rest/opportunities/opp-1":
            return httpx.Response(200, json=_envelope("opportunity", {
                "id": "opp-1",
                "pointOfContactId": "user-42",
                "amount": {"amountMicros": 30_000_000_000, "currencyCode": "USD"},
                "stage": "NEW",
                "managerId": None,
            }))
        if req.url.path == "/rest/tasks":
            return httpx.Response(200, json=_envelope("tasks", [
                {"id": "t-1", "status": "DONE"},
                {"id": "t-2", "status": "COMPLETED"},
            ]))
        return httpx.Response(404, json={"detail": "unexpected"})

    provider = TwentyStateProvider(
        base_url="http://twenty-mock",
        api_key="k",
        client=_make_client(handler),
    )
    state = provider.deal_state("opp-1", target_stage="screening")
    deal = state["deal"]
    assert deal["owner"] == "user-42"
    assert deal["amount"] == 30000.0
    assert deal["prev_stage_tasks_completed"] is True
    assert deal["is_sequential_stage_move"] is True
    assert deal["manager_field_filled"] is False
    assert deal["target_stage"] == "screening"


def test_deal_state_skips_stage():
    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path.startswith("/rest/opportunities/"):
            return httpx.Response(200, json=_envelope("opportunity", {
                "id": "opp-2",
                "pointOfContactId": "user-1",
                "amount": {"amountMicros": 20_000_000_000},
                "stage": "NEW",
            }))
        if req.url.path == "/rest/tasks":
            return httpx.Response(200, json=_envelope("tasks", []))
        return httpx.Response(404)

    provider = TwentyStateProvider(
        base_url="http://twenty-mock", api_key="k", client=_make_client(handler)
    )
    state = provider.deal_state("opp-2", target_stage="proposal")
    # NEW → PROPOSAL skips SCREENING and MEETING → not sequential.
    assert state["deal"]["is_sequential_stage_move"] is False


# --- contact_state ----------------------------------------------------


def test_contact_state_counts_open_opportunities():
    modified = (datetime.now(timezone.utc) - timedelta(days=42)).isoformat()

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/rest/people/p-1":
            return httpx.Response(200, json=_envelope("person", {
                "id": "p-1",
                "updatedAt": modified,
            }))
        if req.url.path == "/rest/opportunities":
            # Provider filters locally by pointOfContactId, so fixtures
            # include the FK. A fourth row for another contact verifies
            # the filter actually drops unrelated opportunities.
            return httpx.Response(200, json=_envelope("opportunities", [
                {"id": "o1", "stage": "NEW", "pointOfContactId": "p-1"},
                {"id": "o2", "stage": "WON", "pointOfContactId": "p-1"},
                {"id": "o3", "stage": "SCREENING", "pointOfContactId": "p-1"},
                {"id": "o4", "stage": "NEW", "pointOfContactId": "p-other"},
            ]))
        return httpx.Response(404)

    provider = TwentyStateProvider(
        base_url="http://twenty-mock", api_key="k", client=_make_client(handler)
    )
    state = provider.contact_state("p-1")
    contact = state["contact"]
    assert contact["open_opportunity_count"] == 2  # NEW, SCREENING (not WON)
    assert contact["days_since_modified"] >= 41


# --- opportunity_state -------------------------------------------------


def test_opportunity_state_future_close_date():
    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/rest/companies/c-1":
            return httpx.Response(200, json=_envelope("company", {"id": "c-1", "name": "Acme"}))
        return httpx.Response(404)

    provider = TwentyStateProvider(
        base_url="http://twenty-mock", api_key="k", client=_make_client(handler)
    )
    future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    state = provider.opportunity_state({
        "companyId": "c-1",
        "amount": {"amountMicros": 50_000_000_000},
        "closeDate": future,
    })
    opp = state["opportunity"]
    assert opp["company_id"] == "c-1"
    assert opp["amount"] == 50000.0
    assert opp["close_date_is_future"] is True


def test_opportunity_state_missing_company():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    provider = TwentyStateProvider(
        base_url="http://twenty-mock", api_key="k", client=_make_client(handler)
    )
    state = provider.opportunity_state({"companyId": "missing", "amount": 100, "closeDate": "2030-01-01T00:00:00Z"})
    assert state["opportunity"]["company_id"] is None


# --- email_state -------------------------------------------------------


def test_email_state_aggregates_flags():
    people = {
        "p-1": {"id": "p-1", "emails": {"primaryEmail": "a@x"}, "doNotContact": False},
        "p-2": {"id": "p-2", "emails": {"primaryEmail": "b@x"}, "doNotContact": True},
        "p-3": {"id": "p-3", "emails": {"primaryEmail": None}},
    }

    def handler(req: httpx.Request) -> httpx.Response:
        for pid, payload in people.items():
            if req.url.path == f"/rest/people/{pid}":
                return httpx.Response(200, json=_envelope("person", payload))
        return httpx.Response(404)

    provider = TwentyStateProvider(
        base_url="http://twenty-mock", api_key="k", client=_make_client(handler)
    )
    state = provider.email_state(
        recipient_ids=["p-1", "p-2", "p-3"],
        activity_logged_ids=["p-1", "p-2"],
    )
    email = state["email"]
    assert email["recipient_count"] == 3
    assert email["has_flagged_recipient"] is True
    assert email["all_recipients_have_email"] is False
    assert email["activity_logged_for_all"] is False


# --- field_update_state ------------------------------------------------


def test_field_update_state_email_validation():
    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/rest/people/p-1":
            return httpx.Response(200, json=_envelope("person", {
                "id": "p-1",
                "archivedAt": None,
            }))
        return httpx.Response(404)

    provider = TwentyStateProvider(
        base_url="http://twenty-mock", api_key="k", client=_make_client(handler)
    )

    good = provider.field_update_state(
        entity="people", record_id="p-1", field="email", new_value="alice@example.com"
    )
    assert good["record"]["exists"] is True
    assert good["record"]["archived"] is False
    assert good["field_update"]["email_format_valid"] is True

    bad = provider.field_update_state(
        entity="people", record_id="p-1", field="email", new_value="not-an-email"
    )
    assert bad["field_update"]["email_format_valid"] is False


def test_field_update_state_required_field_emptied():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_envelope("person", {"id": "p-1"}))

    provider = TwentyStateProvider(
        base_url="http://twenty-mock", api_key="k", client=_make_client(handler)
    )
    state = provider.field_update_state(
        entity="people",
        record_id="p-1",
        field="name",
        new_value="",
        required_fields=["name"],
    )
    assert state["field_update"]["required_fields_still_filled"] is False
