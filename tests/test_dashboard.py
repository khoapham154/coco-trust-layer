"""Tests for the dashboard + scenarios routes."""

from __future__ import annotations

import os

os.environ.setdefault("COCO_DB_PATH", "/tmp/coco_test_audit.db")

import pytest
from fastapi.testclient import TestClient

from tests.conftest import BACKEND_DIR  # noqa: F401  (sys.path side effect)

from main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_dashboard_html_renders(client):
    r = client.get("/dashboard")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
    body = r.text
    assert "Coco Trust Layer" in body
    assert "/static/app.js" in body
    assert "/static/styles.css" in body


def test_static_assets_served(client):
    for asset, needle in [
        ("/static/styles.css", "--accent: #9024e2"),
        ("/static/app.js", "loadPacks"),
    ]:
        r = client.get(asset)
        assert r.status_code == 200, f"{asset} failed: {r.status_code}"
        assert needle in r.text, f"{asset} missing expected substring"


def test_sdk_served(client):
    r = client.get("/sdk/coco-sdk.js")
    assert r.status_code == 200
    assert "Coco" in r.text
    assert "application/javascript" in r.headers["content-type"]


def test_scenarios_list_length(client):
    r = client.get("/api/scenarios")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 19
    sample = data[0]
    for field in ("id", "pack_id", "action", "expected_verdict"):
        assert field in sample


def test_scenario_detail(client):
    r = client.get("/api/scenarios/deal_stage_move_allow")
    assert r.status_code == 200
    data = r.json()
    assert data["scenario_name"] == "deal_stage_move_allow"
    assert data["pack_id"] == "twenty.deal_stage_move"
    assert data["expected_verdict"] == "ALLOW"


def test_scenario_detail_404(client):
    r = client.get("/api/scenarios/does_not_exist")
    assert r.status_code == 404


def test_run_scenario_engine_mode(client):
    r = client.post("/api/scenarios/deal_stage_move_allow/run")
    assert r.status_code == 200
    data = r.json()
    assert data["driver"] == "engine"
    assert data["decision"]["verdict"] == "ALLOW"
    assert data["decision"]["verdict"] == data["expected_verdict"]


def test_run_scenario_block_verdict(client):
    r = client.post("/api/scenarios/deal_stage_move_block_no_owner/run")
    assert r.status_code == 200
    data = r.json()
    assert data["decision"]["verdict"] == "BLOCK"
    assert "owner" in data["decision"]["primary_reason"].lower()


def test_run_scenario_writes_audit(client):
    # Count before, run, count after.
    before = client.get("/api/audit?limit=500").json()
    before_ids = {row["id"] for row in before}
    client.post("/api/scenarios/bulk_email_allow/run")
    after = client.get("/api/audit?limit=500").json()
    new_rows = [row for row in after if row["id"] not in before_ids]
    assert len(new_rows) >= 1, "No new audit row after scenario run"
    assert new_rows[0]["pack_id"] == "twenty.bulk_email"
