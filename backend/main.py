"""CoCo Trust Layer Gateway — FastAPI entrypoint."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any, Dict

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from db import AuditLog
from engine import AgentActionPack, GatewayEngine
from routes import audit_router, packs_router, validate_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("coco.gateway")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Loading packs from %s", settings.pack_dir)
    packs = AgentActionPack.load_all(settings.pack_dir)
    log.info("Loaded %d packs: %s", len(packs), ", ".join(sorted(packs.keys())))
    app.state.engine = GatewayEngine(packs)
    app.state.audit_log = AuditLog(settings.db_path)
    log.info("Audit log at %s", settings.db_path)
    yield
    log.info("Gateway shutdown")


app = FastAPI(
    title="CoCo Trust Layer Gateway",
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
app.include_router(audit_router)


@app.get("/health")
async def health() -> Dict[str, Any]:
    packs_loaded = len(getattr(app.state, "engine", GatewayEngine({})).packs)
    return {"status": "ok", "packs_loaded": packs_loaded}


@app.get("/")
async def root() -> Dict[str, Any]:
    return {
        "name": "CoCo Trust Layer Gateway",
        "version": "0.1.0",
        "endpoints": [
            "POST /api/validate",
            "GET /api/packs",
            "GET /api/packs/{pack_id}",
            "GET /api/audit",
            "GET /health",
        ],
    }
