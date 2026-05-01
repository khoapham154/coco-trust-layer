from routes.audit import router as audit_router
from routes.dashboard import router as dashboard_router
from routes.demo import router as demo_router
from routes.packs import router as packs_router
from routes.scenarios import router as scenarios_router
from routes.twenty_ops import router as twenty_ops_router
from routes.validate import router as validate_router

__all__ = [
    "audit_router",
    "dashboard_router",
    "demo_router",
    "packs_router",
    "scenarios_router",
    "twenty_ops_router",
    "validate_router",
]
