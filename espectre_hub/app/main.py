"""ESPectre Hub backend.

Phase 1 established the add-on skeleton (Ingress UI, ESPHome CLI check).
Phase 2 added device management and browser-based flashing: the backend
renders a per-device ESPHome/ESPectre YAML, compiles it, and serves the
result as an ESP Web Tools manifest + firmware image.
Phase 3 adds zones (grouping devices with OR-logic presence aggregation)
and pushing runtime parameters (detection threshold, recalibration) to
already-flashed devices via Home Assistant's Core API — ESPectre exposes
these as HA entities already, so no direct device protocol is needed.
"""

import asyncio
import logging
import subprocess
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from app import builder, devices, ha_client, zones
from app.board_registry import BOARDS

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("espectre_hub")

STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="ESPectre Hub")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Builds run for minutes in a background task; asyncio only holds a weak
# reference to a task once created, so without keeping one here the task
# risks being garbage-collected mid-build. Discarded again once it's done.
_background_builds: set[asyncio.Task] = set()


def _validation_detail(err: ValidationError) -> list[dict]:
    # err.errors() can carry raw exception objects in "ctx" (e.g. from a
    # validator's `raise ValueError`), which json.dumps can't serialize.
    # Keep only the plain-text fields the UI actually uses.
    return [{"loc": e["loc"], "msg": e["msg"], "type": e["type"]} for e in err.errors()]


