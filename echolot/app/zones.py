"""Zone registry: named groups of devices with their presence tuning.

Same JSON-file-under-/data pattern as devices.py. This module owns the
zone -> device_ids grouping and the tuning knobs; the state machine that
turns member readings into a presence state lives in zone_logic.py, and
main.py wires the two together because it is the part that can talk to
Home Assistant.
"""

import json
import threading
import time
import uuid

from pydantic import BaseModel, Field, model_validator

from app.devices import DATA_DIR

INDEX_PATH = DATA_DIR / "zones.json"

_lock = threading.Lock()


#: Seconds a zone stays occupied after the last movement. Anything above a
#: few minutes is almost certainly a mistake, so the field is bounded.
HOLD_SECONDS_MAX = 3600.0


class ZoneTuning(BaseModel):
    """Presence tuning shared by create, update and the stored model.

    `enter_threshold` left at None means "trust each device's own motion
    sensor" — the ESPectre node already applies its threshold on-device.
    Setting it switches the zone to score-based detection; adding
    `exit_threshold` below it adds hysteresis.
    """

    hold_seconds: float = Field(default=0.0, ge=0.0, le=HOLD_SECONDS_MAX)
    enter_threshold: float | None = Field(default=None, ge=0.0)
    exit_threshold: float | None = Field(default=None, ge=0.0)

    @model_validator(mode="after")
    def _check_thresholds(self) -> "ZoneTuning":
        if self.exit_threshold is not None and self.enter_threshold is None:
            raise ValueError(
                "Ein Ausschalt-Schwellwert ergibt nur zusammen mit einem "
                "Einschalt-Schwellwert Sinn"
            )
        if (
            self.enter_threshold is not None
            and self.exit_threshold is not None
            and self.exit_threshold > self.enter_threshold
        ):
            raise ValueError(
                "Der Ausschalt-Schwellwert muss kleiner oder gleich dem "
                "Einschalt-Schwellwert sein"
            )
        return self


class ZoneCreate(ZoneTuning):
    name: str = Field(..., min_length=1, max_length=64)
    device_ids: list[str] = Field(default_factory=list)


class ZoneUpdate(BaseModel):
    name: str | None = None
    device_ids: list[str] | None = None
    hold_seconds: float | None = Field(default=None, ge=0.0, le=HOLD_SECONDS_MAX)
    enter_threshold: float | None = Field(default=None, ge=0.0)
    exit_threshold: float | None = Field(default=None, ge=0.0)


class Zone(ZoneTuning):
    id: str
    created_at: float
    updated_at: float
    name: str
    device_ids: list[str] = Field(default_factory=list)

    def apply_update(self, patch: ZoneUpdate) -> None:
        """Apply a partial update, re-running validation on the result.

        Plain setattr would slip past the enter/exit consistency check —
        lowering `enter_threshold` alone could leave `exit_threshold`
        stranded above it. Rebuilding the model makes the invariant hold
        for updates the same way it holds for creates.
        """
        merged = {**self.model_dump(), **patch.model_dump(exclude_unset=True)}
        validated = Zone.model_validate(merged)
        for field in validated.model_fields:
            setattr(self, field, getattr(validated, field))


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
