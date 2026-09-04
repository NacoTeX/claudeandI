"""Ready-made parameter sets, so a new device doesn't start with a blank
form and four numbers whose trade-offs aren't obvious.

The traffic-rate constant comes from ESPectre's own SETUP.md, which puts
the default 100 packets/s at roughly 9 KB/s per device.
"""

from dataclasses import asdict, dataclass

# KB/s of Wi-Fi traffic each packet-per-second of CSI probing costs.
KB_PER_SECOND_PER_PPS = 0.09


@dataclass(frozen=True)
class Preset:
    key: str
    label: str
    description: str
    traffic_generator_rate: int
    detection_algorithm: str
    segmentation_threshold: str


PRESETS: tuple[Preset, ...] = (
    Preset(
        key="balanced",
        label="Ausgewogen",
        description="ESPectres Standardwerte — guter Kompromiss aus Empfindlichkeit und Netzlast.",
        traffic_generator_rate=100,
        detection_algorithm="mvs",
        segmentation_threshold="auto",
    ),
    Preset(
        key="quiet",
        label="Sparsam",
        description="Weniger als die Hälfte der Funklast. Erkennt deutliche Bewegung zuverlässig, feine Regungen eher nicht.",
        traffic_generator_rate=40,
        detection_algorithm="mvs",
        segmentation_threshold="auto",
    ),
    Preset(
        key="sensitive",
        label="Empfindlich",
        description="Doppelte Abtastrate und niedrigste Schwelle für kleinste Regungen — dafür spürbar mehr Funklast.",
        traffic_generator_rate=200,
        detection_algorithm="mvs",
        segmentation_threshold="min",
    ),
    Preset(
        key="no_calibration",
        label="Ohne Kalibrierung",
        description="Neuronales Netz statt Varianzanalyse: kein Einlernen nach dem Start, feste Subcarrier.",
        traffic_generator_rate=100,
        detection_algorithm="ml",
        segmentation_threshold="auto",
    ),
)


def as_dicts() -> list[dict]:
    return [asdict(p) for p in PRESETS]


def estimate_kb_per_second(rate: int) -> float:
    return round(rate * KB_PER_SECOND_PER_PPS, 2)
