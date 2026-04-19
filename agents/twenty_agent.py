"""TwentyAgent — drives a live Twenty CRM via its REST API, validates
every action through the CoCo Gateway, and only performs the mutation
when the verdict is ALLOW. Every run is recorded in the audit log.

Used in two places:

1. ``python -m agents.cli --scenario <id>`` — standalone smoke driver.
2. ``POST /api/scenarios/{id}/run?driver=twenty`` on the gateway —
   the dashboard's "Live Twenty" mode.

The agent is intentionally thin: it loads a scenario JSON, resolves
referenced records against Twenty (seeding on demand), builds the
pack-ready `ui_state` via ``TwentyStateProvider``, calls the gateway,
and on ALLOW translates the scenario's ``action`` into a concrete
Twenty REST call. On BLOCK / ESCALATE it returns the verdict and
never touches Twenty.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional

import httpx

log = logging.getLogger("coco.agents.twenty")

# When run as a FastAPI route, sys.path already includes the backend
# directory. When run as `python -m agents.cli` we patch sys.path from
# agents/cli.py so the `providers` package is importable.
try:  # pragma: no cover - import-path hygiene
    from providers.twenty import TwentyStateProvider  # type: ignore
except ImportError:  # pragma: no cover
    TwentyStateProvider = None  # set up later by cli.py


def _scenarios_dir() -> Path:
    here = Path(__file__).resolve().parent
    repo_root = here.parent
    return repo_root / "data" / "twenty" / "scenarios"


def _fixtures_path() -> Path:
    here = Path(__file__).resolve().parent
    repo_root = here.parent
    return repo_root / "data" / "twenty" / "fixtures" / "seeded.json"


class TwentyAgent:
    """Scenario driver for the live Twenty stack."""

    def __init__(
        self,
        twenty_base_url: str,
        twenty_api_key: str,
        gateway_url: str,
        *,
        twenty_client: Optional[httpx.Client] = None,
        gateway_client: Optional[httpx.Client] = None,
        state_provider: Optional[Any] = None,
    ):
        self.twenty_base_url = twenty_base_url.rstrip("/")
        self.twenty_api_key = twenty_api_key
        self.gateway_url = gateway_url.rstrip("/")

        twenty_headers = {"Content-Type": "application/json"}
        if twenty_api_key:
            twenty_headers["Authorization"] = f"Bearer {twenty_api_key}"
        self.twenty = twenty_client or httpx.Client(
            base_url=self.twenty_base_url, headers=twenty_headers, timeout=15.0
        )
        self.gateway = gateway_client or httpx.Client(
            base_url=self.gateway_url, timeout=15.0
        )

        if state_provider is None:
            if TwentyStateProvider is None:  # pragma: no cover
                raise RuntimeError("TwentyStateProvider not importable")
            state_provider = TwentyStateProvider(
                base_url=self.twenty_base_url,
                api_key=self.twenty_api_key,
                client=self.twenty,
            )
        self.state_provider = state_provider

    # --- construction helpers ---------------------------------------

    @classmethod
    def from_env(cls) -> "TwentyAgent":
        return cls(
            twenty_base_url=os.environ.get("TWENTY_BASE_URL", "http://localhost:3000"),
            twenty_api_key=os.environ.get("TWENTY_API_KEY", ""),
            gateway_url=os.environ.get("COCO_GATEWAY_URL", "http://localhost:8080"),
        )

    # --- public API -------------------------------------------------

    def close(self) -> None:
        try:
            self.twenty.close()
        except Exception:  # pragma: no cover
            pass
        try:
            self.gateway.close()
        except Exception:  # pragma: no cover
            pass

    def run(self, scenario_id: str) -> Dict[str, Any]:
        scenario = self._load_scenario(scenario_id)
        fixtures = self._load_fixtures()

        try:
            ui_state = self._build_live_state(scenario, fixtures)
        except httpx.HTTPError as exc:
            return {
                "driver": "twenty",
                "scenario_id": scenario_id,
                "error": f"Twenty fetch failed: {exc}",
                "decision": None,
                "twenty_response": None,
            }

        decision = self._validate(scenario, ui_state)
        twenty_response: Optional[Dict[str, Any]] = None
        mutation_error: Optional[str] = None

        if decision.get("verdict") == "ALLOW":
            try:
                twenty_response = self._apply(scenario, fixtures)
            except httpx.HTTPError as exc:
                mutation_error = f"Twenty mutation failed: {exc}"
                log.warning(mutation_error)

        return {
            "driver": "twenty",
            "scenario_id": scenario_id,
            "pack_id": scenario["pack_id"],
            "expected_verdict": scenario.get("expected_verdict"),
            "expected_reason_contains": scenario.get("expected_reason_contains"),
            "ui_state": ui_state,
            "decision": decision,
            "twenty_response": twenty_response,
            "mutation_error": mutation_error,
        }

    # --- internals --------------------------------------------------

    def _load_scenario(self, scenario_id: str) -> Dict[str, Any]:
        target = _scenarios_dir() / f"{scenario_id}.json"
        if not target.exists():
            raise FileNotFoundError(f"Scenario not found: {scenario_id}")
        return json.loads(target.read_text(encoding="utf-8"))

    def _load_fixtures(self) -> Dict[str, Any]:
        path = _fixtures_path()
        if not path.exists():
            log.warning("No fixture file at %s — run scripts/seed_twenty.py first", path)
            return {"companies": {}, "people": {}, "opportunities": {}}
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            log.warning("Fixture file unreadable: %s", exc)
            return {"companies": {}, "people": {}, "opportunities": {}}

    def _validate(self, scenario: Dict[str, Any], ui_state: Dict[str, Any]) -> Dict[str, Any]:
        body = {
            "pack_id": scenario["pack_id"],
            "action": scenario["action"],
            "ui_state": ui_state,
            "phase": scenario.get("phase", "pre"),
        }
        resp = self.gateway.post("/api/validate", json=body)
        resp.raise_for_status()
        return resp.json()

    # --- per-pack state building ------------------------------------

    def _build_live_state(
        self,
        scenario: Dict[str, Any],
        fixtures: Dict[str, Any],
    ) -> Dict[str, Any]:
        pack_id = scenario["pack_id"]
        scenario_state = scenario.get("ui_state", {})

        if pack_id == "twenty.deal_stage_move":
            opp_name = scenario_state.get("deal", {}).get("id") or "Northwind Labs — Enterprise Trust Layer"
            opportunity_id = fixtures.get("opportunities", {}).get(opp_name)
            if not opportunity_id:
                # Fall back: use the scenario's own ui_state so the
                # driver can demonstrate verdicts even before seeding.
                return scenario_state
            target_stage = scenario_state.get("deal", {}).get("target_stage", "screening")
            user_role = scenario_state.get("user", {}).get("role", "sales")
            return self.state_provider.deal_state(
                opportunity_id=opportunity_id,
                target_stage=target_stage,
                user_role=user_role,
            )

        if pack_id == "twenty.contact_delete":
            person_email = scenario_state.get("contact", {}).get("id") or "ada@northwind.test"
            person_id = fixtures.get("people", {}).get(person_email)
            if not person_id:
                return scenario_state
            user_role = scenario_state.get("user", {}).get("role", "admin")
            return self.state_provider.contact_state(person_id=person_id, user_role=user_role)

        if pack_id == "twenty.opportunity_create":
            payload = dict(scenario_state.get("opportunity", {}))
            # Resolve named company → seeded ID if the scenario
            # referenced a fixture name.
            company_name = payload.get("company_name")
            if company_name:
                mapped = fixtures.get("companies", {}).get(company_name)
                if mapped:
                    payload["companyId"] = mapped
            return self.state_provider.opportunity_state(payload)

        if pack_id == "twenty.bulk_email":
            recipient_emails = scenario_state.get("email", {}).get("recipient_ids", [])
            if not recipient_emails:
                return scenario_state
            ids = [fixtures.get("people", {}).get(email) or email for email in recipient_emails]
            return self.state_provider.email_state(
                recipient_ids=ids,
                activity_logged_ids=scenario_state.get("email", {}).get("activity_logged_ids"),
            )

        if pack_id == "twenty.field_update":
            fu = scenario_state.get("field_update", {})
            entity = fu.get("entity", "people")
            record_name = scenario_state.get("record", {}).get("id") or "ada@northwind.test"
            record_id = fixtures.get("people", {}).get(record_name)
            if not record_id:
                return scenario_state
            return self.state_provider.field_update_state(
                entity=entity,
                record_id=record_id,
                field=fu.get("field", "email"),
                new_value=fu.get("new_value"),
                required_fields=fu.get("required_fields", []),
            )

        # Unknown pack — defer to the scenario's own ui_state.
        log.warning("No live-state builder for pack %s — using scenario fixture", pack_id)
        return scenario_state

    # --- per-pack mutations ----------------------------------------

    def _apply(
        self,
        scenario: Dict[str, Any],
        fixtures: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        """Perform the mutation in Twenty. Only called on verdict=ALLOW."""
        pack_id = scenario["pack_id"]
        scenario_state = scenario.get("ui_state", {})

        if pack_id == "twenty.deal_stage_move":
            opp_name = scenario_state.get("deal", {}).get("id") or "Northwind Labs — Enterprise Trust Layer"
            opportunity_id = fixtures.get("opportunities", {}).get(opp_name)
            target_stage = scenario_state.get("deal", {}).get("target_stage", "screening").upper()
            if not opportunity_id:
                log.info("deal_stage_move: no seeded opportunity, skipping apply")
                return None
            resp = self.twenty.patch(
                f"/rest/opportunities/{opportunity_id}",
                json={"stage": target_stage},
            )
            resp.raise_for_status()
            return resp.json()

        if pack_id == "twenty.opportunity_create":
            payload = dict(scenario_state.get("opportunity", {}))
            company_name = payload.pop("company_name", None)
            if company_name and fixtures.get("companies", {}).get(company_name):
                payload["companyId"] = fixtures["companies"][company_name]
            # Some scenario fixtures nest the amount as a number;
            # Twenty expects {amountMicros, currencyCode}.
            amount = payload.get("amount")
            if isinstance(amount, (int, float)):
                payload["amount"] = {"amountMicros": int(amount * 1_000_000), "currencyCode": "USD"}
            resp = self.twenty.post("/rest/opportunities", json=payload)
            resp.raise_for_status()
            return resp.json()

        if pack_id == "twenty.contact_delete":
            person_email = scenario_state.get("contact", {}).get("id") or "ada@northwind.test"
            person_id = fixtures.get("people", {}).get(person_email)
            if not person_id:
                log.info("contact_delete: no seeded person, skipping apply")
                return None
            resp = self.twenty.delete(f"/rest/people/{person_id}")
            resp.raise_for_status()
            return {"status_code": resp.status_code}

        if pack_id == "twenty.field_update":
            fu = scenario_state.get("field_update", {})
            entity = fu.get("entity", "people")
            record_name = scenario_state.get("record", {}).get("id") or "ada@northwind.test"
            record_id = fixtures.get("people", {}).get(record_name)
            if not record_id:
                return None
            resp = self.twenty.patch(
                f"/rest/{entity}/{record_id}",
                json={fu.get("field"): fu.get("new_value")},
            )
            resp.raise_for_status()
            return resp.json()

        if pack_id == "twenty.bulk_email":
            # Twenty doesn't have a built-in bulk-email endpoint. For
            # demonstration purposes we log an activity on each
            # recipient and return the aggregate count.
            recipient_emails = scenario_state.get("email", {}).get("recipient_ids", [])
            logged = 0
            for email in recipient_emails:
                person_id = fixtures.get("people", {}).get(email)
                if not person_id:
                    continue
                try:
                    resp = self.twenty.post(
                        "/rest/activities",
                        json={
                            "type": "EMAIL",
                            "title": scenario_state.get("email", {}).get("subject", "CoCo outreach"),
                            "authorId": scenario_state.get("email", {}).get("author_id"),
                            "personId": person_id,
                        },
                    )
                    if resp.status_code < 400:
                        logged += 1
                except httpx.HTTPError as exc:
                    log.warning("bulk_email activity failed for %s: %s", email, exc)
            return {"logged": logged, "attempted": len(recipient_emails)}

        log.info("No mutation handler for pack %s", pack_id)
        return None
