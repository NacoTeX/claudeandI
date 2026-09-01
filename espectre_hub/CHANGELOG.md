# Changelog

## 0.2.0

- Phase 2: device management and browser-based flashing.
  - `POST /api/devices` renders a per-device ESPHome + ESPectre YAML
    (name, Wi-Fi credentials, board, detection algorithm/threshold) from
    a Jinja2 template and validates it with Pydantic.
  - `POST /api/devices/{id}/build` compiles it via the bundled `esphome`
    CLI in a background thread; `GET /api/devices/{id}` polls status/log.
  - `GET /api/devices/{id}/manifest.json` + `.../firmware.bin` expose the
    compiled image as an ESP Web Tools manifest for one-click USB flashing
    from the browser (Web Serial API — needs HTTPS or localhost).
  - `esp-web-tools` is vendored locally (`app/static/vendor/esp-web-tools`,
    Apache-2.0) rather than loaded from a CDN.
  - New "Devices" tab in the Ingress UI for adding, building, and
    flashing devices.

## 0.1.0

- Phase 1: initial add-on skeleton — Ingress-enabled FastAPI backend,
  bundled ESPHome CLI dependency, basic health-check UI.
