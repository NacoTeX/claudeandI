"""Renders per-device ESPHome YAML and drives `esphome compile` for it."""

import logging
import subprocess
import threading
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.board_registry import get_board
from app.devices import BuildStatus, Device, config_path, device_dir, save_device

logger = logging.getLogger("espectre_hub.builder")

TEMPLATES_DIR = Path(__file__).parent / "templates"
_env = Environment(
    loader=FileSystemLoader(TEMPLATES_DIR),
    autoescape=select_autoescape(disabled_extensions=("j2",), default=False),
    trim_blocks=True,
    lstrip_blocks=True,
)

# Guards against triggering two concurrent compiles for the same device.
_building: set[str] = set()
_building_lock = threading.Lock()

_LOG_TAIL_CHARS = 20_000


def render_yaml(device: Device) -> str:
    board = get_board(device.config.board)
    template = _env.get_template("espectre.yaml.j2")
    return template.render(
        device_name=device.config.name,
        friendly_name=device.config.friendly_name or device.config.name,
        board=board,
        wifi_ssid=device.config.wifi_ssid,
        wifi_password=device.config.wifi_password,
        wifi_bssid=device.config.wifi_bssid,
        detection_algorithm=device.config.detection_algorithm,
        traffic_generator_rate=device.config.traffic_generator_rate,
        traffic_generator_mode=device.config.traffic_generator_mode,
        segmentation_threshold=device.config.segmentation_threshold,
    )


def try_start_build(device_id: str) -> bool:
    """Returns False if a build for this device is already running."""
    with _building_lock:
        if device_id in _building:
            return False
        _building.add(device_id)
        return True


def _finish_build(device_id: str) -> None:
    with _building_lock:
        _building.discard(device_id)


def _find_factory_bin(build_dir: Path) -> Path | None:
    if not build_dir.exists():
        return None
    candidates = sorted(
        build_dir.rglob("firmware.factory.bin"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return candidates[0] if candidates else None


def run_build(device: Device) -> None:
    """Render config and compile firmware. Runs synchronously — call via a worker thread."""
    ddir = device_dir(device.id)
    ddir.mkdir(parents=True, exist_ok=True)

    device.status = BuildStatus.RUNNING
    device.build_error = None
    device.build_log = ""
    save_device(device)

    try:
        yaml_text = render_yaml(device)
        config_path(device.id).write_text(yaml_text, encoding="utf-8")

        proc = subprocess.run(
            ["esphome", "compile", "--no-logs", str(config_path(device.id))],
            cwd=ddir,
            capture_output=True,
            text=True,
            timeout=1800,
        )
        log = (proc.stdout or "") + (proc.stderr or "")
        device.build_log = log[-_LOG_TAIL_CHARS:]

        if proc.returncode != 0:
            device.status = BuildStatus.ERROR
            device.build_error = f"esphome compile exited with code {proc.returncode}"
            save_device(device)
            return

        firmware = _find_factory_bin(ddir / ".esphome" / "build" / device.config.name)
        if firmware is None:
            device.status = BuildStatus.ERROR
            device.build_error = "Compile succeeded but no firmware.factory.bin was found"
            save_device(device)
            return

        device.firmware_bin = str(firmware.relative_to(ddir))
        device.chip_family = get_board(device.config.board).chip_family
        device.status = BuildStatus.SUCCESS
        save_device(device)
    except subprocess.TimeoutExpired:
        device.status = BuildStatus.ERROR
        device.build_error = "Build timed out after 30 minutes"
        save_device(device)
    except Exception as err:  # noqa: BLE001 - surface any failure to the UI instead of crashing the worker
        logger.exception("Build failed for device %s", device.id)
        device.status = BuildStatus.ERROR
        device.build_error = str(err)
        save_device(device)
    finally:
        _finish_build(device.id)
