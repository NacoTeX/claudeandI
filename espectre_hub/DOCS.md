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

This add-on is at **Phase 1**: it establishes the add-on skeleton — a
FastAPI backend served through Home Assistant Ingress, with the ESPHome
CLI bundled in the container (used in later phases to compile per-device
firmware). The web UI currently just reports backend and ESPHome health.

Device flashing, zone configuration, and the live dashboard are not
implemented yet — see the repository README for the full roadmap.

## Support

This is a personal/community project, not affiliated with TOMMY or
ESPectre's upstream maintainers. File issues against this repository.
