"""Scenario listing and execution — feeds the dashboard UI.

`GET /api/scenarios` lists the 19 reference scenarios shipped with the
repo. `GET /api/scenarios/{id}` returns one scenario including the
ui_state fixture. `POST /api/scenarios/{id}/run` executes the scenario
against the live gateway engine and writes an audit row.

The `run` endpoint has two modes:

  * **engine mode** (default, always available) — uses the scenario's
    own `ui_state` fixture. No external dependencies. This is what the
    fast regression loop uses, and what the dashboard falls back to
    when Twenty isn't reachable.
  * **twenty mode** (opt-in via `?driver=twenty`) — defers to
    `agents.twenty_agent.TwentyAgent` which drives a live Twenty CRM
    via its REST API, builds `ui_state` from the live data, calls the
    gateway, and (on ALLOW) performs the side-effectful mutation. This
    lands in Step 4 of the plan; for now the driver=twenty path
    returns 503 if the agent module is not yet wired in.
"""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, HTTPException, Query, Request
from pydantic import BaseModel

from config import settings


class RunScenarioBody(BaseModel):
    """Optional per-request Twenty credentials for driver=twenty runs.

    When present, these override the gateway-process env vars so the
    dashboard wizard can drive live Twenty without restarting the
    gateway every time the user re-generates an API key.
    """

    api_key: Optional[str] = None
    base_url: Optional[str] = None

log = logging.getLogger("coco.scenarios")

router = APIRouter()


def _scenarios_dir() -> Path:
    # Scenarios live next to packs under data/twenty/scenarios.
    return settings.pack_dir.parent / "scenarios"


def _load_scenario_file(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def _scenario_summary(scenario: Dict[str, Any]) -> Dict[str, Any]:
    """Trim a scenario record to a list-friendly shape."""
    return {
        "id": scenario["scenario_name"],
        "pack_id": scenario["pack_id"],
        "action": scenario.get("action"),
        "phase": scenario.get("phase", "pre"),
        "expected_verdict": scenario.get("expected_verdict"),
        "expected_reason_contains": scenario.get("expected_reason_contains"),
    }


def _load_all_scenarios() -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    scenarios_dir = _scenarios_dir()
    if not scenarios_dir.exists():
        log.warning("Scenarios dir not found: %s", scenarios_dir)
        return out
    for path in sorted(scenarios_dir.glob("*.json")):
        try:
            out.append(_load_scenario_file(path))
        except (OSError, json.JSONDecodeError) as exc:
            log.warning("Failed to load scenario %s: %s", path, exc)
    return out


def _find_scenario(scenario_id: str) -> Dict[str, Any]:
    target = _scenarios_dir() / f"{scenario_id}.json"
    if not target.exists():
        raise HTTPException(status_code=404, detail=f"Scenario not found: {scenario_id}")
    return _load_scenario_file(target)


@router.get("/api/scenarios")
async def list_scenarios() -> List[Dict[str, Any]]:
    return [_scenario_summary(s) for s in _load_all_scenarios()]


@router.get("/api/scenarios/{scenario_id}")
async def get_scenario(scenario_id: str) -> Dict[str, Any]:
    return _find_scenario(scenario_id)


@router.post("/api/scenarios/{scenario_id}/run")
async def run_scenario(
    request: Request,
    scenario_id: str,
    driver: str = Query("engine", pattern="^(engine|twenty)$"),
    body: Optional[RunScenarioBody] = Body(default=None),
) -> Dict[str, Any]:
    scenario = _find_scenario(scenario_id)

    if driver == "twenty":
        try:
            from agents.twenty_agent import TwentyAgent  # noqa: WPS433 (optional)
        except ImportError as exc:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Twenty driver not available yet. "
                    "Run in driver=engine mode, or complete Step 4 of the plan."
                ),
            ) from exc
        # Agent uses sync httpx and calls back into /api/validate on
        # this same process. Running inline would deadlock the event
        # loop — offload to a thread so the validate call can land.
        import os as _os

        api_key = (body.api_key if body else None) or _os.environ.get("TWENTY_API_KEY", "")
        base_url = (
            (body.base_url if body else None)
            or _os.environ.get("TWENTY_BASE_URL", "http://localhost:3000")
        )
        gateway_url = _os.environ.get("COCO_GATEWAY_URL", "http://localhost:8080")

        if not api_key:
            return {
                "driver": "twenty",
                "scenario_id": scenario_id,
                "error": (
                    "No Twenty API key. Paste one in the dashboard wizard (step 3) "
                    "or set TWENTY_API_KEY on the gateway process."
                ),
                "decision": None,
                "twenty_response": None,
            }

        agent = TwentyAgent(
            twenty_base_url=base_url,
            twenty_api_key=api_key,
            gateway_url=gateway_url,
        )

        def _run_and_close() -> Dict[str, Any]:
            try:
                return agent.run(scenario_id)
            finally:
                agent.close()

        return await asyncio.to_thread(_run_and_close)

    # Engine mode: run the scenario's own ui_state through the gateway.
    engine = request.app.state.engine
    audit = request.app.state.audit_log

    decision = engine.validate(
        pack_id=scenario["pack_id"],
        action=scenario["action"],
        ui_state=scenario.get("ui_state", {}),
        phase=scenario.get("phase", "pre"),
    )

    payload: Dict[str, Any] = {
        "driver": "engine",
        "scenario_id": scenario_id,
        "pack_id": scenario["pack_id"],
        "expected_verdict": scenario.get("expected_verdict"),
        "expected_reason_contains": scenario.get("expected_reason_contains"),
        "ui_state": scenario.get("ui_state", {}),
        "decision": decision.to_dict(),
        "twenty_response": None,
    }

    try:
        audit.insert_decision(payload["decision"])
    except Exception as exc:  # defensive — audit must not break enforcement
        payload["audit_error"] = str(exc)

    return payload
