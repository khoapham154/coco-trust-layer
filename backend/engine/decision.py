"""Verdict types and gateway decision record."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, List, Optional

from pydantic import BaseModel, Field


class Verdict(str, Enum):
    ALLOW = "ALLOW"
    BLOCK = "BLOCK"
    ESCALATE = "ESCALATE"


class CheckResult(BaseModel):
    check_id: str
    kind: str  # "pre", "constraint", "post"
    passed: bool
    reason: str
    observed: Any = None


class GatewayDecision(BaseModel):
    verdict: Verdict
    pack_id: str
    action: str
    phase: str
    primary_reason: str
    checks: List[CheckResult] = Field(default_factory=list)
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    @classmethod
    def allow(
        cls,
        pack_id: str,
        action: str,
        phase: str,
        checks: List[CheckResult],
    ) -> "GatewayDecision":
        return cls(
            verdict=Verdict.ALLOW,
            pack_id=pack_id,
            action=action,
            phase=phase,
            primary_reason="All checks passed",
            checks=checks,
        )

    @classmethod
    def fail(
        cls,
        verdict: Verdict,
        pack_id: str,
        action: str,
        phase: str,
        primary_reason: str,
        checks: List[CheckResult],
    ) -> "GatewayDecision":
        return cls(
            verdict=verdict,
            pack_id=pack_id,
            action=action,
            phase=phase,
            primary_reason=primary_reason,
            checks=checks,
        )

    def to_dict(self) -> dict:
        return self.model_dump(mode="json")
