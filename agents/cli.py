"""CLI entrypoint for the Twenty agent.

    python -m agents.cli --scenario deal_stage_move_allow
    python -m agents.cli --scenario deal_stage_move_block_no_owner --gateway-url http://localhost:8080

Writes the full trace as JSON to stdout. Non-zero exit status when
the agent couldn't even reach Twenty or the gateway.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

# Ensure `backend/` (and therefore `providers`) is importable when
# running as `python -m agents.cli` from the repo root.
_REPO_ROOT = Path(__file__).resolve().parent.parent
_BACKEND = _REPO_ROOT / "backend"
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from agents.twenty_agent import TwentyAgent  # noqa: E402  (sys.path setup)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("coco.agents.cli")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Drive a CoCo scenario against live Twenty.")
    p.add_argument("--scenario", required=True, help="Scenario ID (file stem under data/twenty/scenarios)")
    p.add_argument(
        "--twenty-url",
        default=os.environ.get("TWENTY_BASE_URL", "http://localhost:3000"),
    )
    p.add_argument(
        "--twenty-key",
        default=os.environ.get("TWENTY_API_KEY", ""),
    )
    p.add_argument(
        "--gateway-url",
        default=os.environ.get("COCO_GATEWAY_URL", "http://localhost:8080"),
    )
    p.add_argument(
        "--require-api-key",
        action="store_true",
        help="Fail if --twenty-key is empty (useful in CI).",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    if args.require_api_key and not args.twenty_key:
        log.error("No TWENTY_API_KEY set — pass --twenty-key or export the env var.")
        return 2

    agent = TwentyAgent(
        twenty_base_url=args.twenty_url,
        twenty_api_key=args.twenty_key,
        gateway_url=args.gateway_url,
    )
    try:
        trace = agent.run(args.scenario)
    finally:
        agent.close()

    json.dump(trace, sys.stdout, indent=2, default=str)
    sys.stdout.write("\n")

    decision = trace.get("decision") or {}
    expected = trace.get("expected_verdict")
    actual = decision.get("verdict")
    if expected and actual and expected != actual:
        log.warning("Verdict mismatch: expected %s, got %s", expected, actual)
        return 1
    if trace.get("error"):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
