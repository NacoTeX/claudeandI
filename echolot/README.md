# Echolot

Wi-Fi CSI presence detection for Home Assistant, self-hosted and
license-free. Echolot compiles per-device [ESPectre][espectre] firmware,
flashes it from the browser, groups devices into zones, and publishes those
zones back to Home Assistant as occupancy sensors.

It exists because the commercial alternative in this space is closed
source, and a presence sensor that decides whether your lights turn on
should not be.

## What it does

**Devices.** Pick a board, enter Wi-Fi credentials, press build. Echolot
renders an ESPHome configuration, compiles it, and serves the result as an
[ESP Web Tools][ewt] manifest, so flashing happens over USB straight from
Chrome or Edge — no toolchain on your machine. Later updates go over the
network instead, from any browser.

**Zones.** A zone is a group of devices with one presence state. Raw
OR-logic reacts instantly and drops out just as instantly, so zones also
carry a hold time and optional enter/exit thresholds — see [DOCS.md](DOCS.md).

**Dashboard.** Each device plots its movement score against its detection
threshold, pre-filled from Home Assistant's recorder. On BLE-capable boards
a browser can subscribe to the device's telemetry directly for a 40 ms
live view.

## Installing

Add this repository in Home Assistant under **Settings → Add-ons → Add-on
Store → ⋮ → Repositories**:

```
https://github.com/NacoTeX/claudeandI
```

Then install **Echolot** and start it. The interface lives in the sidebar.

Requires a 64-bit Home Assistant OS or Supervised install (aarch64 or
amd64). Espressif ships no ESP-IDF toolchain for 32-bit hosts, so armv7 is
not supported.

The first firmware build downloads roughly 2 GB of ESP-IDF and cross
toolchain into `/data/platformio`, where it stays for subsequent builds.

## Documentation

- [DOCS.md](DOCS.md) — configuration, zones, dashboard, troubleshooting
- [CHANGELOG.md](CHANGELOG.md) — what changed, and why

## Developing

```sh
pip install -r app/requirements.txt -r requirements-dev.txt
python -m pytest tests -q          # unit tests
python tools/validate_firmware.py  # every board through `esphome config`
python tools/check_metadata.py     # add-on manifest sanity
```

All three run in CI on every pull request.

## Licence

GPL-3.0-or-later, matching ESPectre, whose component this builds on.

[espectre]: https://github.com/francescopace/espectre
[ewt]: https://esphome.github.io/esp-web-tools/
