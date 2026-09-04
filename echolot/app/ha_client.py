"""Minimal client for Home Assistant's Core REST API, reached through the
Supervisor proxy (http://supervisor/core/api) using SUPERVISOR_TOKEN.

See https://developers.home-assistant.io/docs/add-ons/communication/ —
`homeassistant_api: true` in config.yaml is what makes this proxy reachable
and populates SUPERVISOR_TOKEN.

Used to read the binary_sensor/sensor entities ESPectre exposes and to call
number.set_value / switch.turn_on for runtime parameter pushes, rather than
re-implementing the ESPHome native API's device encryption ourselves.
"""

import os
from datetime import datetime, timedelta, timezone

import httpx

DEFAULT_BASE_URL = "http://supervisor/core/api"


class HomeAssistantUnavailable(Exception):
    """Raised whenever the Core API can't be reached or answers with an error."""


def _base_url() -> str:
    return os.environ.get("ECHOLOT_HA_BASE_URL", DEFAULT_BASE_URL)


def _headers() -> dict:
    token = os.environ.get("ECHOLOT_HA_TOKEN") or os.environ.get("SUPERVISOR_TOKEN")
    if not token:
        raise HomeAssistantUnavailable("No SUPERVISOR_TOKEN available (homeassistant_api not granted?)")
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


async def get_state(entity_id: str) -> dict | None:
    """Returns the entity's state object, or None if it doesn't exist (yet)."""
    headers = _headers()
    try:
        async with httpx.AsyncClient(base_url=_base_url(), timeout=5.0) as client:
            resp = await client.get(f"/states/{entity_id}", headers=headers)
    except httpx.HTTPError as err:
        raise HomeAssistantUnavailable(str(err)) from err
    if resp.status_code == 404:
        return None
    if resp.status_code != 200:
        raise HomeAssistantUnavailable(f"GET /states/{entity_id} -> {resp.status_code}")
    return resp.json()


async def get_history(entity_id: str, minutes: int) -> list[dict]:
    """Past states for one entity, oldest first.

    /api/history/period/<start> answers with a list of per-entity lists;
    `minimal_response` trims the intermediate entries down to state +
    last_changed, which is all the sparkline needs.
    """
    headers = _headers()
    start = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
    params = {
        "filter_entity_id": entity_id,
        "minimal_response": "",
        "no_attributes": "",
    }
    try:
        async with httpx.AsyncClient(base_url=_base_url(), timeout=10.0) as client:
            resp = await client.get(f"/history/period/{start}", headers=headers, params=params)
    except httpx.HTTPError as err:
        raise HomeAssistantUnavailable(str(err)) from err
    if resp.status_code != 200:
        raise HomeAssistantUnavailable(f"GET /history/period -> {resp.status_code}")

    payload = resp.json()
    if not isinstance(payload, list) or not payload:
        return []
    series = payload[0]
    return series if isinstance(series, list) else []


async def call_service(domain: str, service: str, entity_id: str, **extra) -> None:
    headers = _headers()
    payload = {"entity_id": entity_id, **extra}
    try:
        async with httpx.AsyncClient(base_url=_base_url(), timeout=5.0) as client:
            resp = await client.post(f"/services/{domain}/{service}", headers=headers, json=payload)
    except httpx.HTTPError as err:
        raise HomeAssistantUnavailable(str(err)) from err
    if resp.status_code not in (200, 201):
        raise HomeAssistantUnavailable(f"POST /services/{domain}/{service} -> {resp.status_code}: {resp.text[:200]}")
