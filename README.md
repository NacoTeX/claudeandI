# ESPectre Hub

A self-hosted, license-free alternative to [TOMMY](https://www.tommysense.com) —
a Wi-Fi CSI (Channel State Information) presence detection system for Home
Assistant.

TOMMY is a closed-source, lifetime-license product built on ESP32 hardware.
This project provides the same core idea (detect motion/presence by
measuring how bodies disturb Wi-Fi signals between a router and a cheap
ESP32 sensor — no wearable or phone required) as an open-source Home
Assistant add-on, built on top of [ESPectre](https://github.com/latonita/espectre)
(GPLv3), which already exposes a native ESPHome component for CSI-based
presence sensing.

## Why

TOMMY's approach is proprietary: closed firmware core, per-device lifetime
license, cloud-adjacent tooling. ESPectre implements the same CSI-sensing
principle as an open ESPHome component. This add-on wraps ESPectre with the
device-management, zone/topology, and dashboard tooling that TOMMY provides
out of the box, so you get comparable functionality without a license.

## Project status

This is being built in phases. See [`espectre_hub/DOCS.md`](espectre_hub/DOCS.md)
for add-on installation instructions.

- [x] **Phase 1 — Add-on skeleton.** HAOS add-on with a Python (FastAPI)
      backend, Ingress-enabled web UI, and ESPHome bundled as an in-container
      dependency (verified via an `/api/esphome/version` health check).
- [ ] **Phase 2 — Device flashing.** Browser-based flashing via ESP Web
      Tools (Web Serial API), with the backend compiling a per-device
      ESPectre YAML (name, Wi-Fi credentials, algorithm parameters) into a
      `.bin` on demand.
- [ ] **Phase 3 — Zones & configuration.** UI for grouping devices into
      zones, presence aggregation (starting with simple OR-logic, later
      full topology), and pushing runtime parameters (threshold,
      `mvs`/`ml` algorithm choice) to devices via the HA entities ESPectre
      already exposes.
- [ ] **Phase 4 — Dashboard/visualizer.** Live view of all devices and
      zones; optional use of ESPectre's BLE telemetry channel for
      higher-resolution (40ms) visualization.
- [ ] **Phase 5 — Polish.** Airtime estimation, presets, optional Matter
      export.

## Installing this add-on repository

In Home Assistant: **Settings → Add-ons → Add-on Store → ⋮ → Repositories**,
then add this repository's URL. The **ESPectre Hub** add-on will then be
available to install.

## License

ESPectre itself is GPLv3-licensed. This project, as a derivative work built
around it, is also released under GPLv3 — see [`LICENSE`](LICENSE).