def _safe_float(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_ts(value) -> float | None:
    """ISO-8601 timestamp -> epoch seconds. HA emits a trailing 'Z' that
    fromisoformat only learned to accept in 3.11+, so normalise it."""
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


async def _read_device_state(device: devices.Device) -> dict:
    if not device.entity_motion:
        return {"available": False, "error": "No motion entity configured for this device"}
    try:
        motion = await ha_client.get_state(device.entity_motion)
        score = await ha_client.get_state(device.entity_movement_score) if device.entity_movement_score else None
        threshold = await ha_client.get_state(device.entity_threshold) if device.entity_threshold else None
    except ha_client.HomeAssistantUnavailable as err:
        return {"available": False, "error": str(err)}
    if motion is None:
        return {"available": False, "error": f"Entity {device.entity_motion} not found in Home Assistant"}
    return {
        "available": True,
        "motion": motion["state"] == "on",
        "movement_score": _safe_float(score["state"]) if score else None,
        "threshold": _safe_float(threshold["state"]) if threshold else None,
    }


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/esphome/version")
def esphome_version() -> dict:
    """Confirm the bundled ESPHome CLI is usable (needed for firmware builds)."""
    try:
        result = subprocess.run(
            ["esphome", "version"],
            capture_output=True,
            text=True,
            timeout=15,
            check=True,
        )
        return {"available": True, "version": result.stdout.strip()}
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as err:
        logger.warning("esphome CLI check failed: %s", err)
        return {"available": False, "error": str(err)}


@app.get("/api/boards")
def list_boards() -> list[dict]:
    return [
        {
            "key": b.key,
            "label": b.label,
            "chip_family": b.chip_family,
            "experimental": b.experimental,
        }
        for b in BOARDS.values()
    ]


@app.get("/api/devices")
def api_list_devices() -> list[dict]:
    return [d.public() for d in devices.list_devices()]


@app.post("/api/devices", status_code=201)
def api_create_device(payload: dict) -> dict:
    try:
        config = devices.DeviceCreate.model_validate(payload)
    except ValidationError as err:
        raise HTTPException(status_code=422, detail=_validation_detail(err)) from err
    device = devices.create_device(config)
    return device.public()


@app.get("/api/devices/{device_id}")
def api_get_device(device_id: str) -> dict:
    device = devices.get_device(device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    return device.public()


@app.patch("/api/devices/{device_id}")
def api_update_device(device_id: str, payload: dict) -> dict:
    device = devices.get_device(device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    try:
        patch = devices.DeviceUpdate.model_validate(payload)
    except ValidationError as err:
        raise HTTPException(status_code=422, detail=_validation_detail(err)) from err
    device.apply_update(patch)
    devices.save_device(device)
    return device.public()


@app.delete("/api/devices/{device_id}", status_code=204)
def api_delete_device(device_id: str) -> None:
    if not devices.delete_device(device_id):
        raise HTTPException(status_code=404, detail="Device not found")


@app.get("/api/devices/{device_id}/state")
async def api_device_state(device_id: str) -> dict:
    device = devices.get_device(device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    return await _read_device_state(device)


@app.get("/api/devices/{device_id}/history")
async def api_device_history(device_id: str, minutes: int = 30) -> dict:
    """Movement-score history, so the dashboard sparkline starts populated
    instead of building up from nothing on every page load."""
    device = devices.get_device(device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    if not device.entity_movement_score:
        return {"available": False, "error": "No movement score entity configured", "points": []}

    minutes = max(1, min(minutes, 1440))
    try:
        raw = await ha_client.get_history(device.entity_movement_score, minutes)
    except ha_client.HomeAssistantUnavailable as err:
        return {"available": False, "error": str(err), "points": []}

    points = []
    for entry in raw:
        value = _safe_float(entry.get("state"))
        if value is None:  # skips "unavailable" / "unknown"
            continue
        stamp = entry.get("last_changed") or entry.get("last_updated")
        parsed = _parse_ts(stamp)
        if parsed is None:
            continue
        points.append({"t": parsed, "v": value})
    return {"available": True, "points": points}


@app.post("/api/devices/{device_id}/threshold")
async def api_set_threshold(device_id: str, payload: dict) -> dict:
    device = devices.get_device(device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    if not device.entity_threshold:
        raise HTTPException(status_code=409, detail="No threshold entity configured for this device")
    value = _safe_float(payload.get("value"))
    if value is None or not (0.0 <= value <= 10.0):
        raise HTTPException(status_code=422, detail='Body must be {"value": <number 0.0-10.0>}')
    try:
        await ha_client.call_service("number", "set_value", device.entity_threshold, value=value)
    except ha_client.HomeAssistantUnavailable as err:
        raise HTTPException(status_code=502, detail=f"Home Assistant unreachable: {err}") from err
    return {"status": "ok"}


@app.post("/api/devices/{device_id}/calibrate")
async def api_calibrate_device(device_id: str) -> dict:
    device = devices.get_device(device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    if not device.entity_calibrate:
        raise HTTPException(status_code=409, detail="No calibrate entity configured for this device")
    try:
        await ha_client.call_service("switch", "turn_on", device.entity_calibrate)
    except ha_client.HomeAssistantUnavailable as err:
        raise HTTPException(status_code=502, detail=f"Home Assistant unreachable: {err}") from err
    return {"status": "ok"}


@app.post("/api/devices/{device_id}/build", status_code=202)
async def api_build_device(device_id: str) -> dict:
    device = devices.get_device(device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    if not builder.try_start_build(device_id):
        raise HTTPException(status_code=409, detail="A build is already running for this device")

    device.status = devices.BuildStatus.QUEUED
    devices.save_device(device)
    task = asyncio.create_task(asyncio.to_thread(builder.run_build, device))
    _background_builds.add(task)
    task.add_done_callback(_background_builds.discard)
    return {"status": "queued"}


@app.get("/api/devices/{device_id}/manifest.json")
def api_device_manifest(device_id: str) -> JSONResponse:
    device = devices.get_device(device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    if device.status != devices.BuildStatus.SUCCESS or not device.firmware_bin:
        raise HTTPException(status_code=409, detail="Firmware has not been built yet")
    manifest = {
        "name": f"ESPectre - {device.config.friendly_name or device.config.name}",
        "version": str(int(device.updated_at)),
        "new_install_prompt_erase": True,
        "builds": [
            {
                "chipFamily": device.chip_family,
                "parts": [{"path": "firmware.bin", "offset": 0}],
            }
        ],
    }
    return JSONResponse(manifest)


@app.get("/api/devices/{device_id}/firmware.bin")
def api_device_firmware(device_id: str) -> FileResponse:
    device = devices.get_device(device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    if device.status != devices.BuildStatus.SUCCESS or not device.firmware_bin:
        raise HTTPException(status_code=409, detail="Firmware has not been built yet")
    path = devices.device_dir(device_id) / device.firmware_bin
    if not path.exists():
        raise HTTPException(status_code=404, detail="Firmware file missing on disk")
    return FileResponse(path, media_type="application/octet-stream", filename="firmware.bin")


@app.get("/api/zones")
def api_list_zones() -> list[dict]:
    return [z.model_dump() for z in zones.list_zones()]


@app.post("/api/zones", status_code=201)
def api_create_zone(payload: dict) -> dict:
    try:
        config = zones.ZoneCreate.model_validate(payload)
    except ValidationError as err:
        raise HTTPException(status_code=422, detail=_validation_detail(err)) from err
    unknown = [d for d in config.device_ids if devices.get_device(d) is None]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown device id(s): {', '.join(unknown)}")
    zone = zones.create_zone(config)
    return zone.model_dump()


@app.get("/api/zones/{zone_id}")
def api_get_zone(zone_id: str) -> dict:
    zone = zones.get_zone(zone_id)
    if zone is None:
        raise HTTPException(status_code=404, detail="Zone not found")
    return zone.model_dump()


@app.patch("/api/zones/{zone_id}")
def api_update_zone(zone_id: str, payload: dict) -> dict:
    zone = zones.get_zone(zone_id)
    if zone is None:
        raise HTTPException(status_code=404, detail="Zone not found")
    try:
        patch = zones.ZoneUpdate.model_validate(payload)
    except ValidationError as err:
        raise HTTPException(status_code=422, detail=_validation_detail(err)) from err
    if patch.device_ids is not None:
        unknown = [d for d in patch.device_ids if devices.get_device(d) is None]
        if unknown:
            raise HTTPException(status_code=422, detail=f"Unknown device id(s): {', '.join(unknown)}")
    zone.apply_update(patch)
    zones.save_zone(zone)
    return zone.model_dump()


@app.delete("/api/zones/{zone_id}", status_code=204)
def api_delete_zone(zone_id: str) -> None:
    if not zones.delete_zone(zone_id):
        raise HTTPException(status_code=404, detail="Zone not found")


@app.get("/api/zones/{zone_id}/state")
async def api_zone_state(zone_id: str) -> dict:
    zone = zones.get_zone(zone_id)
    if zone is None:
        raise HTTPException(status_code=404, detail="Zone not found")

    members = []
    occupied = False
    any_available = False
    for device_id in zone.device_ids:
        device = devices.get_device(device_id)
        if device is None:
            members.append({"device_id": device_id, "name": None, "available": False, "motion": None})
            continue
        state = await _read_device_state(device)
        if state.get("available"):
            any_available = True
            if state.get("motion"):
                occupied = True
        members.append(
            {
                "device_id": device_id,
                "name": device.config.friendly_name or device.config.name,
                **state,
            }
        )
    return {"occupied": occupied, "available": any_available, "members": members}


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    # Single-page app: Home Assistant Ingress serves this behind a per-session
    # token path prefix, and every asset/API call below uses relative (no
    # leading slash) URLs so they resolve under that prefix. A second route
    # like "/devices" would break that resolution (its relative fetches would
    # nest one level too deep), so device management is a tab on this page
    # instead of a separate path — see static/app.js.
    return (STATIC_DIR / "index.html").read_text(encoding="utf-8")
