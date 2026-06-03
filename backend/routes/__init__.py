from routes.audit import router as audit_router
from routes.audit_advanced import router as audit_advanced_router
from routes.dashboard import router as dashboard_router
from routes.demo import router as demo_router
from routes.demo_bank import router as demo_bank_router
from routes.escalations import router as escalations_router
from routes.metrics import router as metrics_router
from routes.mock_obp import router as mock_obp_router
from routes.packs import router as packs_router
from routes.packs_yaml import router as packs_yaml_router
from routes.scenarios import router as scenarios_router
from routes.twenty_ops import router as twenty_ops_router
from routes.validate import router as validate_router

__all__ = [
    "audit_router",
    "audit_advanced_router",
    "dashboard_router",
    "demo_router",
    "demo_bank_router",
    "escalations_router",
    "metrics_router",
    "mock_obp_router",
    "packs_router",
    "packs_yaml_router",
    "scenarios_router",
    "twenty_ops_router",
    "validate_router",
]
