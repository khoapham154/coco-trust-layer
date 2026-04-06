"""UIState — dict-backed view of the agent's target SaaS with path lookup."""

from __future__ import annotations

import re
from typing import Any, Dict, Optional

_BRACKET = re.compile(r"\[(\d+)\]")


class UIState:
    """Thin wrapper around the JSON state captured from the target app.

    Supports dot paths and bracket indices for lookup:

        state.get("deal.amount")
        state.get("email.recipients[0].email")

    Returns None for any missing segment; never raises.
    """

    def __init__(self, data: Optional[Dict[str, Any]] = None):
        self._data: Dict[str, Any] = data or {}

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "UIState":
        return cls(data)

    def to_dict(self) -> Dict[str, Any]:
        return self._data

    def get(self, path: str) -> Any:
        if not path:
            return None
        cur: Any = self._data
        for raw_segment in path.split("."):
            if cur is None:
                return None
            # Split "recipients[0]" into "recipients" + [0]
            name = _BRACKET.sub("", raw_segment)
            indices = [int(m.group(1)) for m in _BRACKET.finditer(raw_segment)]
            if name:
                if not isinstance(cur, dict):
                    return None
                cur = cur.get(name)
            for idx in indices:
                if cur is None:
                    return None
                if not isinstance(cur, (list, tuple)) or idx >= len(cur):
                    return None
                cur = cur[idx]
        return cur

    def has(self, path: str) -> bool:
        return self.get(path) is not None
