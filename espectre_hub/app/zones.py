"""Zone registry: named groups of devices, aggregated with OR-logic presence.

Same JSON-file-under-/data pattern as devices.py. Aggregation itself (does
any member device currently see motion?) lives in main.py, since it needs
to call out to Home Assistant per device — this module only owns the
zone -> device_ids grouping.
"""

import json
import threading
import time
import uuid

from pydantic import BaseModel, Field

from app.devices import DATA_DIR

INDEX_PATH = DATA_DIR / "zones.json"

_lock = threading.Lock()


class ZoneCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    device_ids: list[str] = Field(default_factory=list)


class ZoneUpdate(BaseModel):
    name: str | None = None
    device_ids: list[str] | None = None


class Zone(BaseModel):
    id: str
    created_at: float
    updated_at: float
    name: str
    device_ids: list[str] = Field(default_factory=list)

    def apply_update(self, patch: ZoneUpdate) -> None:
        for field, value in patch.model_dump(exclude_unset=True).items():
            setattr(self, field, value)


def _read_index() -> dict[str, dict]:
    if not INDEX_PATH.exists():
        return {}
    return json.loads(INDEX_PATH.read_text(encoding="utf-8"))


def _write_index(index: dict[str, dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = INDEX_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(index, indent=2), encoding="utf-8")
    tmp.replace(INDEX_PATH)


def list_zones() -> list[Zone]:
    with _lock:
        return [Zone.model_validate(v) for v in _read_index().values()]


def get_zone(zone_id: str) -> Zone | None:
    with _lock:
        raw = _read_index().get(zone_id)
        return Zone.model_validate(raw) if raw else None


def create_zone(payload: ZoneCreate) -> Zone:
    now = time.time()
    zone = Zone(id=str(uuid.uuid4()), created_at=now, updated_at=now, **payload.model_dump())
    with _lock:
        index = _read_index()
        index[zone.id] = zone.model_dump()
        _write_index(index)
    return zone


def save_zone(zone: Zone) -> None:
    zone.updated_at = time.time()
    with _lock:
        index = _read_index()
        index[zone.id] = zone.model_dump()
        _write_index(index)


def delete_zone(zone_id: str) -> bool:
    with _lock:
        index = _read_index()
        if zone_id not in index:
            return False
        del index[zone_id]
        _write_index(index)
    return True
