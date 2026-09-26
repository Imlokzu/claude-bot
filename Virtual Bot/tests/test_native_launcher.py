"""Exercise the actual AppKit window and helper wiring, without starting services."""
import os
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]
BINARY = ROOT / "launcher/build/Claude Bot Launcher.app/Contents/MacOS/ClaudeBotLauncher"
pytestmark = pytest.mark.skipif(
    sys.platform != "darwin" or not BINARY.is_file() or os.environ.get("BOT_NATIVE_UI_TESTS") != "1",
    reason="Opt-in macOS GUI test; build the app and set BOT_NATIVE_UI_TESTS=1",
)


@pytest.mark.parametrize("language", ["uk", "en"])
def test_native_window_has_six_localized_actions(language):
    result = subprocess.run([str(BINARY), "--smoke-test", "--lang", language],
                            capture_output=True, text=True, timeout=10)
    assert result.returncode == 0, result.stderr
    assert "six localized actions" in result.stdout


def test_native_screenshot_is_written(tmp_path):
    target = tmp_path / "launcher.png"
    result = subprocess.run([str(BINARY), "--smoke-test", "--screenshot", str(target)],
                            capture_output=True, text=True, timeout=10)
    assert result.returncode == 0, result.stderr
    assert target.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")


def test_failed_screenshot_does_not_report_success(tmp_path):
    result = subprocess.run([str(BINARY), "--smoke-test", "--screenshot", str(tmp_path / "missing/out.png")],
                            capture_output=True, text=True, timeout=10)
    assert result.returncode == 1
    assert "PASS:" not in result.stdout


@pytest.mark.parametrize("exit_code", [0, 1])
def test_native_button_launches_helper_and_restores_controls(tmp_path, exit_code):
    # A fake Go helper exercises real Process/stdout handling, never live services.
    helper = tmp_path / "launcher/build/claude-bot-launcher"
    helper.parent.mkdir(parents=True)
    helper.write_text(
        "#!/bin/sh\n"
        f"[ \"$*\" = '--start web --lang uk --repo {tmp_path}' ] || exit 9\n"
        "sleep 0.1\n"
        "echo 'fixture result'\n"
        f"exit {exit_code}\n", encoding="utf-8",
    )
    helper.chmod(0o755)
    args = [str(BINARY), "--smoke-test", "--repo", str(tmp_path), "--test-action", "web"]
    if exit_code:
        args.append("--expect-failure")
    result = subprocess.run(args, capture_output=True, text=True, timeout=10)
    assert result.returncode == 0, result.stderr
    assert f"helper outcome={str(exit_code == 0).lower()}" in result.stdout
    assert "controls restored" in result.stdout
