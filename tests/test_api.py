"""API tests using FastAPI's TestClient against the gateway app.

TestClient is used (instead of httpx.ASGITransport directly) because it
handles the FastAPI lifespan — our pack loader runs in ``lifespan`` and
sets ``app.state.engine``, which routes read from.
"""

from __future__ import annotations

import os

# Ensure test DB is isolated from dev DB.
os.environ["COCO_DB_PATH"] = "/tmp/coco_test_audit.db"

import pytest
from fastapi.testclient import TestClient

from tests.conftest import BACKEND_DIR  # noqa: F401  (sys.path side effect)

from main import app


@pytest.fixture(scope="module")
def client():
    # ``with TestClient(app)`` triggers the lifespan (startup/shutdown),
    # which populates ``app.state.engine`` and ``app.state.audit_log``.
    with TestClient(app) as c:
        yield c


def test_health_returns_ok(client):
    r = client.get("/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert data["packs_loaded"] == 6


def test_list_packs_includes_twenty_and_banking(client):
    r = client.get("/api/packs")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 6
    ids = {p["id"] for p in data}
    assert "twenty.deal_stage_move" in ids
    assert "twenty.bulk_email" in ids
    assert "banking.wire_transfer" in ids


def test_get_pack_detail(client):
    r = client.get("/api/packs/twenty.deal_stage_move")
    assert r.status_code == 200
    data = r.json()
    assert data["id"] == "twenty.deal_stage_move"
    assert len(data["pre_conditions"]) >= 1
    assert len(data["constraints"]) >= 1


def test_get_pack_404(client):
    r = client.get("/api/packs/does.not.exist")
    assert r.status_code == 404


def test_validate_allow(client):
    body = {
        "pack_id": "twenty.deal_stage_move",
        "action": "move_stage",
        "phase": "pre",
        "ui_state": {
            "deal": {
                "owner": "u_001",
                "amount": 20000,
                "prev_stage_tasks_completed": True,
                "is_sequential_stage_move": True,
                "manager_field_filled": False,
            },
            "user": {"role": "sales"},
        },
    }
    r = client.post("/api/validate", json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["verdict"] == "ALLOW"


def test_validate_block(client):
    body = {
        "pack_id": "twenty.deal_stage_move",
        "action": "move_stage",
        "phase": "pre",
        "ui_state": {
            "deal": {
                "owner": None,
                "amount": 20000,
                "prev_stage_tasks_completed": True,
                "is_sequential_stage_move": True,
            },
            "user": {"role": "sales"},
        },
    }
    r = client.post("/api/validate", json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["verdict"] == "BLOCK"
    assert "owner" in data["primary_reason"].lower()


def test_validate_unknown_pack(client):
    body = {
        "pack_id": "nope.nothing",
        "action": "x",
        "phase": "pre",
        "ui_state": {},
    }
    r = client.post("/api/validate", json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["verdict"] == "BLOCK"
    assert "unknown_pack" in data["primary_reason"]


def test_audit_list(client):
    # Send one validate to ensure audit has content.
    client.post(
        "/api/validate",
        json={
            "pack_id": "twenty.deal_stage_move",
            "action": "move_stage",
            "phase": "pre",
            "ui_state": {
                "deal": {
                    "owner": "u_001",
                    "amount": 20000,
                    "prev_stage_tasks_completed": True,
                    "is_sequential_stage_move": True,
                },
                "user": {"role": "sales"},
            },
        },
    )
    r = client.get("/api/audit?limit=10")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    assert "verdict" in data[0]
