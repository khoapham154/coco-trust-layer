"""Pydantic schema for Agent Action Packs + YAML loader."""

from __future__ import annotations

from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml
from pydantic import BaseModel, Field, field_validator

from engine.decision import Verdict


class CheckType(str, Enum):
    EXISTS = "exists"
    NOT_EMPTY = "not_empty"
    EQUALS = "equals"
    NOT_EQUALS = "not_equals"
    GREATER_THAN = "greater_than"
    LESS_THAN = "less_than"
    GTE = "gte"
    LTE = "lte"
    IN_LIST = "in_list"
    NOT_IN_LIST = "not_in_list"
    MATCHES_REGEX = "matches_regex"


class PreCondition(BaseModel):
    id: str
    type: CheckType
    path: str
    value: Optional[Any] = None
    on_fail: Verdict = Verdict.BLOCK
    reason: str


class Constraint(BaseModel):
    id: str
    rule: str
    on_fail: Verdict = Verdict.BLOCK
    reason: str


class PostCondition(BaseModel):
    id: str
    type: CheckType
    path: str
    value: Optional[Any] = None
    on_fail: Verdict = Verdict.BLOCK
    reason: str


class AgentActionPack(BaseModel):
    id: str
    action: str
    description: str
    pre_conditions: List[PreCondition] = Field(default_factory=list)
    constraints: List[Constraint] = Field(default_factory=list)
    post_conditions: List[PostCondition] = Field(default_factory=list)

    @field_validator("id")
    @classmethod
    def _id_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("pack id cannot be empty")
        return v

    @classmethod
    def from_yaml_file(cls, path: Path) -> "AgentActionPack":
        with open(path, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f)
        if not isinstance(raw, dict):
            raise ValueError(f"Pack file {path} must contain a YAML mapping")
        return cls.model_validate(raw)

    @classmethod
    def from_yaml_text(cls, text: str, source_name: str = "<text>") -> "AgentActionPack":
        raw = yaml.safe_load(text)
        if not isinstance(raw, dict):
            raise ValueError(f"Pack source {source_name} must be a YAML mapping")
        return cls.model_validate(raw)

    @classmethod
    def load_all(cls, pack_dir: Path) -> Dict[str, "AgentActionPack"]:
        pack_dir = Path(pack_dir)
        if not pack_dir.exists():
            raise FileNotFoundError(f"Pack directory not found: {pack_dir}")
        out: Dict[str, AgentActionPack] = {}
        for yaml_file in sorted(pack_dir.glob("*.yaml")):
            # Skip version snapshots — they live in subdirs prefixed with
            # underscore (e.g. _versions/). Top-level files only.
            if any(part.startswith("_") for part in yaml_file.relative_to(pack_dir).parts):
                continue
            pack = cls.from_yaml_file(yaml_file)
            if pack.id in out:
                raise ValueError(f"Duplicate pack id: {pack.id}")
            out[pack.id] = pack
        return out

    @classmethod
    def load_all_dirs(cls, pack_dirs) -> Dict[str, "AgentActionPack"]:
        """Load and merge packs from several directories. Ids stay unique."""
        out: Dict[str, AgentActionPack] = {}
        for pack_dir in pack_dirs:
            if not Path(pack_dir).exists():
                continue
            for pid, pack in cls.load_all(pack_dir).items():
                if pid in out:
                    raise ValueError(f"Duplicate pack id across dirs: {pid}")
                out[pid] = pack
        return out

    def check_count(self) -> int:
        return (
            len(self.pre_conditions)
            + len(self.constraints)
            + len(self.post_conditions)
        )
