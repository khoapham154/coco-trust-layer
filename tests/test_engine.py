"""Unit tests for the gateway engine."""

from __future__ import annotations

import pytest

from tests.conftest import PACK_DIR

from engine import (
    AgentActionPack,
    CheckType,
    DSLError,
    GatewayEngine,
    UIState,
    Verdict,
    evaluate,
)


# ---------- UIState ----------

def test_ui_state_dot_path():
    state = UIState.from_dict({"deal": {"amount": 100, "owner": "u1"}})
    assert state.get("deal.amount") == 100
    assert state.get("deal.owner") == "u1"


def test_ui_state_missing_path_returns_none():
    state = UIState.from_dict({"deal": {"amount": 100}})
    assert state.get("deal.owner") is None
    assert state.get("foo.bar.baz") is None
    assert state.get("") is None


def test_ui_state_bracket_index():
    state = UIState.from_dict(
        {"email": {"recipients": [{"email": "a@x.com"}, {"email": "b@x.com"}]}}
    )
    assert state.get("email.recipients[0].email") == "a@x.com"
    assert state.get("email.recipients[1].email") == "b@x.com"
    assert state.get("email.recipients[5].email") is None


# ---------- DSL ----------

def test_dsl_basic_compare():
    assert evaluate("deal.amount < 50000", {"deal": {"amount": 30000}}) is True
    assert evaluate("deal.amount < 50000", {"deal": {"amount": 75000}}) is False


def test_dsl_bool_ops():
    state = {"deal": {"amount": 75000, "manager_field_filled": True}}
    assert evaluate(
        "deal.amount < 50000 or deal.manager_field_filled == True",
        state,
    ) is True


def test_dsl_not_operator():
    assert evaluate("not email.has_flagged_recipient", {"email": {"has_flagged_recipient": False}}) is True
    assert evaluate("not email.has_flagged_recipient", {"email": {"has_flagged_recipient": True}}) is False


def test_dsl_rejects_call():
    with pytest.raises(DSLError):
        evaluate("len(email.recipients)", {"email": {"recipients": [1, 2]}})


def test_dsl_rejects_import():
    with pytest.raises(DSLError):
        evaluate("__import__('os')", {})


def test_dsl_rejects_lambda():
    with pytest.raises(DSLError):
        evaluate("(lambda x: x)(1)", {})


def test_dsl_rejects_dunder_attribute():
    with pytest.raises(DSLError):
        evaluate("deal.__class__", {"deal": {"amount": 10}})


def test_dsl_unknown_name_errors():
    with pytest.raises(DSLError):
        evaluate("unknown_thing > 0", {})


# ---------- Pack loading ----------

def test_all_packs_load():
    packs = AgentActionPack.load_all(PACK_DIR)
    assert set(packs.keys()) == {
        "twenty.deal_stage_move",
        "twenty.contact_delete",
        "twenty.opportunity_create",
        "twenty.bulk_email",
        "twenty.field_update",
    }
    for pack in packs.values():
        assert pack.id.startswith("twenty.")
        assert pack.action
        assert pack.description


def test_pack_has_expected_structure():
    packs = AgentActionPack.load_all(PACK_DIR)
    dsm = packs["twenty.deal_stage_move"]
    assert len(dsm.pre_conditions) >= 1
    assert len(dsm.constraints) >= 1
    assert len(dsm.post_conditions) >= 1
    assert any(c.id == "high_value_manager" for c in dsm.constraints)


# ---------- Gateway validation ----------

def test_gateway_allow_on_happy_path():
    packs = AgentActionPack.load_all(PACK_DIR)
    engine = GatewayEngine(packs)
    state = {
        "deal": {
            "owner": "u_001",
            "amount": 20000,
            "prev_stage_tasks_completed": True,
            "is_sequential_stage_move": True,
            "manager_field_filled": False,
            "target_stage": "negotiation",
        },
        "user": {"role": "sales"},
    }
    decision = engine.validate("twenty.deal_stage_move", "move_stage", state)
    assert decision.verdict == Verdict.ALLOW
    assert all(c.passed for c in decision.checks)


def test_gateway_blocks_on_pre_condition_fail():
    packs = AgentActionPack.load_all(PACK_DIR)
    engine = GatewayEngine(packs)
    state = {
        "deal": {
            "owner": None,
            "amount": 20000,
            "prev_stage_tasks_completed": True,
            "is_sequential_stage_move": True,
            "manager_field_filled": False,
        },
        "user": {"role": "sales"},
    }
    decision = engine.validate("twenty.deal_stage_move", "move_stage", state)
    assert decision.verdict == Verdict.BLOCK
    assert "owner" in decision.primary_reason.lower()
    # Short-circuit: only first check is recorded
    assert len(decision.checks) == 1


def test_gateway_escalates_high_value():
    packs = AgentActionPack.load_all(PACK_DIR)
    engine = GatewayEngine(packs)
    state = {
        "deal": {
            "owner": "u_001",
            "amount": 100000,
            "prev_stage_tasks_completed": True,
            "is_sequential_stage_move": True,
            "manager_field_filled": False,
        },
        "user": {"role": "sales"},
    }
    decision = engine.validate("twenty.deal_stage_move", "move_stage", state)
    assert decision.verdict == Verdict.ESCALATE
    assert "manager" in decision.primary_reason.lower()


def test_gateway_unknown_pack_blocks():
    engine = GatewayEngine({})
    decision = engine.validate("nonexistent.pack", "do_thing", {})
    assert decision.verdict == Verdict.BLOCK
    assert "unknown_pack" in decision.primary_reason


def test_gateway_post_phase_runs_post_conditions():
    packs = AgentActionPack.load_all(PACK_DIR)
    engine = GatewayEngine(packs)
    # After a successful delete, contact should not appear in views.
    good_state = {"ui": {"contact_in_views": False}}
    decision = engine.validate(
        "twenty.contact_delete", "delete_contact", good_state, phase="post"
    )
    assert decision.verdict == Verdict.ALLOW

    bad_state = {"ui": {"contact_in_views": True}}
    decision = engine.validate(
        "twenty.contact_delete", "delete_contact", bad_state, phase="post"
    )
    assert decision.verdict == Verdict.BLOCK
    assert "still visible" in decision.primary_reason.lower()
