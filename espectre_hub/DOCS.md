# ESPectre Hub

Self-hosted Wi-Fi CSI presence detection hub, built on
[ESPectre](https://github.com/francescopace/espectre) — an open-source,
license-free alternative to [TOMMY](https://www.tommysense.com).

## Installation

1. Add this repository to the Home Assistant Add-on Store
   (**Settings → Add-ons → Add-on Store → ⋮ → Repositories**).
2. Find **ESPectre Hub** in the store and click **Install**.
3. Start the add-on and open its web UI (Ingress panel in the sidebar).

## Configuration

| Option      | Description                                              |
|-------------|------------------------------------------------------------|
| `log_level` | Verbosity of the add-on's own log output. One of `trace`, `debug`, `info`, `notice`, `warning`, `error`, `fatal`. |

## Current phase

This add-on is at **Phase 3**: zones and runtime configuration, on top of
Phase 1 (add-on skeleton) and Phase 2 (device flashing).

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

The live dashboard/visualizer is not implemented yet — see the
repository README for the full roadmap.

## Support

This is a personal/community project, not affiliated with TOMMY or
ESPectre's upstream maintainers. File issues against this repository.
