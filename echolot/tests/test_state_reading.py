"""Tests for how device state is read from Home Assistant.

Two properties matter here and neither is obvious from the code:

  * A zone reads every member from one snapshot, not three requests per
    device. That was measured at fifteen requests down to one for a
    five-device zone, and it is easy to reintroduce by accident.
  * If the snapshot request fails, reading must fall back to individual
    entity lookups rather than declaring every device unavailable. A
    partial Home Assistant outage should degrade, not black out.
"""

import asyncio
import os
import sys
import tempfile
from pathlib import Path

import pytest

os.environ.setdefault("ECHOLOT_DATA_DIR", tempfile.mkdtemp(prefix="echolot-tests-"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import ha_client, main  # noqa: E402
from app.devices import Device, DeviceCreate  # noqa: E402
from app.zones import Zone  # noqa: E402


def make_device(name="flur"):
    device = Device(
        id=name,
        created_at=0,
        updated_at=0,
        config=DeviceCreate(
            name=name, board="esp32c6", wifi_ssid="netz", wifi_password="passwort123"
        ),
        entity_motion=f"binary_sensor.{name}_motion_detected",
        entity_movement_score=f"sensor.{name}_movement_score",
        entity_threshold=f"number.{name}_threshold",
    )
    return device


def states_for(device, motion="on", score="4.2"):
    return [
        {"entity_id": device.entity_motion, "state": motion,
         "attributes": {"friendly_name": f"{device.config.name} Motion Detected"}},
        {"entity_id": device.entity_movement_score, "state": score,
         "attributes": {"friendly_name": f"{device.config.name} Movement Score"}},
        {"entity_id": device.entity_threshold, "state": "2.0",
         "attributes": {"friendly_name": f"{device.config.name} Threshold"}},
    ]


@pytest.fixture
def no_persistence(monkeypatch):
    """Reading state must never need to write; keep the fixtures in memory."""
    monkeypatch.setattr("app.devices.save_device", lambda device: None)
    monkeypatch.setattr("app.main.devices.save_device", lambda device: None)


def test_a_zone_reads_every_member_from_one_snapshot(monkeypatch, no_persistence):
    devices_ = [make_device(f"dev{i}") for i in range(5)]
    all_states = [s for d in devices_ for s in states_for(d)]
    calls = {"list": 0, "single": 0}

    async def fake_list():
        calls["list"] += 1
        return all_states

    async def fake_get(entity_id):
        calls["single"] += 1
        return next((s for s in all_states if s["entity_id"] == entity_id), None)

    monkeypatch.setattr(ha_client, "list_states", fake_list)
    monkeypatch.setattr(ha_client, "get_state", fake_get)
    monkeypatch.setattr(main.devices, "get_device", lambda i: next(d for d in devices_ if d.id == i))

    zone = Zone(id="z", created_at=0, updated_at=0, name="Zone",
                device_ids=[d.id for d in devices_])
    result = asyncio.run(main.compute_zone_state(zone))

    assert calls["list"] == 1
    assert calls["single"] == 0, "a zone must not fall back to per-entity reads"
    assert result["occupied"] is True
    assert len(result["members"]) == 5


def test_a_failing_snapshot_degrades_to_individual_reads(monkeypatch, no_persistence):
    """Home Assistant refusing /states must not black out every device."""
    device = make_device()
    entities = {s["entity_id"]: s for s in states_for(device)}
    calls = {"single": 0}

    async def failing_list():
        raise ha_client.HomeAssistantUnavailable("500 from /states")

    async def fake_get(entity_id):
        calls["single"] += 1
        return entities.get(entity_id)

    monkeypatch.setattr(ha_client, "list_states", failing_list)
    monkeypatch.setattr(ha_client, "get_state", fake_get)
    monkeypatch.setattr(main.devices, "get_device", lambda i: device)

    zone = Zone(id="z", created_at=0, updated_at=0, name="Zone", device_ids=[device.id])
    result = asyncio.run(main.compute_zone_state(zone))

    assert calls["single"] == 3
    assert result["available"] is True
    assert result["occupied"] is True


def test_a_single_device_card_does_not_pull_every_state(monkeypatch, no_persistence):
    """One card asking for every entity in Home Assistant is the worse trade."""
    device = make_device()
    entities = {s["entity_id"]: s for s in states_for(device)}
    calls = {"list": 0, "single": 0}

    async def fake_list():
        calls["list"] += 1
        return list(entities.values())

    async def fake_get(entity_id):
        calls["single"] += 1
        return entities.get(entity_id)

    monkeypatch.setattr(ha_client, "list_states", fake_list)
    monkeypatch.setattr(ha_client, "get_state", fake_get)

    result = asyncio.run(main._read_device_state(device))

    assert calls["list"] == 0
    assert calls["single"] == 3
    assert result["available"] is True
    assert result["movement_score"] == 4.2


def test_the_snapshot_path_also_relearns_a_wrong_entity_id(monkeypatch, no_persistence):
    """The self-healing from 0.10.2 must survive the batching change."""
    device = make_device()
    real = states_for(device)
    device.entity_motion = "binary_sensor.falscher_name"

    async def fake_list():
        return real

    monkeypatch.setattr(ha_client, "list_states", fake_list)
    monkeypatch.setattr(main.devices, "get_device", lambda i: device)

    zone = Zone(id="z", created_at=0, updated_at=0, name="Zone", device_ids=[device.id])
    result = asyncio.run(main.compute_zone_state(zone))

    assert device.entity_motion == "binary_sensor.flur_motion_detected"
    assert result["occupied"] is True
