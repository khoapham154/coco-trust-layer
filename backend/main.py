"""Coco Trust Layer Gateway — FastAPI entrypoint."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import settings
from db import AuditLog
from engine import AgentActionPack, GatewayEngine
from routes import (
    audit_advanced_router,
    audit_router,
    dashboard_router,
    demo_bank_router,
    demo_router,
    escalations_router,
    metrics_router,
    mock_obp_router,
    packs_router,
    packs_yaml_router,
    scenarios_router,
    twenty_ops_router,
    validate_router,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("coco.gateway")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Loading packs from %s", ", ".join(str(d) for d in settings.pack_dirs))
    packs = AgentActionPack.load_all_dirs(settings.pack_dirs)
    log.info("Loaded %d packs: %s", len(packs), ", ".join(sorted(packs.keys())))
    app.state.engine = GatewayEngine(packs)
    app.state.audit_log = AuditLog(settings.db_path)
    log.info("Audit log at %s", settings.db_path)
    yield
    log.info("Gateway shutdown")


app = FastAPI(
    title="Coco Trust Layer Gateway",
    description=(
        "Runtime governance between AI agents and enterprise SaaS. "
        "Validates agent actions against Action Packs (YAML behavioral contracts)."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(validate_router)
app.include_router(packs_router)
app.include_router(packs_yaml_router)
app.include_router(audit_router)
app.include_router(audit_advanced_router)
app.include_router(scenarios_router)
app.include_router(metrics_router)
app.include_router(escalations_router)
app.include_router(twenty_ops_router)
app.include_router(demo_router)
app.include_router(demo_bank_router)
app.include_router(mock_obp_router)
app.include_router(dashboard_router)

_STATIC_DIR = Path(__file__).resolve().parent / "dashboard" / "static"
if _STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=_STATIC_DIR), name="static")
else:  # pragma: no cover - only hit if the dashboard assets are missing
    log.warning("Dashboard static dir missing: %s", _STATIC_DIR)


@app.get("/health")
async def health() -> Dict[str, Any]:
    packs_loaded = len(getattr(app.state, "engine", GatewayEngine({})).packs)
    return {"status": "ok", "packs_loaded": packs_loaded}


@app.get("/")
async def root() -> Dict[str, Any]:
    return {
        "name": "Coco Trust Layer Gateway",
        "version": "0.1.0",
        "endpoints": [
            "POST /api/validate",
            "GET /api/packs",
            "GET /api/packs/{pack_id}",
            "GET /api/audit",
            "GET /api/scenarios",
            "POST /api/scenarios/{id}/run",
            "GET /api/demo/state",
            "POST /api/demo/reset",
            "POST /api/demo/agent-runs",
            "POST /api/demo/escalate",
            "GET /dashboard",
            "GET /sdk/coco-sdk.js",
            "GET /health",
        ],
    }
