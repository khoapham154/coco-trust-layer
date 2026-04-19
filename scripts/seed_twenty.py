#!/usr/bin/env python3
"""Seed a local Twenty CRM instance with 5 companies, 10 people, 3 opportunities.

Writes the returned IDs to ``data/twenty/fixtures/seeded.json`` so the
Python agent can reference specific records when running scenarios.

Idempotent — a record is considered "seeded" when its name matches an
entry already in Twenty. Re-running is safe; the script will log
"exists" for records already created.

Usage:
    export TWENTY_API_KEY=<personal token from Settings → Developers>
    python scripts/seed_twenty.py
    # or:
    python scripts/seed_twenty.py --base-url http://localhost:3000 \
        --api-key $TWENTY_API_KEY --fixture-out data/twenty/fixtures/seeded.json
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("coco.seed_twenty")


DEFAULT_BASE_URL = os.environ.get("TWENTY_BASE_URL", "http://localhost:3000")
DEFAULT_API_KEY = os.environ.get("TWENTY_API_KEY", "")

COMPANIES: List[Dict[str, Any]] = [
    {"name": "Northwind Labs", "domainName": {"primaryLinkUrl": "northwind.test"}, "employees": 120},
    {"name": "Contoso Health", "domainName": {"primaryLinkUrl": "contoso.test"}, "employees": 900},
    {"name": "Acme Robotics", "domainName": {"primaryLinkUrl": "acme.test"}, "employees": 45},
    {"name": "Globex Capital", "domainName": {"primaryLinkUrl": "globex.test"}, "employees": 320},
    {"name": "Initech Systems", "domainName": {"primaryLinkUrl": "initech.test"}, "employees": 75},
]

PEOPLE: List[Dict[str, Any]] = [
    {"name": {"firstName": "Ada", "lastName": "Lovelace"}, "emails": {"primaryEmail": "ada@northwind.test"}, "company": "Northwind Labs"},
    {"name": {"firstName": "Alan", "lastName": "Turing"}, "emails": {"primaryEmail": "alan@northwind.test"}, "company": "Northwind Labs"},
    {"name": {"firstName": "Grace", "lastName": "Hopper"}, "emails": {"primaryEmail": "grace@contoso.test"}, "company": "Contoso Health"},
    {"name": {"firstName": "Edsger", "lastName": "Dijkstra"}, "emails": {"primaryEmail": "edsger@contoso.test"}, "company": "Contoso Health"},
    {"name": {"firstName": "Barbara", "lastName": "Liskov"}, "emails": {"primaryEmail": "barbara@acme.test"}, "company": "Acme Robotics"},
    {"name": {"firstName": "Donald", "lastName": "Knuth"}, "emails": {"primaryEmail": "donald@acme.test"}, "company": "Acme Robotics"},
    {"name": {"firstName": "Linus", "lastName": "Torvalds"}, "emails": {"primaryEmail": "linus@globex.test"}, "company": "Globex Capital"},
    {"name": {"firstName": "Margaret", "lastName": "Hamilton"}, "emails": {"primaryEmail": "margaret@globex.test"}, "company": "Globex Capital"},
    {"name": {"firstName": "Tim", "lastName": "Berners-Lee"}, "emails": {"primaryEmail": "tim@initech.test"}, "company": "Initech Systems"},
    {"name": {"firstName": "Sophie", "lastName": "Wilson"}, "emails": {"primaryEmail": "sophie@initech.test"}, "company": "Initech Systems"},
]

OPPORTUNITIES: List[Dict[str, Any]] = [
    {"name": "Northwind Labs — Enterprise Trust Layer", "amount": {"amountMicros": 30000000000, "currencyCode": "USD"}, "stage": "NEW", "company": "Northwind Labs"},
    {"name": "Contoso Health — Clinical AI Governance", "amount": {"amountMicros": 120000000000, "currencyCode": "USD"}, "stage": "SCREENING", "company": "Contoso Health"},
    {"name": "Acme Robotics — Gateway Pilot", "amount": {"amountMicros": 15000000000, "currencyCode": "USD"}, "stage": "NEW", "company": "Acme Robotics"},
]


class TwentyClient:
    def __init__(self, base_url: str, api_key: str, timeout: float = 20.0):
        self.base_url = base_url.rstrip("/")
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        self.client = httpx.Client(
            base_url=self.base_url,
            headers=self.headers,
            timeout=timeout,
        )

    def close(self) -> None:
        self.client.close()

    def _get_list(self, path: str, filter_params: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
        params = dict(filter_params or {})
        resp = self.client.get(path, params=params)
        resp.raise_for_status()
        data = resp.json()
        # Twenty REST wraps list responses under data.<collection>
        payload = data.get("data", {})
        for value in payload.values():
            if isinstance(value, list):
                return value
        return []

    def _post(self, path: str, body: Dict[str, Any]) -> Dict[str, Any]:
        resp = self.client.post(path, json=body)
        if resp.status_code >= 400:
            log.error("POST %s failed: %s — %s", path, resp.status_code, resp.text[:500])
            resp.raise_for_status()
        data = resp.json()
        payload = data.get("data", {})
        for value in payload.values():
            if isinstance(value, dict) and "id" in value:
                return value
        return payload

    def find_company(self, name: str) -> Optional[Dict[str, Any]]:
        rows = self._get_list("/rest/companies", {"filter": f"name[eq]:{name}"})
        return rows[0] if rows else None

    def find_person(self, email: str) -> Optional[Dict[str, Any]]:
        rows = self._get_list("/rest/people", {"filter": f"emails.primaryEmail[eq]:{email}"})
        return rows[0] if rows else None

    def find_opportunity(self, name: str) -> Optional[Dict[str, Any]]:
        rows = self._get_list("/rest/opportunities", {"filter": f"name[eq]:{name}"})
        return rows[0] if rows else None

    def create_company(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self._post("/rest/companies", payload)

    def create_person(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self._post("/rest/people", payload)

    def create_opportunity(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self._post("/rest/opportunities", payload)

    def patch_opportunity(self, opp_id: str, patch: Dict[str, Any]) -> Dict[str, Any]:
        resp = self.client.patch(f"/rest/opportunities/{opp_id}", json=patch)
        if resp.status_code >= 400:
            log.error(
                "PATCH /rest/opportunities/%s failed: %s — %s",
                opp_id, resp.status_code, resp.text[:500],
            )
            resp.raise_for_status()
        body = resp.json()
        payload = body.get("data", body)
        if isinstance(payload, dict):
            for value in payload.values():
                if isinstance(value, dict) and "id" in value:
                    return value
        return payload if isinstance(payload, dict) else {}


def seed(client: TwentyClient) -> Dict[str, Any]:
    out: Dict[str, Any] = {"companies": {}, "people": {}, "opportunities": {}}

    # --- companies ---
    for company in COMPANIES:
        existing = client.find_company(company["name"])
        if existing:
            log.info("exists: company %s (%s)", company["name"], existing.get("id"))
            out["companies"][company["name"]] = existing.get("id")
            continue
        created = client.create_company(company)
        out["companies"][company["name"]] = created.get("id")
        log.info("created: company %s (%s)", company["name"], created.get("id"))

    # --- people ---
    for person in PEOPLE:
        email = person["emails"]["primaryEmail"]
        existing = client.find_person(email)
        if existing:
            log.info("exists: person %s", email)
            out["people"][email] = existing.get("id")
            continue
        payload = dict(person)
        company_name = payload.pop("company", None)
        if company_name and out["companies"].get(company_name):
            payload["companyId"] = out["companies"][company_name]
        created = client.create_person(payload)
        out["people"][email] = created.get("id")
        log.info("created: person %s (%s)", email, created.get("id"))

    # --- opportunities ---
    # Build a company → first-person-email map so we can assign each
    # opportunity a pointOfContactId. The deal_stage_move pack blocks
    # when opp.owner is null, so seeded allow-scenarios need an owner.
    first_person_per_company: Dict[str, str] = {}
    for person in PEOPLE:
        company_name = person.get("company")
        email = person["emails"]["primaryEmail"]
        if company_name and company_name not in first_person_per_company:
            person_id = out["people"].get(email)
            if person_id:
                first_person_per_company[company_name] = person_id

    for opp in OPPORTUNITIES:
        existing = client.find_opportunity(opp["name"])
        company_name = opp.get("company")
        owner_id = first_person_per_company.get(company_name) if company_name else None
        if existing:
            out["opportunities"][opp["name"]] = existing.get("id")
            # Fix-up: earlier seeds didn't set pointOfContactId. If it's
            # still missing and we have a candidate owner, PATCH it in
            # so the deal_stage_move pack's owner check passes.
            if owner_id and not existing.get("pointOfContactId"):
                try:
                    client.patch_opportunity(existing["id"], {"pointOfContactId": owner_id})
                    log.info(
                        "patched: opportunity %s owner→%s",
                        opp["name"], owner_id,
                    )
                except httpx.HTTPError as exc:
                    log.warning("patch failed for %s: %s", opp["name"], exc)
            else:
                log.info("exists: opportunity %s (%s)", opp["name"], existing.get("id"))
            continue
        payload = dict(opp)
        payload.pop("company", None)
        if company_name and out["companies"].get(company_name):
            payload["companyId"] = out["companies"][company_name]
        if owner_id:
            payload["pointOfContactId"] = owner_id
        created = client.create_opportunity(payload)
        out["opportunities"][opp["name"]] = created.get("id")
        log.info(
            "created: opportunity %s (%s) owner=%s",
            opp["name"],
            created.get("id"),
            payload.get("pointOfContactId", "none"),
        )

    return out


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--api-key", default=DEFAULT_API_KEY)
    default_out = Path(__file__).resolve().parent.parent / "data" / "twenty" / "fixtures" / "seeded.json"
    parser.add_argument("--fixture-out", type=Path, default=default_out)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.api_key:
        log.error(
            "No API key provided. Set TWENTY_API_KEY in the environment or pass --api-key. "
            "Generate one at %s/settings/developers → API keys.",
            args.base_url,
        )
        return 2

    client = TwentyClient(args.base_url, args.api_key)
    try:
        result = seed(client)
    except httpx.HTTPError as exc:
        log.error("Twenty API error: %s", exc)
        return 1
    finally:
        client.close()

    args.fixture_out.parent.mkdir(parents=True, exist_ok=True)
    args.fixture_out.write_text(json.dumps(result, indent=2, sort_keys=True))
    log.info(
        "Seed complete: %d companies · %d people · %d opportunities. Fixture: %s",
        len(result["companies"]),
        len(result["people"]),
        len(result["opportunities"]),
        args.fixture_out,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
