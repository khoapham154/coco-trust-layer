"""Env-driven config for the gateway service."""

from __future__ import annotations

import os
from pathlib import Path


def _default_pack_dir() -> Path:
    # In Docker the packs are mounted at /app/packs/twenty/packs.
    # In local dev we resolve relative to repo root.
    env = os.environ.get("COCO_PACK_DIR")
    if env:
        return Path(env)
    here = Path(__file__).resolve().parent
    repo_root = here.parent  # coco-trust-layer/
    return repo_root / "data" / "twenty" / "packs"


def _default_db_path() -> Path:
    env = os.environ.get("COCO_DB_PATH")
    if env:
        return Path(env)
    here = Path(__file__).resolve().parent
    repo_root = here.parent
    return repo_root / "data" / "runtime" / "audit.db"


class Settings:
    pack_dir: Path = _default_pack_dir()
    db_path: Path = _default_db_path()
    port: int = int(os.environ.get("COCO_PORT", "8080"))
    cors_origins: list = ["*"]


settings = Settings()
