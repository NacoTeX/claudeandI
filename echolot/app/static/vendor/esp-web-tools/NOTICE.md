Vendored from [esp-web-tools](https://github.com/esphome/esp-web-tools)
v10.4.0 (`dist/web/`), Apache License 2.0 — see `LICENSE` in this
directory. Bundled locally so device flashing doesn't depend on a
third-party CDN being reachable from the browser running Home Assistant.

To update: `npm pack esp-web-tools@<version>`, then replace the contents
of this directory with the new package's `dist/web/*` (keep relative
filenames as-is — they're referenced by hash from `install-button.js`).
