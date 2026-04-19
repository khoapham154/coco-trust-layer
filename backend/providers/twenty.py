"""Twenty CRM state adapter.

Fetches live records from Twenty's REST API and projects them into the
`ui_state` shape each Twenty Action Pack expects. One method per pack,
matching the 5 packs shipped under ``data/twenty/packs/``:

- ``deal_stage_move``      → ``deal_state``
- ``contact_delete``       → ``contact_state``
- ``opportunity_create``   → ``opportunity_state``
- ``bulk_email``           → ``email_state``
- ``field_update``         → ``field_update_state``

The adapter pre-aggregates list-typed values into scalars (counts,
flags, booleans) because the gateway DSL does not permit function
calls or list comprehensions on pack expressions.
"""

from __future__ import annotations

import logging
import os
import re
from datetime import date, datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

import httpx

log = logging.getLogger("coco.providers.twenty")


_OPEN_OPPORTUNITY_STAGES = {"NEW", "SCREENING", "MEETING", "PROPOSAL", "CUSTOMER"}
_CLOSED_OPPORTUNITY_STAGES = {"WON", "LOST"}
_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def _amount_to_number(amount: Any) -> float:
    """Twenty stores money as ``{amountMicros, currencyCode}``. Flatten it."""
    if amount is None:
        return 0.0
    if isinstance(amount, (int, float)):
        return float(amount)
    if isinstance(amount, dict):
        micros = amount.get("amountMicros")
        if micros is not None:
            try:
                return float(micros) / 1_000_000.0
            except (TypeError, ValueError):
                return 0.0
    return 0.0


