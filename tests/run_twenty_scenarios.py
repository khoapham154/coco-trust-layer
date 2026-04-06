#!/usr/bin/env python3
"""End-to-end scenario runner for CoCo Trust Layer.

Iterates every JSON file in ``data/twenty/scenarios/`` and posts it to the
gateway. By default it uses the in-process ASGI client (no server needed).
Pass ``--base-url http://localhost:8080`` to point at a running instance
(e.g. the Docker container) instead.

Exit code 0 on all pass, 1 on any failure.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = REPO_ROOT / "backend"
SCENARIO_DIR = REPO_ROOT / "data" / "twenty" / "scenarios"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
DIM = "\033[2m"
RESET = "\033[0m"


def load_scenarios() -> list[dict]:
    files = sorted(SCENARIO_DIR.glob("*.json"))
    scenarios = []
    for path in files:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        data["_path"] = str(path.relative_to(REPO_ROOT))
        scenarios.append(data)
    return scenarios


async def run_asgi(scenarios: list[dict]) -> int:
    """Run via in-process ASGI client (no server)."""
    os.environ.setdefault("COCO_DB_PATH", "/tmp/coco_scenario_runner.db")

    import httpx
    from httpx import ASGITransport

    from main import app

    passes = 0
    fails = 0
    transport = ASGITransport(app=app)
    # Manually enter the FastAPI lifespan so ``app.state.engine`` is populated.
    # httpx.ASGITransport does not trigger lifespan events on its own.
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            for scenario in scenarios:
                ok, msg = await run_one(client, scenario)
                if ok:
                    passes += 1
                    print(f"{GREEN}PASS{RESET} {scenario['scenario_name']}")
                else:
                    fails += 1
                    print(f"{RED}FAIL{RESET} {scenario['scenario_name']}: {msg}")
    return _summary(passes, fails)


async def run_live(scenarios: list[dict], base_url: str) -> int:
    import httpx

    passes = 0
    fails = 0
    async with httpx.AsyncClient(base_url=base_url) as client:
        try:
            health = await client.get("/health")
            health.raise_for_status()
        except Exception as exc:
            print(f"{RED}Cannot reach {base_url}/health: {exc}{RESET}")
            return 1

        for scenario in scenarios:
            ok, msg = await run_one(client, scenario)
            if ok:
                passes += 1
                print(f"{GREEN}PASS{RESET} {scenario['scenario_name']}")
            else:
                fails += 1
                print(f"{RED}FAIL{RESET} {scenario['scenario_name']}: {msg}")
    return _summary(passes, fails)


async def run_one(client, scenario: dict) -> tuple[bool, str]:
    body = {
        "pack_id": scenario["pack_id"],
        "action": scenario["action"],
        "phase": scenario.get("phase", "pre"),
        "ui_state": scenario.get("ui_state", {}),
    }
    try:
        res = await client.post("/api/validate", json=body)
    except Exception as exc:
        return False, f"request error: {exc}"

    if res.status_code != 200:
        return False, f"status {res.status_code}: {res.text[:200]}"

    data = res.json()
    verdict = data.get("verdict")
    reason = data.get("primary_reason", "")
    if verdict != scenario["expected_verdict"]:
        return False, (
            f"verdict mismatch: expected {scenario['expected_verdict']} "
            f"got {verdict} (reason: {reason})"
        )
    expected_substr = scenario.get("expected_reason_contains", "")
    if expected_substr and expected_substr.lower() not in reason.lower():
        return False, (
            f"reason mismatch: expected substring '{expected_substr}' "
            f"in '{reason}'"
        )
    return True, ""


def _summary(passes: int, fails: int) -> int:
    total = passes + fails
    print()
    if fails == 0:
        print(f"{GREEN}{passes}/{total} scenarios passed{RESET}")
        return 0
    print(f"{RED}{fails}/{total} scenarios FAILED{RESET} ({passes} passed)")
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="CoCo scenario runner")
    parser.add_argument(
        "--base-url",
        default=None,
        help="Live gateway URL (e.g. http://localhost:8080). "
        "If omitted, runs in-process via ASGI TestClient.",
    )
    args = parser.parse_args()

    scenarios = load_scenarios()
    if not scenarios:
        print(f"{RED}No scenarios found in {SCENARIO_DIR}{RESET}")
        return 1

    print(f"{DIM}Running {len(scenarios)} scenarios from {SCENARIO_DIR}{RESET}")
    print(
        f"{DIM}Mode: {'live (' + args.base_url + ')' if args.base_url else 'ASGI in-process'}{RESET}"
    )
    print()

    if args.base_url:
        return asyncio.run(run_live(scenarios, args.base_url))
    return asyncio.run(run_asgi(scenarios))


if __name__ == "__main__":
    sys.exit(main())
