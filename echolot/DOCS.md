# Echolot

Self-hosted Wi-Fi CSI presence detection hub, built on
[ESPectre](https://github.com/francescopace/espectre) — an open-source,
license-free alternative to [TOMMY](https://www.tommysense.com).

## Installation

1. Add this repository to the Home Assistant Add-on Store
   (**Settings → Add-ons → Add-on Store → ⋮ → Repositories**).
2. Find **Echolot** in the store and click **Install**.
3. Start the add-on and open its web UI (Ingress panel in the sidebar).

## Configuration

| Option        | Description |
|---------------|-------------|
| `log_level`   | Verbosity of the add-on's own log output. One of `trace`, `debug`, `info`, `notice`, `warning`, `error`, `fatal`. |
| `mqtt_export` | Publish zones to Home Assistant as occupancy sensors over MQTT (default `true`). Needs an MQTT broker such as the Mosquitto add-on; without one the add-on runs normally and zones simply stay local to this interface. |

## Current phase

All five planned phases are implemented: add-on skeleton, device
flashing, zones and runtime configuration, the live dashboard, and the
Phase 5 polish (traffic estimation, presets, zone export).

### Flashing a device

1. Open the add-on's web UI and switch to the **Devices** tab.
2. Fill in the form: a device name, board, Wi-Fi network, and (optionally)
   the ESPectre detection algorithm/threshold. Wi-Fi credentials are baked
   into that device's compiled firmware.
3. Click **Build firmware**. This renders an ESPHome YAML for the device
   and runs `esphome compile` in the container — the first build per board
   downloads the ESP-IDF toolchain, so it can take several minutes;
   watch progress in the build log.
4. Once the card shows "ready to flash", connect the device over USB and
   click **Flash over USB**. This uses [ESP Web Tools](https://esphome.github.io/esp-web-tools/)
   and your browser's Web Serial API — supported in Chrome/Edge, and only
   on secure (HTTPS) pages or `localhost`. If Home Assistant is only
   reachable over plain HTTP on your LAN, open the add-on directly at
   `http://<host>:8099` from the same machine you're flashing from.

### Live state and runtime configuration

Once a device is built (it doesn't need to be reflashed for this — the
firmware from step 3 already includes it), its card also shows live
motion/movement-score state, a **threshold** control, and a
**Recalibrate** button. These are read and pushed through Home
Assistant's own Core API (this add-on requests `homeassistant_api: true`
for that), targeting the `binary_sensor`/`sensor`/`number`/`switch`
entities ESPectre's ESPHome component already exposes for each device —
so the device needs to actually be added to Home Assistant (normally
auto-discovered via the ESPHome integration once it's on your network)
for this to work; a freshly flashed device that HA hasn't picked up yet
will show as "unavailable".

The entity ids used are guessed from the device's name and shown (and
editable) under "HA entity ids" on its card — open that if a device
shows as unavailable and check the ids match what Home Assistant
actually assigned.

Note: the `mvs`/`ml` detection algorithm choice is **not** one of these
runtime entities — ESPectre only exposes it as a compile-time YAML
option, so changing it means rebuilding and reflashing on the Devices
tab, not a Zones-tab control.

### Zones

The **Zones** tab groups devices and reports "occupied" when *any*
member device currently detects motion (OR-logic — the simplest form of
the zone/topology aggregation TOMMY offers). Create a zone, tick which
devices belong to it, and its card polls live state the same way device
cards do.

### Dashboard

The **Dashboard** tab shows every device and zone as a tile. Each device
tile plots its **movement score over time with the detection threshold
drawn across it** — that is the view that tells you whether the threshold
sits in a sensible place and whether the signal is steady or flickering,
which a bare on/off indicator cannot.

The chart opens pre-filled from Home Assistant's recorded history (the
last 30 minutes, if the recorder keeps that entity) and then keeps
extending live, so it is useful the moment you open the tab rather than
starting blank. Below it sit the current score and threshold; zone tiles
highlight *which* member device is currently tripping.

On BLE-capable boards (ESP32, C3, C5, C6, S3 — **not** S2, which ESPectre's
BLE channel doesn't support), a device tile also has a **Live** button.
It opens a direct Web Bluetooth connection from your browser straight to
the device — no add-on backend involved — using the same GATT protocol
ESPectre's own browser-based "game" client uses (`docs/game/README.md` in
the [ESPectre repo](https://github.com/francescopace/espectre)). The same
chart then redraws from that stream at roughly the device's native
~10-50ms rate instead of the ~5s polling, which is what makes fine
threshold tuning practical. This needs:

- **Chrome, Edge, or Opera** — Web Bluetooth isn't implemented in Firefox
  or Safari; the tab shows a notice and falls back to polling there.
- The page served over **HTTPS or `localhost`**, same Web Serial/Web
  Bluetooth secure-context restriction as flashing (see above).
- The device powered on and in BLE range: your browser's own device
  picker opens when you click "Live" — its behavior isn't something this
  add-on controls.

Disconnecting (or navigating away) puts the chart back on the polled
feed.

### Zones in Home Assistant

Zones would otherwise exist only inside this add-on — visible here, but
unusable in an automation, on a Home Assistant dashboard, or in HomeKit.
With an MQTT broker available (the Mosquitto add-on is the usual one),
each zone is published via MQTT discovery and appears as its own
`binary_sensor` with device class *occupancy*, named after the zone.

From there Home Assistant's own HomeKit and Matter bridges can export it
further. That is deliberately how this works instead of speaking Matter
directly: implementing Matter commissioning inside an add-on is a large,
fragile undertaking, while Home Assistant already does it well for any
entity it knows about.

Deleting a zone retracts its discovery message, so the entity disappears
rather than lingering as "unavailable". If a zone's devices can't be
reached, no state is published at all — Home Assistant then keeps the
last known value instead of being told a confident "clear".

The **Übersicht** tab shows whether the export is active, and why not if
it isn't. Set `mqtt_export: false` in the add-on options to turn it off.

### Presets and radio load

Every device probes the air continuously, so its packet rate is a real
cost: at the default 100 packets/s a device generates roughly 9 KB/s of
Wi-Fi traffic (figure from ESPectre's own SETUP.md). The device form
estimates this per device, and the **Übersicht** tab sums it across all
of them — worth a glance before adding the fifth sensor.

The **Voreinstellung** picker offers four starting points instead of
four interacting numbers to guess at: *Ausgewogen* (ESPectre's
defaults), *Sparsam* (less than half the radio load), *Empfindlich*
(double the sampling and the lowest threshold), and *Ohne Kalibrierung*
(the neural-network algorithm, which needs no settling period). Editing
any of the values leaves the preset and switches to custom.

## Support

This is a personal/community project, not affiliated with TOMMY or
ESPectre's upstream maintainers. File issues against this repository.
