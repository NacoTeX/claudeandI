"""Known ESP32 boards for Echolot firmware builds.

Shaped after ESPectre's own example configurations
(https://github.com/francescopace/espectre/tree/main/examples): the
classic ESP32 is selected by `board:`, every other chip by `variant:`,
and none of them pin a framework version — ESPHome's recommended one is
the right default, and pinning it only produces warnings.

`ble` decides two things at once: whether the generated firmware gets an
`esp32_ble_server` (without which ESPectre's BLE telemetry channel stays
off), and whether the dashboard offers its "Live" button. Keeping that in
one place stops the two from drifting apart.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Board:
    key: str
    label: str
    variant: str | None  # ESP-IDF variant; None for the classic ESP32
    chip_family: str  # what ESP Web Tools calls it in a manifest
    ble: bool
    esphome_board: str | None = None  # only where a board id is needed
    # Not every chip reaches 240MHz — the C3 and C6 top out lower, and
    # asking for more is a hard config error. Values follow ESPectre's
    # per-board examples; None means "leave it to ESPHome".
    cpu_frequency: str | None = None
    experimental: bool = False


BOARDS: dict[str, Board] = {
    b.key: b
    for b in [
        Board("esp32", "ESP32 (classic)", None, "ESP32", True,
              esphome_board="esp32dev", cpu_frequency="240MHz"),
        Board("esp32c3", "ESP32-C3", "ESP32C3", "ESP32-C3", True),
        Board("esp32c5", "ESP32-C5", "ESP32C5", "ESP32-C5", True, cpu_frequency="240MHz"),
        Board("esp32c6", "ESP32-C6", "ESP32C6", "ESP32-C6", True),
        # ESPectre's S2 example ships no BLE server: the S2 has no Bluetooth.
        Board("esp32s2", "ESP32-S2 (experimentell)", "ESP32S2", "ESP32-S2", False,
              cpu_frequency="240MHz", experimental=True),
        Board("esp32s3", "ESP32-S3", "ESP32S3", "ESP32-S3", True, cpu_frequency="240MHz"),
    ]
}


def get_board(key: str) -> Board:
    try:
        return BOARDS[key]
    except KeyError:
        raise ValueError(f"Unbekanntes Board '{key}'. Bekannt sind: {', '.join(BOARDS)}") from None
