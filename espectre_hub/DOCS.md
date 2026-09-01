# ESPectre Hub

Self-hosted Wi-Fi CSI presence detection hub, built on
[ESPectre](https://github.com/latonita/espectre) — an open-source,
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

This add-on is at **Phase 2**: device management and browser-based
flashing, on top of the Phase 1 skeleton (Ingress UI, bundled ESPHome CLI).

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

Zone configuration and the live dashboard are not implemented yet — see
the repository README for the full roadmap.

## Support

This is a personal/community project, not affiliated with TOMMY or
ESPectre's upstream maintainers. File issues against this repository.
