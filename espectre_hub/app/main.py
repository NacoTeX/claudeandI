"""ESPectre Hub backend.

Phase 1: add-on skeleton. Serves the Ingress web UI and exposes health /
ESPHome-availability checks. Device flashing and zone management land in
later phases.
"""

import logging
import subprocess
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("espectre_hub")

STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="ESPectre Hub")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/esphome/version")
def esphome_version() -> dict:
    """Confirm the bundled ESPHome CLI is usable (needed for later firmware builds)."""
    try:
        result = subprocess.run(
            ["esphome", "version"],
            capture_output=True,
            text=True,
            timeout=15,
            check=True,
        )
        return {"available": True, "version": result.stdout.strip()}
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as err:
        logger.warning("esphome CLI check failed: %s", err)
        return {"available": False, "error": str(err)}


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return (STATIC_DIR / "index.html").read_text(encoding="utf-8")
