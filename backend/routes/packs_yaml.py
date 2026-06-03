"""Pack YAML read + write + version history.

The source-of-truth pack files live in data/twenty/packs/<pack_id>.yaml.
On write, we snapshot the current file to
data/twenty/packs/_versions/<pack_id>/<timestamp>.yaml so the operator
can see history and revert.

After a successful write, the engine is reloaded so the new policy
applies to the next verdict immediately. Validation happens before the
write — invalid YAML is rejected with the parser error.
"""

from __future__ import annotations

import datetime as dt
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from config import settings
from engine import AgentActionPack, GatewayEngine

log = logging.getLogger("coco.routes.packs_yaml")
router = APIRouter()


def _resolve(pack_id: str):
    """Find a pack file and its owning directory across all pack dirs.

    Packs load from several directories (Twenty + banking), so edits and
    version snapshots must target the directory the file actually lives in,
    not just the primary one. Skips version snapshots, same as load_all.
    Returns ``(file, dir)`` or ``(None, None)`` if no pack matches.
    """
    for pdir in settings.pack_dirs:
        pdir = Path(pdir)
        if not pdir.exists():
            continue
        for f in sorted(pdir.glob("*.yaml")):
            if any(part.startswith("_") for part in f.relative_to(pdir).parts):
                continue
            try:
                if AgentActionPack.from_yaml_file(f).id == pack_id:
                    return f, pdir
            except Exception:
                continue
    return None, None


def _file_for(pack_id: str) -> Path:
    path, _ = _resolve(pack_id)
    if path is None:
        raise HTTPException(status_code=404, detail=f"Pack not found: {pack_id}")
    return path


def _versions_base(pack_id: str) -> Path:
    _, pdir = _resolve(pack_id)
    return (pdir or Path(settings.pack_dir)) / "_versions" / pack_id


def _versions_dir(pack_id: str) -> Path:
    base = _versions_base(pack_id)
    base.mkdir(parents=True, exist_ok=True)
    return base


@router.get("/api/packs/{pack_id}/yaml", response_class=PlainTextResponse)
async def get_pack_yaml(pack_id: str) -> str:
    path = _file_for(pack_id)
    return path.read_text(encoding="utf-8")


class RevertBody(BaseModel):
    version: str


@router.put("/api/packs/{pack_id}/yaml", response_class=PlainTextResponse)
async def put_pack_yaml(request: Request, pack_id: str) -> str:
    body = (await request.body()).decode("utf-8")
    path = _file_for(pack_id)

    # Validate before writing.
    try:
        AgentActionPack.from_yaml_text(body, source_name=str(path))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"YAML invalid: {exc}")

    # Snapshot current version first.
    ts = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    snap = _versions_dir(pack_id) / f"{ts}.yaml"
    snap.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")

    path.write_text(body, encoding="utf-8")

    # Reload the engine in-place so the new policy applies immediately.
    try:
        packs = AgentActionPack.load_all_dirs(settings.pack_dirs)
        request.app.state.engine = GatewayEngine(packs)
        log.info("Reloaded engine after edit to %s (snapshot %s)", pack_id, snap.name)
    except Exception as exc:
        log.warning("Engine reload after pack edit failed: %s", exc)

    return body


@router.get("/api/packs/{pack_id}/versions")
async def list_versions(pack_id: str) -> List[Dict[str, Any]]:
    base = _versions_base(pack_id)
    if not base.exists():
        return [{"version": "current", "label": "current", "timestamp": None}]
    out: List[Dict[str, Any]] = []
    for f in sorted(base.glob("*.yaml"), reverse=True):
        out.append({
            "version": f.stem,
            "label": f.stem,
            "timestamp": f.stem,
        })
    out.append({"version": "current", "label": "current", "timestamp": None})
    return out


@router.post("/api/packs/{pack_id}/revert")
async def revert_pack(request: Request, pack_id: str, body: RevertBody) -> Dict[str, Any]:
    base = _versions_base(pack_id)
    snap = base / f"{body.version}.yaml"
    if not snap.exists():
        raise HTTPException(status_code=404, detail=f"Version {body.version} not found.")
    path = _file_for(pack_id)
    # Snapshot current before revert.
    ts = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    pre = base / f"{ts}.yaml"
    pre.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
    path.write_text(snap.read_text(encoding="utf-8"), encoding="utf-8")
    try:
        packs = AgentActionPack.load_all_dirs(settings.pack_dirs)
        request.app.state.engine = GatewayEngine(packs)
    except Exception as exc:
        log.warning("Engine reload after revert failed: %s", exc)
    return {"pack_id": pack_id, "reverted_to": body.version, "pre_revert_snapshot": ts}
