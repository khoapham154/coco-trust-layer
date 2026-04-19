"""Twenty onboarding-wizard backend endpoints.

Two endpoints power the dashboard wizard in
``backend/dashboard/static/wizard.js``:

  * ``POST /api/twenty/test-connection`` — probes a Twenty REST endpoint
    with the submitted API key and returns whether it worked plus a
    workspace hint. The key is used per-request only; the server never
    stores or logs it.
  * ``POST /api/twenty/seed`` — runs ``scripts/seed_twenty.py`` as a
    subprocess with the submitted API key in the env. Gated behind
    ``COCO_ALLOW_WIZARD_EXEC=1`` so it cannot be invoked by accident in
    a non-dev environment.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

log = logging.getLogger("coco.twenty_ops")

router = APIRouter(prefix="/api/twenty", tags=["twenty"])

_DEFAULT_TWENTY_BASE_URL = os.environ.get("TWENTY_BASE_URL", "http://localhost:3000")
_TEST_TIMEOUT_S = 8.0
_SEED_TIMEOUT_S = 90.0


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


class TestConnectionRequest(BaseModel):
    api_key: str = Field(..., min_length=4, description="Twenty personal access token")
    base_url: Optional[str] = Field(default=None, description="Override Twenty base URL")


class TestConnectionResponse(BaseModel):
    ok: bool
    workspace_name: Optional[str] = None
    status_code: Optional[int] = None
    error: Optional[str] = None
    base_url: str


class SeedRequest(BaseModel):
    api_key: str = Field(..., min_length=4)
    base_url: Optional[str] = None


class SeedResponse(BaseModel):
    ok: bool
    counts: Dict[str, int]
    log_tail: str
    fixtures_path: Optional[str] = None
    error: Optional[str] = None


@router.post("/test-connection", response_model=TestConnectionResponse)
async def test_connection(req: TestConnectionRequest) -> TestConnectionResponse:
    """Probe Twenty for a valid API key by listing one company row.

    Twenty's REST API exposes ``/rest/companies?limit=1`` which any
    authenticated token can read. Using that instead of the deeper
    ``/rest/workspaces`` endpoint avoids workspace-admin requirements
    and matches how the Python agent reads state.
    """

    base_url = (req.base_url or _DEFAULT_TWENTY_BASE_URL).rstrip("/")
    headers = {"Authorization": f"Bearer {req.api_key}", "Accept": "application/json"}

    try:
        async with httpx.AsyncClient(timeout=_TEST_TIMEOUT_S) as client:
            resp = await client.get(f"{base_url}/rest/companies", params={"limit": 1}, headers=headers)
    except httpx.ConnectError as exc:
        return TestConnectionResponse(
            ok=False,
            base_url=base_url,
            error=f"Could not reach Twenty at {base_url}: {exc}",
        )
    except httpx.TimeoutException:
        return TestConnectionResponse(
            ok=False,
            base_url=base_url,
            error=f"Twenty at {base_url} did not respond within {_TEST_TIMEOUT_S:.0f}s",
        )
    except httpx.HTTPError as exc:
        return TestConnectionResponse(ok=False, base_url=base_url, error=f"HTTP error: {exc}")

    if resp.status_code == 401:
        return TestConnectionResponse(
            ok=False,
            base_url=base_url,
            status_code=401,
            error="Twenty rejected the API key (401). Regenerate in Settings → Developers.",
        )
    if resp.status_code >= 400:
        return TestConnectionResponse(
            ok=False,
            base_url=base_url,
            status_code=resp.status_code,
            error=f"Twenty returned {resp.status_code}: {resp.text[:200]}",
        )

    workspace_hint: Optional[str] = None
    try:
        payload = resp.json()
        companies = payload.get("data", {}).get("companies") or []
        if companies:
            workspace_hint = f"{len(companies)} company reachable"
    except ValueError:
        pass

    return TestConnectionResponse(
        ok=True,
        base_url=base_url,
        status_code=resp.status_code,
        workspace_name=workspace_hint or "Twenty reachable",
    )


def _parse_seed_counts(stdout: str) -> Dict[str, int]:
    """Count 'created' / 'exists' lines from seed_twenty.py stdout."""
    counts: Dict[str, int] = {"companies": 0, "people": 0, "opportunities": 0}
    patterns = {
        "companies": r"(?:created|exists):\s*company\b",
        "people": r"(?:created|exists):\s*person\b",
        "opportunities": r"(?:created|exists):\s*opportunity\b",
    }
    for key, pat in patterns.items():
        counts[key] = len(re.findall(pat, stdout))
    return counts


@router.post("/seed", response_model=SeedResponse)
async def seed_twenty(req: SeedRequest) -> SeedResponse:
    """Run ``scripts/seed_twenty.py`` as a subprocess with the submitted key.

    This endpoint is dev-only and guarded by ``COCO_ALLOW_WIZARD_EXEC=1``
    so the wizard cannot trigger process spawns unless the operator has
    opted in.
    """

    if os.environ.get("COCO_ALLOW_WIZARD_EXEC") != "1":
        raise HTTPException(
            status_code=403,
            detail=(
                "Seed endpoint disabled. Set COCO_ALLOW_WIZARD_EXEC=1 on the "
                "gateway process to allow the wizard to run seed_twenty.py."
            ),
        )

    repo_root = _repo_root()
    script_path = repo_root / "scripts" / "seed_twenty.py"
    if not script_path.exists():
        raise HTTPException(status_code=500, detail=f"seed script missing at {script_path}")

    env = os.environ.copy()
    env["TWENTY_API_KEY"] = req.api_key
    if req.base_url:
        env["TWENTY_BASE_URL"] = req.base_url.rstrip("/")
    env["PYTHONPATH"] = str(repo_root)

    fixtures_path = repo_root / "data" / "twenty" / "fixtures" / "seeded.json"

    try:
        proc = await asyncio.create_subprocess_exec(
            "python",
            str(script_path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=env,
            cwd=str(repo_root),
        )
        try:
            stdout_bytes, _ = await asyncio.wait_for(proc.communicate(), timeout=_SEED_TIMEOUT_S)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return SeedResponse(
                ok=False,
                counts={"companies": 0, "people": 0, "opportunities": 0},
                log_tail="seed_twenty.py timed out",
                error=f"Seed exceeded {_SEED_TIMEOUT_S:.0f}s",
            )
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="python interpreter not found on PATH")

    stdout = stdout_bytes.decode("utf-8", errors="replace") if stdout_bytes else ""
    tail = "\n".join(stdout.splitlines()[-40:])

    if proc.returncode != 0:
        return SeedResponse(
            ok=False,
            counts=_parse_seed_counts(stdout),
            log_tail=tail,
            error=f"seed_twenty.py exited with code {proc.returncode}",
        )

    counts = _parse_seed_counts(stdout)
    fixtures_written: Optional[str] = None
    if fixtures_path.exists():
        try:
            data = json.loads(fixtures_path.read_text())
            counts.setdefault("companies", 0)
            counts.setdefault("people", 0)
            counts.setdefault("opportunities", 0)
            if isinstance(data, dict):
                counts["companies"] = max(counts["companies"], len(data.get("companies", [])))
                counts["people"] = max(counts["people"], len(data.get("people", [])))
                counts["opportunities"] = max(counts["opportunities"], len(data.get("opportunities", [])))
            fixtures_written = str(fixtures_path.relative_to(repo_root))
        except (OSError, json.JSONDecodeError) as exc:
            log.warning("Could not parse fixtures file: %s", exc)

    return SeedResponse(ok=True, counts=counts, log_tail=tail, fixtures_path=fixtures_written)
