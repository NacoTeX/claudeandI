"""Device registry: persisted metadata + build state for ESPectre devices.

Backed by a single JSON file under the add-on's persistent /data directory
(a plain file is plenty for the handful of devices a home setup has, and
keeps this phase free of a database dependency).
"""

import json
import os
import re
import threading
import time
import uuid
from enum import StrEnum
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.board_registry import get_board

DATA_DIR = Path(os.environ.get("ECHOLOT_DATA_DIR", "/data"))
DEVICES_DIR = DATA_DIR / "devices"
INDEX_PATH = DATA_DIR / "devices.json"

_NAME_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$")

_lock = threading.Lock()


class BuildStatus(StrEnum):
    IDLE = "idle"
    QUEUED = "queued"
    RUNNING = "running"
    SUCCESS = "success"
    ERROR = "error"


class DeviceCreate(BaseModel):
    name: str = Field(..., description="ESPHome node name (lowercase, digits, hyphens)")
    friendly_name: str | None = None
    board: str
    wifi_ssid: str = Field(..., min_length=1, max_length=32)
    wifi_password: str = Field(default="", max_length=64)
    wifi_bssid: str | None = None
    detection_algorithm: Literal["mvs", "ml"] = "mvs"
    traffic_generator_rate: int = Field(default=100, ge=0, le=1000)
    traffic_generator_mode: Literal["ping", "dns"] = "ping"
    segmentation_threshold: str = "auto"

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        if not _NAME_RE.match(v):
            raise ValueError(
                "name must be lowercase alphanumeric with hyphens, "
                "start/end with a letter or digit (max 32 chars)"
            )
        return v

    @field_validator("board")
    @classmethod
    def _validate_board(cls, v: str) -> str:
        get_board(v)  # raises ValueError if unknown
        return v

    @field_validator("wifi_password")
    @classmethod
    def _validate_password(cls, v: str) -> str:
        if v and len(v) < 8:
            raise ValueError("wifi_password must be empty (open network) or at least 8 characters")
        return v

    @field_validator("segmentation_threshold")
    @classmethod
    def _validate_threshold(cls, v: str) -> str:
        if v in ("auto", "min"):
            return v
        try:
            f = float(v)
        except ValueError:
            raise ValueError('segmentation_threshold must be "auto", "min", or a number 0.0-10.0') from None
        if not (0.0 <= f <= 10.0):
            raise ValueError("segmentation_threshold must be between 0.0 and 10.0")
        return v


def default_entity_ids(device_name: str) -> dict[str, str]:
    """Best-guess HA entity ids for the entities ESPectre's SETUP.md documents,
    following ESPHome's default object_id derivation (device name + slugified
    entity name). Editable per-device since naming can drift — a manual
    `id:`/`name:` override in the YAML, an entity_id collision suffix HA
    added, etc.
    """
    slug = device_name.replace("-", "_")
    return {
        "entity_motion": f"binary_sensor.{slug}_motion_detected",
        "entity_movement_score": f"sensor.{slug}_movement_score",
        "entity_threshold": f"number.{slug}_threshold",
        "entity_calibrate": f"switch.{slug}_calibrate",
    }


class DeviceUpdate(BaseModel):
    """Partial update for fields that don't require a rebuild/reflash."""

    friendly_name: str | None = None
    entity_motion: str | None = None
    entity_movement_score: str | None = None
    entity_threshold: str | None = None
    entity_calibrate: str | None = None


class Device(BaseModel):
    id: str
    created_at: float
    updated_at: float
    config: DeviceCreate
    status: BuildStatus = BuildStatus.IDLE
    build_log: str = ""
    build_error: str | None = None
    firmware_bin: str | None = None  # path relative to the device dir, once built
    chip_family: str | None = None
    # Best-guess Home Assistant entity ids for ESPectre's exposed entities
    # (see default_entity_ids); user-editable in case the guess is wrong.
    entity_motion: str | None = None
    entity_movement_score: str | None = None
    entity_threshold: str | None = None
    entity_calibrate: str | None = None

    def public(self) -> dict:
        """Serialize with the Wi-Fi password masked."""
        data = self.model_dump()
        data["config"]["wifi_password"] = "********" if self.config.wifi_password else ""
        return data

    def apply_update(self, patch: DeviceUpdate) -> None:
        for field, value in patch.model_dump(exclude_unset=True).items():
            if field == "friendly_name":
                self.config.friendly_name = value
            else:
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


def list_devices() -> list[Device]:
    with _lock:
        return [Device.model_validate(v) for v in _read_index().values()]


def get_device(device_id: str) -> Device | None:
    with _lock:
        raw = _read_index().get(device_id)
        return Device.model_validate(raw) if raw else None


def create_device(payload: DeviceCreate) -> Device:
    now = time.time()
    device = Device(
        id=str(uuid.uuid4()),
        created_at=now,
        updated_at=now,
        config=payload,
        **default_entity_ids(payload.name),
    )
    with _lock:
        index = _read_index()
        index[device.id] = device.model_dump()
        _write_index(index)
    device_dir(device.id).mkdir(parents=True, exist_ok=True)
    return device


def save_device(device: Device) -> None:
    device.updated_at = time.time()
    with _lock:
        index = _read_index()
        index[device.id] = device.model_dump()
        _write_index(index)


def delete_device(device_id: str) -> bool:
    with _lock:
        index = _read_index()
        if device_id not in index:
            return False
        del index[device_id]
        _write_index(index)
    return True


def device_dir(device_id: str) -> Path:
    return DEVICES_DIR / device_id


def config_path(device_id: str) -> Path:
    return device_dir(device_id) / "config.yaml"
