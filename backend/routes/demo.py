"""Demo control surface — endpoints used by the in-Twenty popup demo.

These exist solely to make a customer demo recordable without leaving
the Twenty tab. None of these endpoints belong on a production gateway.

Gating: every mutating endpoint refuses unless ``COCO_ALLOW_DEMO_RESET=1``.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from config import settings

log = logging.getLogger("coco.routes.demo")

router = APIRouter(prefix="/api/demo", tags=["demo"])


DEMO_DEAL_NAME = "Northwind Labs — Enterprise Trust Layer"
DEMO_DEAL_CLEAN_STAGE = "NEW"
DEMO_SCENARIO_DEFAULT = "deal_stage_move_block_skip_stage"
DEMO_OWNER_EMAIL = "ada@northwind.test"


def _check_demo_enabled() -> None:
    if not settings.allow_demo_reset:
        raise HTTPException(
            status_code=403,
            detail=(
                "Demo controls are disabled. Restart the gateway with "
                "COCO_ALLOW_DEMO_RESET=1 to enable demo reset and "
                "no-Coco scenarios."
            ),
        )


def _twenty_creds(api_key: Optional[str], base_url: Optional[str]) -> Tuple[str, str]:
    key = api_key or os.environ.get("TWENTY_API_KEY", "")
    url = (base_url or os.environ.get("TWENTY_BASE_URL", "http://localhost:3000")).rstrip("/")
    if not key:
        raise HTTPException(
            status_code=400,
            detail="No Twenty API key. Pass api_key in body or export TWENTY_API_KEY.",
        )
    return key, url


def _gateway_url() -> str:
    return os.environ.get("COCO_GATEWAY_URL", f"http://localhost:{settings.port}")


def _fixtures() -> Dict[str, Any]:
    here = Path(__file__).resolve().parent
    repo_root = here.parent.parent
    path = repo_root / "data" / "twenty" / "fixtures" / "seeded.json"
    if not path.exists():
        return {"companies": {}, "people": {}, "opportunities": {}}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"companies": {}, "people": {}, "opportunities": {}}


class ResetBody(BaseModel):
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    audit_minutes: int = 10


class AgentRunBody(BaseModel):
    scenario_id: str = DEMO_SCENARIO_DEFAULT
    with_coco: bool = True
    api_key: Optional[str] = None
    base_url: Optional[str] = None


class EscalateBody(BaseModel):
    decision_id: int
    comment: Optional[str] = None


@router.get("/state")
async def demo_state(request: Request) -> Dict[str, Any]:
    """Return demo flags + recent verdicts so the popup can render its panel."""
    state: Dict[str, Any] = {
        "demo_mode": settings.demo_mode,
        "demo_enabled": settings.allow_demo_reset,
        "hero_deal_name": DEMO_DEAL_NAME,
        "clean_stage": DEMO_DEAL_CLEAN_STAGE,
        "default_scenario": DEMO_SCENARIO_DEFAULT,
    }
    audit_log = getattr(request.app.state, "audit_log", None)
    if audit_log is not None:
        recent = audit_log.list_recent(limit=10)
        state["recent_verdicts"] = [
            {
                "id": row["id"],
                "ts": row["timestamp"],
                "verdict": row["verdict"],
                "primary_reason": row["primary_reason"],
                "pack_id": row["pack_id"],
            }
            for row in recent
        ]
    return state


@router.post("/reset")
async def demo_reset(body: ResetBody, request: Request) -> Dict[str, Any]:
    """Reset hero deal back to the clean stage and wipe recent audit rows.

    Idempotent — safe to call between every take.
    """
    _check_demo_enabled()
    api_key, base_url = _twenty_creds(body.api_key, body.base_url)

    fixtures = _fixtures()
    deal_id = fixtures.get("opportunities", {}).get(DEMO_DEAL_NAME)
    owner_id = fixtures.get("people", {}).get(DEMO_OWNER_EMAIL)

    deal_reset = False
    owner_set = False
    twenty_error: Optional[str] = None
    if deal_id:
        try:
            async with httpx.AsyncClient(
                base_url=base_url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                timeout=15.0,
            ) as client:
                # Reset stage AND ensure owner is assigned. Both fields in
                # one PATCH so the deal is always demo-ready.
                patch_body: Dict[str, Any] = {"stage": DEMO_DEAL_CLEAN_STAGE}
                if owner_id:
                    patch_body["pointOfContactId"] = owner_id
                resp = await client.patch(
                    f"/rest/opportunities/{deal_id}",
                    json=patch_body,
                )
                resp.raise_for_status()
                deal_reset = True
                owner_set = bool(owner_id)
        except httpx.HTTPError as exc:
            twenty_error = f"Twenty reset failed: {exc}"
            log.warning(twenty_error)
    else:
        twenty_error = (
            f"Hero deal '{DEMO_DEAL_NAME}' not found in seeded.json. "
            "Run scripts/seed_twenty.py first."
        )

    audit_log = getattr(request.app.state, "audit_log", None)
    audit_cleared = 0
    if audit_log is not None and body.audit_minutes > 0:
        since = (
            dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=body.audit_minutes)
        ).isoformat()
        audit_cleared = audit_log.delete_since(since)

    return {
        "deal_name": DEMO_DEAL_NAME,
        "deal_reset": deal_reset,
        "deal_stage": DEMO_DEAL_CLEAN_STAGE if deal_reset else None,
        "owner_set": owner_set,
        "owner_email": DEMO_OWNER_EMAIL if owner_set else None,
        "audit_cleared": audit_cleared,
        "twenty_error": twenty_error,
    }


@router.post("/agent-runs")
async def demo_agent_run(body: AgentRunBody, request: Request) -> Dict[str, Any]:
    """Run the demo scenario, either with Coco gating or without.

    With Coco: the existing scenario engine path (records audit, may BLOCK).
    Without Coco: skip validation, perform mutation directly (no audit row).
    """
    if not body.with_coco:
        _check_demo_enabled()

    api_key, base_url = _twenty_creds(body.api_key, body.base_url)

    try:
        from agents.twenty_agent import TwentyAgent  # type: ignore
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Twenty agent unavailable: {exc}. Set PYTHONPATH to the repo root.",
        )

    agent = TwentyAgent(
        twenty_base_url=base_url,
        twenty_api_key=api_key,
        gateway_url=_gateway_url(),
    )
    try:
        if body.with_coco:
            result = await asyncio.to_thread(agent.run, body.scenario_id)
        else:
            result = await asyncio.to_thread(agent.mutate_only, body.scenario_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    finally:
        agent.close()

    audit_log = getattr(request.app.state, "audit_log", None)
    decision_id: Optional[int] = None
    if body.with_coco and audit_log is not None:
        recent = audit_log.list_recent(limit=1)
        if recent:
            decision_id = recent[0]["id"]

    decision = result.get("decision")
    engine = getattr(request.app.state, "engine", None)
    return {
        "scenario_id": body.scenario_id,
        "with_coco": body.with_coco,
        "verdict": decision.get("verdict") if decision else None,
        "primary_reason": decision.get("primary_reason") if decision else None,
        "pack_id": result.get("pack_id"),
        "decision": decision,
        "decision_id": decision_id,
        "twenty_response": result.get("twenty_response"),
        "mutation_error": result.get("mutation_error"),
        "error": result.get("error"),
        "action_summary": _summarise_attempt(result, body.scenario_id, engine, decision),
    }


def _failing_rule_expression(engine: Any, pack_id: str, check_id: str) -> Optional[str]:
    """Look up the YAML expression of the failing constraint."""
    if engine is None or not pack_id or not check_id:
        return None
    pack = getattr(engine, "packs", {}).get(pack_id)
    if pack is None:
        return None
    for c in getattr(pack, "constraints", []):
        if c.id == check_id:
            return c.rule
    return None


def _summarise_attempt(
    result: Dict[str, Any],
    scenario_id: str,
    engine: Any = None,
    decision: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build a partner-friendly summary of what the agent tried to do.

    Surfaces the deal name, current stage, attempted target stage, the
    requested action, and the failing rule expression (if any) so the
    verdict card can render plain English to a non-technical viewer.
    """
    state = result.get("ui_state") or {}
    deal = state.get("deal") or {}
    summary: Dict[str, Any] = {
        "deal_name": DEMO_DEAL_NAME,
        "current_stage": (deal.get("current_stage") or DEMO_DEAL_CLEAN_STAGE).upper(),
        "target_stage": (deal.get("target_stage") or "").upper(),
        "amount": deal.get("amount"),
        "scenario_id": scenario_id,
        "intent": (
            f"Move stage {(deal.get('current_stage') or DEMO_DEAL_CLEAN_STAGE).upper()} "
            f"→ {(deal.get('target_stage') or '?').upper()}"
        ),
    }
    if decision and decision.get("checks"):
        failing = next((c for c in decision["checks"] if not c.get("passed")), None)
        if failing:
            summary["failing_check_kind"] = failing.get("kind")
            summary["failing_check_id"] = failing.get("check_id")
            if failing.get("kind") == "constraint":
                expr = _failing_rule_expression(engine, result.get("pack_id"), failing.get("check_id"))
                if expr:
                    summary["failing_rule_expression"] = expr
    return summary


