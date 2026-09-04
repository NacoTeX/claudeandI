#!/usr/bin/env python3
"""Check the add-on's metadata against what the Supervisor actually requires.

These files are only read by the Supervisor, at install time, on someone
else's machine — a typo here surfaces as an add-on that refuses to appear,
with no local signal at all. The checks below are the ones that would have
caught real mistakes: an arch we cannot build for, a version that does not
move, an ingress port that disagrees with the code.
"""

import re
import sys
from pathlib import Path

import yaml

ADDON = Path(__file__).resolve().parents[1]
REPO = ADDON.parent

# Espressif ships ESP-IDF toolchains for 64-bit hosts only; the official
# ESPHome add-on lists the same two.
SUPPORTED_ARCH = {"aarch64", "amd64"}
INGRESS_PORT = 8099


def main() -> int:
    problems: list[str] = []

    config = yaml.safe_load((ADDON / "config.yaml").read_text(encoding="utf-8"))
    build = yaml.safe_load((ADDON / "build.yaml").read_text(encoding="utf-8"))
    yaml.safe_load((REPO / "repository.yaml").read_text(encoding="utf-8"))

    for key in ("name", "version", "slug", "description", "arch"):
        if not config.get(key):
            problems.append(f"config.yaml is missing '{key}'")

    version = str(config.get("version", ""))
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        problems.append(f"config.yaml version '{version}' is not MAJOR.MINOR.PATCH")

    arches = set(config.get("arch") or [])
    if unsupported := arches - SUPPORTED_ARCH:
        problems.append(
            f"config.yaml promises {sorted(unsupported)}, which has no ESP-IDF toolchain"
        )
    if missing := arches - set(build.get("build_from") or {}):
        problems.append(f"build.yaml has no base image for {sorted(missing)}")
    if extra := set(build.get("build_from") or {}) - arches:
        problems.append(f"build.yaml builds {sorted(extra)}, which config.yaml does not offer")

    if config.get("ingress") and config.get("ingress_port") != INGRESS_PORT:
        problems.append(
            f"ingress_port is {config.get('ingress_port')} but the app serves {INGRESS_PORT}"
        )

    # The changelog has to carry the version being shipped, or users
    # updating see release notes for something else.
    changelog = (ADDON / "CHANGELOG.md").read_text(encoding="utf-8")
    if f"## {version}" not in changelog:
        problems.append(f"CHANGELOG.md has no '## {version}' section")

    # Every option must have a schema entry, or the Supervisor drops it.
    options = set(config.get("options") or {})
    schema = set(config.get("schema") or {})
    if unschemad := options - schema:
        problems.append(f"options without a schema entry: {sorted(unschemad)}")
    if unoffered := schema - options:
        problems.append(f"schema entries with no default: {sorted(unoffered)}")

    # Translations are optional, but a half-translated option list is worse
    # than none: the untranslated ones show as raw keys.
    translations = ADDON / "translations" / "en.yaml"
    if translations.exists():
        loaded = yaml.safe_load(translations.read_text(encoding="utf-8")) or {}
        translated = set((loaded.get("configuration") or {}))
        if untranslated := options - translated:
            problems.append(f"translations/en.yaml is missing: {sorted(untranslated)}")

    for problem in problems:
        print(f"  FAIL {problem}")
    if problems:
        print(f"\n{len(problems)} metadata problem(s)")
        return 1
    print(f"Add-on metadata OK (version {version}, arch {sorted(arches)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