def _parse_iso(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        text = str(value)
        if text.endswith("Z"):
            text = text.replace("Z", "+00:00")
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _days_between(earlier: Optional[datetime], now: Optional[datetime] = None) -> int:
    if earlier is None:
        return 0
    current = now or datetime.now(timezone.utc)
    if earlier.tzinfo is None:
        earlier = earlier.replace(tzinfo=timezone.utc)
    delta = current - earlier
    return int(delta.total_seconds() // 86400)


class TwentyStateProvider:
    """Client-wrapper that returns pack-ready `ui_state` dicts."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        *,
        client: Optional[httpx.Client] = None,
        timeout: float = 15.0,
    ):
        self.base_url = (base_url or os.environ.get("TWENTY_BASE_URL", "http://localhost:3000")).rstrip("/")
        self.api_key = api_key or os.environ.get("TWENTY_API_KEY", "")
        if client is not None:
            self.client = client
            self._owns_client = False
        else:
            headers = {"Content-Type": "application/json"}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            self.client = httpx.Client(
                base_url=self.base_url,
                headers=headers,
                timeout=timeout,
            )
            self._owns_client = True

    def close(self) -> None:
        if self._owns_client:
            self.client.close()

    # --- REST helpers ------------------------------------------------

    def _get_one(self, path: str) -> Dict[str, Any]:
        resp = self.client.get(path)
        resp.raise_for_status()
        body = resp.json()
        payload = body.get("data", body)
        if isinstance(payload, dict):
            for value in payload.values():
                if isinstance(value, dict):
                    return value
            return payload
        return {}

    def _get_many(self, path: str, params: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
        resp = self.client.get(path, params=params or {})
        resp.raise_for_status()
        body = resp.json()
        payload = body.get("data", body)
        if isinstance(payload, dict):
            for value in payload.values():
                if isinstance(value, list):
                    return value
        if isinstance(payload, list):
            return payload
        return []

    def _get_many_filtered(
        self,
        path: str,
        field: str,
        value: str,
    ) -> List[Dict[str, Any]]:
        """Fetch a list and filter by ``field == value`` locally.

        Twenty's REST filter grammar shifted between minor versions
        (0.30 accepts ``filter=field[eq]:value``, 0.32 rejects it with
        400). Rather than maintain a per-version grammar map, we fetch
        unfiltered and filter in Python. For seeded demo volumes (a
        few dozen rows per collection) the cost is negligible and the
        behaviour is version-proof.
        """
        try:
            rows = self._get_many(path)
        except httpx.HTTPError as exc:
            log.warning("Twenty %s fetch failed (%s) — treating as empty list", path, exc)
            return []
        return [row for row in rows if row.get(field) == value]

    # --- pack-specific builders -------------------------------------

    def deal_state(
        self,
        opportunity_id: str,
        target_stage: str,
        *,
        user_role: str = "sales",
    ) -> Dict[str, Any]:
        """Shape: ``{deal: {...}, user: {...}}`` for ``twenty.deal_stage_move``."""
        opp = self._get_one(f"/rest/opportunities/{opportunity_id}")
        tasks = self._get_many_filtered(
            "/rest/tasks",
            "opportunityId",
            opportunity_id,
        )
        prev_tasks_completed = all(
            (t.get("status") or "").upper() in {"DONE", "COMPLETED", "CLOSED"}
            for t in tasks
        ) if tasks else True
        current_stage = (opp.get("stage") or "").upper()
        target_upper = (target_stage or "").upper()
        # Approximation: if target is one step beyond current in the
        # canonical pipeline, flag as sequential. Otherwise require
        # explicit override by setting the target stage flag on the
        # record itself.
        stage_order = ["NEW", "SCREENING", "MEETING", "PROPOSAL", "CUSTOMER", "WON"]
        try:
            sequential = stage_order.index(target_upper) - stage_order.index(current_stage) == 1
        except ValueError:
            sequential = False

        return {
            "deal": {
                "id": opp.get("id"),
                "owner": opp.get("pointOfContactId") or opp.get("createdById"),
                "amount": _amount_to_number(opp.get("amount")),
                "prev_stage_tasks_completed": bool(prev_tasks_completed),
                "is_sequential_stage_move": bool(sequential),
                "manager_field_filled": bool(opp.get("managerId")),
                "target_stage": target_upper.lower(),
                "current_stage": current_stage.lower(),
            },
            "user": {"role": user_role},
        }

    def contact_state(
        self,
        person_id: str,
        *,
        user_role: str = "admin",
    ) -> Dict[str, Any]:
        """Shape for ``twenty.contact_delete``."""
        person = self._get_one(f"/rest/people/{person_id}")
        opps = self._get_many_filtered(
            "/rest/opportunities",
            "pointOfContactId",
            person_id,
        )
        open_count = sum(
            1 for o in opps if (o.get("stage") or "").upper() in _OPEN_OPPORTUNITY_STAGES
        )
        modified = _parse_iso(person.get("updatedAt"))
        days_since_modified = _days_between(modified)

        return {
            "contact": {
                "id": person.get("id"),
                "open_opportunity_count": int(open_count),
                "days_since_modified": int(days_since_modified),
            },
            "user": {"role": user_role},
        }

    def opportunity_state(
        self,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Shape for ``twenty.opportunity_create``.

        Unlike the other builders this takes the *proposed* record (not
        a Twenty ID) because the opportunity does not exist yet. We
        verify the referenced company does exist, and compute the
        close-date aggregate.
        """
        company_id = payload.get("companyId") or payload.get("company_id")
        company_exists = False
        if company_id:
            try:
                company = self._get_one(f"/rest/companies/{company_id}")
                company_exists = bool(company.get("id"))
            except httpx.HTTPError:
                company_exists = False

        amount = _amount_to_number(payload.get("amount"))
        close_date = _parse_iso(payload.get("closeDate") or payload.get("close_date"))
        close_date_is_future = (
            bool(close_date)
            and close_date.replace(tzinfo=close_date.tzinfo or timezone.utc)
            > datetime.now(timezone.utc)
        )

        return {
            "opportunity": {
                "company_id": company_id if company_exists else None,
                "amount": amount,
                "close_date": close_date.isoformat() if close_date else None,
                "close_date_is_future": bool(close_date_is_future),
            },
        }

    def email_state(
        self,
        *,
        recipient_ids: Iterable[str],
        activity_logged_ids: Optional[Iterable[str]] = None,
    ) -> Dict[str, Any]:
        """Shape for ``twenty.bulk_email``. Pre-aggregates list checks."""
        ids = list(recipient_ids)
        recipients: List[Dict[str, Any]] = []
        for pid in ids:
            try:
                recipients.append(self._get_one(f"/rest/people/{pid}"))
            except httpx.HTTPError as exc:
                log.warning("Failed to fetch person %s: %s", pid, exc)
                recipients.append({})

        def _has_email(r: Dict[str, Any]) -> bool:
            emails = r.get("emails") or {}
            primary = emails.get("primaryEmail") if isinstance(emails, dict) else None
            return bool(primary)

        def _is_flagged(r: Dict[str, Any]) -> bool:
            # Twenty doesn't ship do-not-contact out of the box; we
            # honour a custom `doNotContact` boolean if present.
            return bool(r.get("doNotContact") or r.get("do_not_contact"))

        logged_set = set(activity_logged_ids or [])
        activity_for_all = bool(ids) and all(pid in logged_set for pid in ids)

        return {
            "email": {
                "recipient_count": len(ids),
                "all_recipients_have_email": all(_has_email(r) for r in recipients) if recipients else False,
                "has_flagged_recipient": any(_is_flagged(r) for r in recipients),
                "activity_logged_for_all": activity_for_all,
            }
        }

    def field_update_state(
        self,
        *,
        entity: str,
        record_id: str,
        field: str,
        new_value: Any,
        required_fields: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Shape for ``twenty.field_update``.

        ``entity`` is the collection (e.g. ``people``, ``opportunities``).
        """
        collection = entity.rstrip("/")
        record = self._get_one(f"/rest/{collection}/{record_id}")
        exists = bool(record.get("id"))
        archived = bool(record.get("archivedAt") or record.get("archived"))

        # Required-fields guard: if `field` is required and the new
        # value is empty, that's a violation. Callers can pass the
        # required list explicitly; otherwise we assume only the
        # updated field matters.
        req = list(required_fields or [])
        updated_is_empty = new_value in (None, "", [], {})
        required_still_filled = not (field in req and updated_is_empty)

        is_email_field = "email" in field.lower()
        email_valid = True
        if is_email_field and isinstance(new_value, str):
            email_valid = bool(_EMAIL_RE.match(new_value))

        return {
            "record": {
                "id": record.get("id"),
                "exists": exists,
                "archived": archived,
                # Post-condition aggregate: callers can overwrite this
                # after they perform the mutation.
                "updated_timestamp_changed": False,
            },
            "field_update": {
                "entity": entity,
                "field": field,
                "required_fields_still_filled": bool(required_still_filled),
                "email_format_valid": bool(email_valid),
            },
        }
