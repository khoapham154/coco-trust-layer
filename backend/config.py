"""Env-driven config for the gateway service."""

from __future__ import annotations

import os
from pathlib import Path


def _default_pack_dir() -> Path:
    env = os.environ.get("COCO_PACK_DIR")
    if env:
        return Path(env)
    here = Path(__file__).resolve().parent
    repo_root = here.parent
    return repo_root / "data" / "twenty" / "packs"


def _banking_pack_dir() -> Path:
    here = Path(__file__).resolve().parent
    repo_root = here.parent
    return repo_root / "data" / "banking" / "packs"


def _pack_dirs() -> tuple:
    """Every pack directory loaded at startup.

    The primary dir (COCO_PACK_DIR or the Twenty default) plus the bundled
    banking packs, so one gateway serves both the CRM governance packs and
    the banking demo. Deduped by resolved path; missing dirs are skipped.
    Returned as a tuple so the shared Settings attribute stays immutable.
    """
    out: list = []
    for d in (_default_pack_dir(), _banking_pack_dir()):
        if d.exists() and all(d.resolve() != e.resolve() for e in out):
            out.append(d)
    return tuple(out)


def _default_db_path() -> Path:
    env = os.environ.get("COCO_DB_PATH")
    if env:
        return Path(env)
    here = Path(__file__).resolve().parent
    repo_root = here.parent
    return repo_root / "data" / "runtime" / "audit.db"


def _bool_env(key: str, default: bool = False) -> bool:
    raw = os.environ.get(key)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


class Settings:
    pack_dir: Path = _default_pack_dir()
    pack_dirs: tuple = _pack_dirs()
    db_path: Path = _default_db_path()
    port: int = int(os.environ.get("COCO_PORT", "8080"))
    cors_origins: list = ["*"]
    allow_demo_reset: bool = _bool_env("COCO_ALLOW_DEMO_RESET", False)
    demo_mode: bool = _bool_env("COCO_DEMO_MODE", False)


settings = Settings()
