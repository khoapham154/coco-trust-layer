"""CoCo Trust Layer — gateway engine.

Runtime validation of AI agent actions against behavioral contracts
defined as Agent Action Packs (YAML). Deterministic, <50ms per request,
no LLM dependency.
"""

from engine.decision import CheckResult, GatewayDecision, Verdict
from engine.dsl import DSLError, evaluate
from engine.gateway import GatewayEngine
from engine.pack_schema import (
    AgentActionPack,
    CheckType,
    Constraint,
    PostCondition,
    PreCondition,
)
from engine.ui_state import UIState

__all__ = [
    "AgentActionPack",
    "CheckResult",
    "CheckType",
    "Constraint",
    "DSLError",
    "GatewayDecision",
    "GatewayEngine",
    "PostCondition",
    "PreCondition",
    "UIState",
    "Verdict",
    "evaluate",
]
