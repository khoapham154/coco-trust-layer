"""GatewayEngine — runs a pack against a UI state and returns a decision."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Literal

from engine.decision import CheckResult, GatewayDecision, Verdict
from engine.dsl import DSLError, evaluate
from engine.pack_schema import (
    AgentActionPack,
    CheckType,
    Constraint,
    PostCondition,
    PreCondition,
)
from engine.ui_state import UIState


Phase = Literal["pre", "post"]


def _compare(check_type: CheckType, observed: Any, expected: Any) -> bool:
    if check_type is CheckType.EXISTS:
        return observed is not None
    if check_type is CheckType.NOT_EMPTY:
        if observed is None:
            return False
        if isinstance(observed, (str, list, tuple, dict)):
            return len(observed) > 0
        return True
    if check_type is CheckType.EQUALS:
        return observed == expected
    if check_type is CheckType.NOT_EQUALS:
        return observed != expected
    if check_type is CheckType.GREATER_THAN:
        return observed is not None and observed > expected
    if check_type is CheckType.LESS_THAN:
        return observed is not None and observed < expected
    if check_type is CheckType.GTE:
        return observed is not None and observed >= expected
    if check_type is CheckType.LTE:
        return observed is not None and observed <= expected
    if check_type is CheckType.IN_LIST:
        return isinstance(expected, (list, tuple)) and observed in expected
    if check_type is CheckType.NOT_IN_LIST:
        return isinstance(expected, (list, tuple)) and observed not in expected
    if check_type is CheckType.MATCHES_REGEX:
        return isinstance(observed, str) and re.search(str(expected), observed) is not None
    return False


def _run_check(
    kind: str,
    check: PreCondition | PostCondition,
    state: UIState,
) -> CheckResult:
    observed = state.get(check.path)
    passed = _compare(check.type, observed, check.value)
    return CheckResult(
        check_id=check.id,
        kind=kind,
        passed=passed,
        reason=check.reason if not passed else "ok",
        observed=observed,
    )


def _run_constraint(
    constraint: Constraint,
    state_dict: Dict[str, Any],
) -> CheckResult:
    try:
        passed = evaluate(constraint.rule, state_dict)
        return CheckResult(
            check_id=constraint.id,
            kind="constraint",
            passed=bool(passed),
            reason=constraint.reason if not passed else "ok",
            observed=None,
        )
    except DSLError as exc:
        return CheckResult(
            check_id=constraint.id,
            kind="constraint",
            passed=False,
            reason=f"DSL error: {exc}",
            observed=None,
        )


class GatewayEngine:
    """Runtime that validates an agent action against a loaded pack."""

    def __init__(self, packs: Dict[str, AgentActionPack]):
        self.packs = packs

    def validate(
        self,
        pack_id: str,
        action: str,
        ui_state: Dict[str, Any],
        phase: Phase = "pre",
    ) -> GatewayDecision:
        pack = self.packs.get(pack_id)
        if pack is None:
            return GatewayDecision.fail(
                verdict=Verdict.BLOCK,
                pack_id=pack_id,
                action=action,
                phase=phase,
                primary_reason=f"unknown_pack: {pack_id}",
                checks=[],
            )

        state = UIState.from_dict(ui_state or {})
        state_dict = state.to_dict()
        checks: List[CheckResult] = []

        # 1. Pre- or post-conditions depending on phase
        condition_list: List[PreCondition | PostCondition]
        if phase == "post":
            condition_list = list(pack.post_conditions)
            kind_label = "post"
        else:
            condition_list = list(pack.pre_conditions)
            kind_label = "pre"

        for cond in condition_list:
            result = _run_check(kind_label, cond, state)
            checks.append(result)
            if not result.passed:
                return GatewayDecision.fail(
                    verdict=cond.on_fail,
                    pack_id=pack_id,
                    action=action,
                    phase=phase,
                    primary_reason=cond.reason,
                    checks=checks,
                )

        # 2. Constraints (only during pre phase; post is for silent failure)
        if phase == "pre":
            for constraint in pack.constraints:
                result = _run_constraint(constraint, state_dict)
                checks.append(result)
                if not result.passed:
                    return GatewayDecision.fail(
                        verdict=constraint.on_fail,
                        pack_id=pack_id,
                        action=action,
                        phase=phase,
                        primary_reason=constraint.reason,
                        checks=checks,
                    )

        # 3. All good
        return GatewayDecision.allow(
            pack_id=pack_id,
            action=action,
            phase=phase,
            checks=checks,
        )
