# Changelog

## 0.9.1

- Fix: the add-on image would not build at all. `paho-mqtt>=2.1` conflicted
  with ESPHome, which pins `paho-mqtt==1.6.1` exactly, so pip failed with
  ResolutionImpossible before anything was installed. The requirement now
  admits 1.6.x, and the MQTT client works with both paho generations — 2.x
  is asked for its VERSION1 callback API so one set of signatures serves
  both.
- Fix: zone names with umlauts produced entity ids containing the umlaut.
  A zone called "Küche" now becomes `binary_sensor.echolot_kueche` while
  keeping "Küche" as its display name.

## 0.9.0

Phase 5 — the last planned phase.

- **Zones are published to Home Assistant as occupancy sensors** over MQTT
  discovery. Until now a zone existed only inside this add-on: visible in
  its dashboard, but unusable in an automation, on a Home Assistant
  dashboard, or in HomeKit. Each zone now appears as its own
  `binary_sensor` with device class *occupancy*. Deleting a zone retracts
  the discovery message so the entity disappears instead of lingering as
  unavailable, and an unreachable zone publishes nothing rather than a
  confident "clear". Broker credentials come from the Supervisor
  (`services: mqtt:want`), so nothing needs configuring alongside the
  Mosquitto add-on — and without a broker everything else still works.
  Opt out with `mqtt_export: false`.
- **Native Matter was deliberately not implemented.** Matter commissioning
  inside an add-on is a large, fragile undertaking, and once a zone is a
  Home Assistant entity, HA's own HomeKit and Matter bridges export it.
  Publishing entities is the smaller and more reliable path to the same
  goal.
- **Radio-load estimation.** Each device probes the air continuously, so
  its packet rate is a real cost. The device form estimates it per device
  and the overview sums it across all of them, using ESPectre's own
  figure of roughly 9 KB/s at 100 packets/s.
- **Presets** — *Ausgewogen*, *Sparsam*, *Empfindlich*, *Ohne
  Kalibrierung* — replace guessing at four interacting parameters.
  Editing any value drops back to custom.
- Fix: the MQTT publish task kept running after shutdown. Startup and
  shutdown now use FastAPI's `lifespan`, which cancels it properly.

## 0.8.0

- **Renamed from "ESPectre Hub" to "Echolot".** The old name was both dull
  and misleading: it read like an official product of the upstream
  ESPectre project, when this is an independent add-on that merely uses
  it. "Echolot" names the measuring principle instead — locating something
  by reading how waves come back disturbed.
- The add-on slug changed from `espectre_hub` to `echolot`, which
  Home Assistant treats as a **new add-on**: the old one stays installed
  until removed by hand, and its `/data` (devices, zones, built firmware)
  does not carry over.
- References to ESPectre itself are untouched — it is still the ESPHome
  component this builds on, and the generated firmware config still pulls
  `github://francescopace/espectre`.

## 0.7.0

- The web interface is now in German throughout — labels, buttons, status
  text, validation messages and the error details the backend returns to
  the UI. Code comments, commit messages and this changelog stay in
  English, as does the project documentation, since the repository is
  public.
- Added the add-on `icon.png` and `logo.png` that were missing, so the
  Supervisor store no longer shows a placeholder, plus a matching favicon
  for the web interface.
- The Overview tab gained an inventory card (how many devices, how many
  built, how many zones) instead of only reporting service health.
- Movement scores now render with the same precision everywhere.

## 0.6.0

- Dashboard rethought around the question it should answer: **is the
  threshold in the right place, and is the signal steady?** Each device
  tile now charts its movement score over time with the detection
  threshold drawn across it, replacing a status dot that showed less
  than the Devices tab did.
- Charts open pre-filled from Home Assistant's recorded history via a new
  `GET /api/devices/{id}/history` endpoint, so the view is useful
  immediately instead of building up from an empty buffer.
