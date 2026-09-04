"""Tests for toolchain detection and the failure message it produces.

The failure this guards against is quiet by nature: PlatformIO checks that
the toolchain *directory* exists, never that a compiler sits inside it, so
a download interrupted partway sails past that check and dies later inside
CMake. These tests build all three on-disk shapes for real.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import builder  # noqa: E402
from app.board_registry import get_board  # noqa: E402

C6 = get_board("esp32c6")
ESP32 = get_board("esp32")

CMAKE_FAILURE = """
CMake Error at project.cmake:601 (__project):
  The CMAKE_C_COMPILER:

    riscv32-esp-elf-gcc

  is not a full path and was not found in the PATH.
"""


def _core(tmp, monkeypatch):
    monkeypatch.setenv("PLATFORMIO_CORE_DIR", str(tmp))
    return tmp


def test_boards_map_to_the_toolchain_platformio_actually_installs():
    # Same split platform-espressif32's espidf.py makes on the MCU name.
    assert C6.toolchain_package == "toolchain-riscv32-esp"
    assert C6.compiler_binary == "riscv32-esp-elf-gcc"
    assert ESP32.toolchain_package == "toolchain-xtensa-esp-elf"
    assert ESP32.compiler_binary == "xtensa-esp-elf-gcc"


def test_nothing_installed_reads_as_absent(tmp_path, monkeypatch):
    _core(tmp_path, monkeypatch)
    assert builder.toolchain_state(C6)["state"] == "absent"


def test_a_package_without_a_compiler_reads_as_broken(tmp_path, monkeypatch):
    """The case PlatformIO's own guard lets through."""
    _core(tmp_path, monkeypatch)
    (tmp_path / "packages" / C6.toolchain_package / "bin").mkdir(parents=True)
    assert builder.toolchain_state(C6)["state"] == "broken"


def test_a_present_compiler_reads_as_ok(tmp_path, monkeypatch):
    _core(tmp_path, monkeypatch)
    bindir = tmp_path / "packages" / C6.toolchain_package / "bin"
    bindir.mkdir(parents=True)
    (bindir / C6.compiler_binary).write_text("#!/bin/sh\n")
    assert builder.toolchain_state(C6)["state"] == "ok"


def test_the_cmake_error_becomes_an_actionable_message(tmp_path, monkeypatch):
    _core(tmp_path, monkeypatch)
    (tmp_path / "packages" / C6.toolchain_package / "bin").mkdir(parents=True)
    message = builder._explain_failure(1, CMAKE_FAILURE, C6)
    assert "unvollständig" in message
    assert C6.compiler_binary in message
    # The bare exit code helps nobody here.
    assert "exit" not in message


def test_an_unrelated_failure_keeps_the_plain_message(tmp_path, monkeypatch):
    _core(tmp_path, monkeypatch)
    assert builder._explain_failure(2, "undefined reference to `foo'", C6) == (
        "esphome compile exited with code 2"
    )


def test_reset_removes_the_package_and_reports_whether_it_did(tmp_path, monkeypatch):
    _core(tmp_path, monkeypatch)
    package = tmp_path / "packages" / C6.toolchain_package
    (package / "bin").mkdir(parents=True)
    assert builder.reset_toolchain(C6) is True
    assert not package.exists()
    # Nothing left to remove the second time.
    assert builder.reset_toolchain(C6) is False


def test_reset_leaves_the_other_architecture_alone(tmp_path, monkeypatch):
    """One broken RISC-V download must not cost an Xtensa user their toolchain."""
    _core(tmp_path, monkeypatch)
    (tmp_path / "packages" / C6.toolchain_package / "bin").mkdir(parents=True)
    xtensa = tmp_path / "packages" / ESP32.toolchain_package / "bin"
    xtensa.mkdir(parents=True)
    builder.reset_toolchain(C6)
    assert xtensa.exists()
