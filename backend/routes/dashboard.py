"""Dashboard UI + SDK delivery.

Serves the Twenty-focused dashboard at `/dashboard` and re-exports the
vanilla JS SDK at `/sdk/coco-sdk.js` so the SDK can be injected into
the Twenty tab without CORS gymnastics (the gateway already allows any
origin in dev via the CORS middleware in `main.py`).

Static CSS/JS are mounted separately at `/static/*` by `main.py`; this
router owns only the HTML entrypoint and the SDK passthrough.
"""

from __future__ import annotations

import io
import logging
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, Response

log = logging.getLogger("coco.dashboard")

router = APIRouter()

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_DASHBOARD_DIR = _BACKEND_DIR / "dashboard"
_TEMPLATE_PATH = _DASHBOARD_DIR / "templates" / "index.html"

# SDK is shipped from the sibling `frontend/` directory. In Docker we
# mount it to /app/frontend; in local dev it's the repo sibling of
# `backend/`.
_REPO_ROOT = _BACKEND_DIR.parent
_SDK_PATH = _REPO_ROOT / "frontend" / "coco-sdk.js"
_INJECT_PATH = _REPO_ROOT / "frontend" / "inject.js"
_BOOKMARKLET_PATH = _REPO_ROOT / "scripts" / "inject_bookmarklet.html"


@router.get("/dashboard", response_class=HTMLResponse)
async def dashboard() -> HTMLResponse:
    if not _TEMPLATE_PATH.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Dashboard template missing: {_TEMPLATE_PATH}",
        )
    html = _TEMPLATE_PATH.read_text(encoding="utf-8")
    return HTMLResponse(content=html)


@router.get("/sdk/coco-sdk.js")
async def sdk_js() -> FileResponse:
    if not _SDK_PATH.exists():
        raise HTTPException(status_code=404, detail="SDK bundle not found")
    return FileResponse(
        _SDK_PATH,
        media_type="application/javascript; charset=utf-8",
        filename="coco-sdk.js",
    )


@router.get("/sdk/inject.js")
async def inject_js() -> FileResponse:
    if not _INJECT_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail="Inject bootstrap not yet built (see plan Step 5).",
        )
    return FileResponse(
        _INJECT_PATH,
        media_type="application/javascript; charset=utf-8",
        filename="inject.js",
    )


@router.get("/bookmarklet", response_class=HTMLResponse)
async def bookmarklet_page() -> HTMLResponse:
    if not _BOOKMARKLET_PATH.exists():
        raise HTTPException(status_code=404, detail="Bookmarklet page missing")
    return HTMLResponse(content=_BOOKMARKLET_PATH.read_text(encoding="utf-8"))


_EXTENSION_DIR = _REPO_ROOT / "browser-extension"


@router.get("/browser-extension.zip")
async def browser_extension_zip() -> Response:
    """Package the browser-extension/ folder into a zip for download.

    Built on demand so we never ship a stale artifact; the files are
    small (< 50 KB) and the extension rarely changes so this is fine.
    """
    if not _EXTENSION_DIR.exists():
        raise HTTPException(
            status_code=404,
            detail=(
                "browser-extension/ folder missing. "
                "It ships inside coco-trust-layer — re-clone if you lost it."
            ),
        )

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(_EXTENSION_DIR.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(_EXTENSION_DIR))
    buffer.seek(0)
    return Response(
        content=buffer.read(),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="coco-browser-extension.zip"'},
    )
