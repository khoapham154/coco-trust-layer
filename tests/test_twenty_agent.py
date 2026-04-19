"""Tests for agents.twenty_agent — scenario driver.

Uses stubbed gateway + Twenty clients so no external service is
required. The key invariant: on BLOCK / ESCALATE the agent must NOT
hit Twenty's mutating endpoints.
"""

from __future__ import annotations

from typing import Any, Dict, List

import httpx
import pytest

from tests.conftest import BACKEND_DIR  # noqa: F401  (sys.path side effect)

from agents.twenty_agent import TwentyAgent


class StubProvider:
    def __init__(self, state: Dict[str, Any]):
        self.state = state

    def deal_state(self, **kwargs):
        return self.state

    def contact_state(self, **kwargs):
        return self.state

    def opportunity_state(self, payload):
        return self.state

    def email_state(self, **kwargs):
        return self.state

    def field_update_state(self, **kwargs):
        return self.state


def _gateway_client(verdicts: List[Dict[str, Any]]) -> httpx.Client:
    calls: List[Dict[str, Any]] = []

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/api/validate":
            calls.append({"path": req.url.path, "body": req.content.decode("utf-8")})
            return httpx.Response(200, json=verdicts.pop(0))
        return httpx.Response(404)

    client = httpx.Client(base_url="http://gateway-mock", transport=httpx.MockTransport(handler))
    client._calls = calls  # type: ignore[attr-defined]  # test-only
    return client


def _twenty_client(expect_mutation: bool) -> httpx.Client:
    calls: List[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(f"{req.method} {req.url.path}")
        if req.method.upper() in {"POST", "PATCH", "DELETE"}:
            if not expect_mutation:
                raise AssertionError(
                    f"Agent must not mutate Twenty when verdict is not ALLOW: {req.method} {req.url.path}"
                )
            return httpx.Response(200, json={"data": {"opportunity": {"id": "opp-1", "stage": "SCREENING"}}})
        return httpx.Response(200, json={"data": {}})

    client = httpx.Client(base_url="http://twenty-mock", transport=httpx.MockTransport(handler))
    client._calls = calls  # type: ignore[attr-defined]
    return client


def test_agent_runs_allow_scenario_and_mutates(monkeypatch, tmp_path):
    # Force fixtures to be present so _build_live_state picks the provider path.
    from agents import twenty_agent as ta_mod

    fixtures = {
        "companies": {},
        "people": {},
        "opportunities": {"Northwind Labs — Enterprise Trust Layer": "opp-1"},
    }
    fixture_file = tmp_path / "seeded.json"
    import json as _json
    fixture_file.write_text(_json.dumps(fixtures))
    monkeypatch.setattr(ta_mod, "_fixtures_path", lambda: fixture_file)

    agent = TwentyAgent(
        twenty_base_url="http://twenty-mock",
        twenty_api_key="",
        gateway_url="http://gateway-mock",
        twenty_client=_twenty_client(expect_mutation=True),
        gateway_client=_gateway_client([
            {
                "verdict": "ALLOW",
                "pack_id": "twenty.deal_stage_move",
                "action": "move_stage",
                "phase": "pre",
                "primary_reason": "All checks passed",
                "checks": [],
                "timestamp": "2026-04-13T00:00:00Z",
            }
        ]),
        state_provider=StubProvider({
            "deal": {
                "owner": "u1",
                "amount": 10000,
                "prev_stage_tasks_completed": True,
                "is_sequential_stage_move": True,
                "manager_field_filled": False,
                "target_stage": "screening",
            },
            "user": {"role": "sales"},
        }),
    )

    trace = agent.run("deal_stage_move_allow")
    assert trace["driver"] == "twenty"
    assert trace["decision"]["verdict"] == "ALLOW"
    assert trace["twenty_response"] is not None, "Mutation must run on ALLOW"
    twenty_calls = agent.twenty._calls  # type: ignore[attr-defined]
    assert any(c.startswith("PATCH") for c in twenty_calls)


def test_agent_blocks_skip_mutation(monkeypatch, tmp_path):
    from agents import twenty_agent as ta_mod

    fixtures = {
        "companies": {},
        "people": {},
        "opportunities": {"Northwind Labs — Enterprise Trust Layer": "opp-1"},
    }
    fixture_file = tmp_path / "seeded.json"
    import json as _json
    fixture_file.write_text(_json.dumps(fixtures))
    monkeypatch.setattr(ta_mod, "_fixtures_path", lambda: fixture_file)

    agent = TwentyAgent(
        twenty_base_url="http://twenty-mock",
        twenty_api_key="",
        gateway_url="http://gateway-mock",
        twenty_client=_twenty_client(expect_mutation=False),
        gateway_client=_gateway_client([
            {
                "verdict": "BLOCK",
                "pack_id": "twenty.deal_stage_move",
                "action": "move_stage",
                "phase": "pre",
                "primary_reason": "Deal has no assigned owner",
                "checks": [],
                "timestamp": "2026-04-13T00:00:00Z",
            }
        ]),
        state_provider=StubProvider({
            "deal": {
                "owner": None,
                "amount": 10000,
                "prev_stage_tasks_completed": True,
                "is_sequential_stage_move": True,
                "manager_field_filled": False,
                "target_stage": "screening",
            },
            "user": {"role": "sales"},
        }),
    )

    trace = agent.run("deal_stage_move_block_no_owner")
    assert trace["decision"]["verdict"] == "BLOCK"
    assert trace["twenty_response"] is None, "Mutation must not run on BLOCK"
    # The Twenty client should have zero mutating calls (handler asserts this).
    twenty_calls = agent.twenty._calls  # type: ignore[attr-defined]
    assert not any(c.split()[0] in {"POST", "PATCH", "DELETE"} for c in twenty_calls), (
        f"Unexpected Twenty mutations: {twenty_calls}"
    )