@router.post("/escalate")
async def demo_escalate(body: EscalateBody, request: Request) -> Dict[str, Any]:
    """Override a BLOCK by writing an ESCALATE row tied to the same scenario.

    The verdict card's "Override" button calls this to show the third path.
    """
    _check_demo_enabled()
    audit_log = getattr(request.app.state, "audit_log", None)
    if audit_log is None:
        raise HTTPException(status_code=503, detail="Audit log not initialised.")

    recent = audit_log.list_recent(limit=200)
    original = next((row for row in recent if row["id"] == body.decision_id), None)
    if original is None:
        raise HTTPException(
            status_code=404,
            detail=f"Decision {body.decision_id} not in recent audit log.",
        )

    base_decision = original.get("decision", {}) or {}
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    escalation = {
        **base_decision,
        "verdict": "ESCALATE",
        "primary_reason": (
            f"Override requested by operator. "
            f"Original BLOCK: {original.get('primary_reason', '')}. "
            f"Comment: {body.comment or '(none)'}"
        ),
        "phase": base_decision.get("phase", "pre"),
        "timestamp": now,
        "escalated_from": body.decision_id,
    }
    new_id = audit_log.insert_decision(escalation)
    return {
        "id": new_id,
        "verdict": "ESCALATE",
        "escalated_from": body.decision_id,
        "primary_reason": escalation["primary_reason"],
    }
