"""Safe expression DSL for Action Pack constraints.

Rules are Python-like expressions, parsed with ``ast.parse(mode="eval")``
and walked against a whitelist. No ``eval``, no ``Call``, no ``Lambda``,
no dunder access. Variables are top-level names from the UI state dict.

Legal examples:
    deal.amount < 50000 or deal.manager_approved
    email.recipient_count <= 50
    contact.status != "archived"
    not email.has_flagged_recipient
"""

from __future__ import annotations

import ast
from typing import Any, Dict

_ALLOWED_NODES = (
    ast.Expression,
    ast.BoolOp,
    ast.BinOp,
    ast.UnaryOp,
    ast.Compare,
    ast.Name,
    ast.Constant,
    ast.Attribute,
    ast.Subscript,
    ast.Load,
    ast.List,
    ast.Tuple,
    ast.Dict,
)

_ALLOWED_OPS = (
    ast.And,
    ast.Or,
    ast.Not,
    ast.Eq,
    ast.NotEq,
    ast.Lt,
    ast.LtE,
    ast.Gt,
    ast.GtE,
    ast.In,
    ast.NotIn,
    ast.Is,
    ast.IsNot,
    ast.Add,
    ast.Sub,
    ast.Mult,
    ast.Div,
    ast.Mod,
    ast.USub,
    ast.UAdd,
)


class DSLError(ValueError):
    """Raised for any disallowed node, undefined name, or runtime failure."""


class _DictProxy:
    """Wraps a dict so attribute access (``deal.amount``) resolves keys.

    Missing attributes return ``None`` so rules degrade gracefully, matching
    the behavior of ``UIState.get()``.
    """

    __slots__ = ("_d",)

    def __init__(self, d: Any):
        self._d = d if isinstance(d, dict) else {}

    def __getattr__(self, name: str) -> Any:
        if name.startswith("_") or name.startswith("__"):
            raise DSLError(f"Access to '{name}' is not allowed")
        val = self._d.get(name)
        if isinstance(val, dict):
            return _DictProxy(val)
        return val

    def __getitem__(self, key: Any) -> Any:
        val = self._d.get(key) if isinstance(self._d, dict) else None
        if isinstance(val, dict):
            return _DictProxy(val)
        return val

    def __contains__(self, key: Any) -> bool:
        return isinstance(self._d, dict) and key in self._d

    def __eq__(self, other: Any) -> bool:
        if isinstance(other, _DictProxy):
            return self._d == other._d
        return self._d == other

    def __bool__(self) -> bool:
        return bool(self._d)

    def __repr__(self) -> str:
        return f"_DictProxy({self._d!r})"


def _check_ast(node: ast.AST) -> None:
    for child in ast.walk(node):
        if isinstance(child, ast.Name):
            if child.id.startswith("_"):
                raise DSLError(f"Name '{child.id}' is not allowed")
            continue
        if isinstance(child, ast.Attribute):
            if child.attr.startswith("_"):
                raise DSLError(f"Attribute '{child.attr}' is not allowed")
            continue
        if isinstance(child, _ALLOWED_NODES):
            continue
        if isinstance(child, _ALLOWED_OPS):
            continue
        if isinstance(child, (ast.operator, ast.unaryop, ast.cmpop, ast.boolop)):
            if not isinstance(child, _ALLOWED_OPS):
                raise DSLError(
                    f"Operator '{type(child).__name__}' is not allowed"
                )
            continue
        raise DSLError(f"Node '{type(child).__name__}' is not allowed")


def evaluate(rule: str, state: Dict[str, Any]) -> bool:
    """Evaluate a DSL expression against a state dict and return a bool."""
    if not isinstance(rule, str) or not rule.strip():
        raise DSLError("Rule must be a non-empty string")
    try:
        tree = ast.parse(rule, mode="eval")
    except SyntaxError as exc:
        raise DSLError(f"Syntax error: {exc}") from exc

    _check_ast(tree)

    # Build namespace: every top-level state key becomes an available name.
    # YAML-style lowercase literals are injected so pack authors can write
    # natural rules like ``deal.is_sequential_stage_move == true``.
    namespace: Dict[str, Any] = {
        "true": True,
        "false": False,
        "null": None,
        "none": None,
    }
    for key, value in (state or {}).items():
        if isinstance(value, dict):
            namespace[key] = _DictProxy(value)
        else:
            namespace[key] = value

    # Compile and evaluate with empty builtins.
    code = compile(tree, "<dsl>", "eval")
    try:
        result = eval(code, {"__builtins__": {}}, namespace)  # noqa: S307
    except NameError as exc:
        raise DSLError(f"Unknown name: {exc}") from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise DSLError(f"Rule failed: {exc}") from exc

    return bool(result)
