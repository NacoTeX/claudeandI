#!/usr/bin/env python3
"""Render the firmware template for every board and validate it with ESPHome.

Three bugs reached a release because the generated YAML was only ever read,
never validated: `ota: platform: esp32` (no such platform), `cpu_frequency:
240MHz` on chips that top out lower, and a missing `esp32_ble_server` that
left the BLE telemetry channel permanently off. `esphome config` catches
all three in seconds, so CI runs it over every board on every change.

Run from anywhere: `python echolot/tools/validate_firmware.py`
"""

import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))


def main() -> int:
    workdir = Path(tempfile.mkdtemp(prefix="echolot-cfgcheck-"))
    # devices.py resolves its data directory at import time.
    import os

    os.environ.setdefault("ECHOLOT_DATA_DIR", str(workdir / "data"))

    from app.board_registry import BOARDS
    from app.builder import render_yaml
    from app.devices import Device, DeviceCreate

    # Every board, plus one with the optional blocks switched off — those
    # branches are otherwise never exercised.
    cases = [(key, True, True) for key in BOARDS]
    cases.append(("esp32c6", False, False))

    failures = []
    for board, web, diag in cases:
        name = f"probe-{board}" + ("" if web and diag else "-minimal")
        device = Device(
            id=name,
            created_at=0,
            updated_at=0,
            config=DeviceCreate(
                name=name,
                friendly_name=f"Probe {board}",
                board=board,
                wifi_ssid="testnetz",
                wifi_password="passwort123",
                web_server=web,
                diagnostics=diag,
            ),
        )
        path = workdir / f"{name}.yaml"
        path.write_text(render_yaml(device), encoding="utf-8")

        result = subprocess.run(
            ["esphome", "config", str(path)],
            capture_output=True,
            text=True,
            cwd=workdir,
        )
        label = f"{board:9s} web_server={int(web)} diagnostics={int(diag)}"
        if result.returncode == 0:
            print(f"  ok   {label}")
        else:
            failures.append(label)
            print(f"  FAIL {label}")
            tail = (result.stderr or result.stdout).strip().splitlines()[-20:]
            print("\n".join(f"       {line}" for line in tail))

    print()
    if failures:
        print(f"{len(failures)} of {len(cases)} configurations failed to validate")
        return 1
    print(f"All {len(cases)} configurations validate")
    return 0


if __name__ == "__main__":
    sys.exit(main())