- One chart, two sources: connecting over BLE re-feeds the same chart at
  the device's native ~10-50ms rate instead of driving a separate bar,
  which is what makes the high resolution actually useful.
- Zone tiles now show which member device is tripping, not just a count.
- Board type dropped from dashboard tiles (configuration detail, not live
  state) and the Web Bluetooth notice is a quiet aside rather than a
  full-width banner.
- Dashboard polling now only runs while that tab is on screen.

## 0.5.0

- UI reworked into one consistent design system rather than a glass
  dashboard bolted onto flat management tabs:
  - Real light **and** dark themes. The stylesheet previously claimed
    `color-scheme: light dark` while hardcoding dark colours, so in light
    mode the browser rendered native controls light against dark panels.
  - An atmospheric background so the frosted-glass surfaces actually have
    something to refract — `backdrop-filter` over a flat fill blurred
    nothing.
  - One scale for radii, one set of glass elevations, three button roles
    (primary / secondary / ghost), a single input style, keyboard focus
    rings, hover states, and `prefers-reduced-motion` support.
  - Tabs are now a segmented control; live readings render as labelled
    stat blocks instead of one crowded line.
- Fix: in the zone form, device checkboxes stacked on top of their labels
  — `.zone-device-option` inherited `flex-direction: column` from
  `.device-form label` and lacked the specificity to override it.
- Fix: "Flash over USB" dropped onto its own row below the other actions;
  it now sits in the action bar, and once a device is built it becomes the
  primary action while "Rebuild" steps down to secondary.
- Dashboard tiles are grouped under Devices/Zones headings — the two were
  previously indistinguishable.
- Repository URLs updated after the repo was renamed.

## 0.4.1

- Fix: firmware builds failed immediately with
  `esphome: error: unrecognized arguments: --no-logs`. That flag only
  exists on ESPHome's `run` subcommand, not on `compile`.

## 0.4.0

- Phase 4: live dashboard and optional high-resolution BLE visualizer.
  - New "Dashboard" tab: a glass-tile view of every device and zone at a
    glance, status dots polled from Home Assistant (same as Devices/Zones).
  - Optional per-device "Connect live (BLE)" button on BLE-capable boards
    (ESP32, C3, C5, C6, S3 — not S2) opens a direct Web Bluetooth
    connection to the device itself (no backend involved) for movement/
    threshold telemetry at ESPectre's native ~10-50ms notify rate, using
    the GATT protocol documented in ESPectre's own browser game client
    (service `d33ff46b-…`, little-endian float32 telemetry, ASCII control
    commands) — see `echolot/DOCS.md`.
  - This BLE path is implemented strictly to that documented spec and its
    binary/text parsing is unit-verified, but the live device connection
    itself has not been exercised against real ESPectre hardware — no
    Bluetooth-capable browser or device was available to test with. The
    polling-based dashboard tiles remain the verified fallback.

## 0.3.0

- Phase 3: zones and runtime configuration.
  - New "Zones" tab: group devices, aggregated with OR-logic presence
    (`GET /api/zones/{id}/state` — occupied if any member currently sees
    motion). Backed by `POST/GET/PATCH/DELETE /api/zones[/{id}]`.
  - Each built device now shows live motion/movement-score state, a
    threshold control (`POST /api/devices/{id}/threshold`, backed by HA's
    `number.set_value`), and a "Recalibrate" button (`.../calibrate`,
    backed by `switch.turn_on`) — all read/written through Home
    Assistant's Core API (`homeassistant_api: true`), since ESPectre
    already exposes these as HA entities.
  - `detection_algorithm` (mvs/ml) is a compile-time YAML option, not a
    runtime entity ESPectre exposes — changing it still means a rebuild
    and reflash on the Devices tab, not a Zones-tab control.
  - Best-guess HA entity ids are computed per device from its name and
    are user-editable ("HA entity ids" panel), since the exact id HA
    assigns isn't guaranteed.

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
