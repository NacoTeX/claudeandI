"""Known ESP32 board presets for ESPectre firmware builds.

Board ids and ESP-IDF variants follow ESPHome's `esp32:` component syntax;
`chip_family` is the identifier ESP Web Tools expects in a flashing manifest.
Boards are limited to what ESPectre's SETUP.md lists as supported
(https://github.com/francescopace/espectre/blob/main/SETUP.md).
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Board:
    key: str
    label: str
    esphome_board: str
    variant: str | None
    chip_family: str
    experimental: bool = False


BOARDS: dict[str, Board] = {
    b.key: b
    for b in [
        Board("esp32", "ESP32 (classic)", "esp32dev", None, "ESP32"),
        Board("esp32c3", "ESP32-C3", "esp32-c3-devkitm-1", "ESP32C3", "ESP32-C3"),
        Board("esp32c5", "ESP32-C5", "esp32-c5-devkitc-1", "ESP32C5", "ESP32-C5"),
        Board("esp32c6", "ESP32-C6", "esp32-c6-devkitc-1", "ESP32C6", "ESP32-C6"),
        Board("esp32s2", "ESP32-S2 (experimental)", "esp32-s2-saola-1", "ESP32S2", "ESP32-S2", experimental=True),
        Board("esp32s3", "ESP32-S3", "esp32-s3-devkitc-1", "ESP32S3", "ESP32-S3"),
    ]
}


def get_board(key: str) -> Board:
    try:
        return BOARDS[key]
    except KeyError:
        raise ValueError(f"Unknown board '{key}'. Known boards: {', '.join(BOARDS)}") from None
