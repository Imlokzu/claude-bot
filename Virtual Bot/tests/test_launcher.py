"""Launch choices must never start unrelated services or install software."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, call

import pytest

SPEC = importlib.util.spec_from_file_location(
    "bot_launcher", Path(__file__).resolve().parents[2] / "launcher" / "launcher.py"
)
launcher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(launcher)


@pytest.fixture(autouse=True)
def isolated_logs(tmp_path, monkeypatch):
    monkeypatch.setattr(launcher, "LOGS", tmp_path)


@pytest.mark.parametrize("action, services", [
    ("web", ["web"]), ("screen", ["web"]), ("openclaw", ["openclaw"]),
    ("vision", ["vision"]), ("display", ["display"]), ("pair", ["openclaw", "web"]),
])
def test_only_selected_services_start(monkeypatch, action, services):
    start = MagicMock()
    browser = MagicMock()
    monkeypatch.setattr(launcher, "start_service", start)
    monkeypatch.setattr(launcher, "open_url", browser)
    launcher.launch(action)
    assert [call.args[0] for call in start.call_args_list] == services
    browser.assert_called_once()
    assert browser.call_args.args[0].startswith("http://127.0.0.1:")


def test_unrecognized_action_never_executes(monkeypatch):
    start = MagicMock()
    monkeypatch.setattr(launcher, "start_service", start)
    with pytest.raises(ValueError):
        launcher.launch("shell; bad command")
    start.assert_not_called()


def test_healthy_service_does_not_spawn_duplicate(monkeypatch):
    monkeypatch.setattr(launcher, "healthy", lambda _: True)
    spawn = MagicMock()
    monkeypatch.setattr(launcher.subprocess, "Popen", spawn)
    launcher.start_service("web")
    spawn.assert_not_called()


def test_occupied_port_is_not_killed_or_replaced(monkeypatch):
    monkeypatch.setattr(launcher, "healthy", lambda _: False)
    sock = MagicMock()
    sock.return_value.__enter__.return_value.connect_ex.return_value = 0
    monkeypatch.setattr(launcher.socket, "socket", sock)
    spawn = MagicMock()
    monkeypatch.setattr(launcher.subprocess, "Popen", spawn)
    with pytest.raises(RuntimeError, match="8100"):
        launcher.start_service("web")
    spawn.assert_not_called()


def test_python_paths_match_each_os(tmp_path):
    assert launcher.python_for(tmp_path, windows=True) == tmp_path / ".venv/Scripts/python.exe"
    assert launcher.python_for(tmp_path, windows=False) == tmp_path / ".venv/bin/python"


def test_missing_environment_does_not_install_packages(tmp_path, monkeypatch):
    monkeypatch.setattr(launcher, "ROOT", tmp_path)
    with pytest.raises(RuntimeError, match=".venv"):
        launcher.command_for("web")


def test_openclaw_uses_existing_config_without_force(monkeypatch):
    monkeypatch.setattr(launcher.shutil, "which", lambda _: "/tools/openclaw")
    command, _ = launcher.command_for("openclaw")
    assert command == ["/tools/openclaw", "gateway", "run", "--bind", "loopback", "--port", "18789"]


def test_lock_released_after_failure():
    with pytest.raises(RuntimeError):
        with launcher.launch_lock("web"):
            raise RuntimeError("test")
    with launcher.launch_lock("web"):
        pass


def test_locale_keys_match():
    assert launcher.STRINGS["uk"].keys() == launcher.STRINGS["en"].keys()


def test_service_environment_drops_dead_loopback_proxy(monkeypatch):
    monkeypatch.setattr(launcher, "_proxy_is_reachable", lambda value: False if "127.0.0.1" in value else True)
    monkeypatch.setattr(launcher.os, "environ", {
        "HTTP_PROXY": "http://127.0.0.1:9",
        "http_proxy": "http://127.0.0.1:9",
        "HTTPS_PROXY": "http://proxy.example:8080",
        "APP_MODE": "test",
    })
    env = launcher.service_environment()
    assert "HTTP_PROXY" not in env and "http_proxy" not in env
    assert env["HTTPS_PROXY"] == "http://proxy.example:8080"
    assert env["APP_MODE"] == "test"


def test_service_environment_keeps_reachable_proxy(monkeypatch):
    monkeypatch.setattr(launcher, "_proxy_is_reachable", lambda value: True)
    monkeypatch.setattr(launcher.os, "environ", {"HTTP_PROXY": "http://127.0.0.1:9"})
    assert launcher.service_environment()["HTTP_PROXY"] == "http://127.0.0.1:9"


def test_posix_cleanup_targets_owned_group_even_after_leader_exits(monkeypatch):
    process = MagicMock(pid=12345)
    process.poll.return_value = 0
    kill_group = MagicMock()
    monkeypatch.setattr(launcher, "os", SimpleNamespace(name="posix", killpg=kill_group))
    monkeypatch.setattr(launcher, "signal", SimpleNamespace(SIGTERM=15, SIGKILL=9))
    launcher.stop_launched_process(process)
    assert kill_group.call_args_list == [
        call(12345, launcher.signal.SIGTERM), call(12345, launcher.signal.SIGKILL),
    ]
    process.kill.assert_not_called()


def test_posix_cleanup_escalates_when_leader_ignores_termination(monkeypatch):
    process = MagicMock(pid=12345)
    process.wait.side_effect = [launcher.subprocess.TimeoutExpired("owned", 3), 0]
    kill_group = MagicMock()
    monkeypatch.setattr(launcher, "os", SimpleNamespace(name="posix", killpg=kill_group))
    monkeypatch.setattr(launcher, "signal", SimpleNamespace(SIGTERM=15, SIGKILL=9))
    launcher.stop_launched_process(process)
    assert kill_group.call_args_list[-1] == call(12345, launcher.signal.SIGKILL)


def test_windows_cleanup_includes_only_owned_pid_tree(monkeypatch):
    process = MagicMock(pid=12345)
    process.poll.return_value = None
    run = MagicMock()
    monkeypatch.setattr(launcher, "os", SimpleNamespace(name="nt"))
    monkeypatch.setattr(launcher.subprocess, "run", run)
    launcher.stop_launched_process(process)
    assert run.call_args.args[0] == ["taskkill", "/PID", "12345", "/T", "/F"]
    assert run.call_args.kwargs["timeout"] == 5
    process.kill.assert_not_called()


def test_windows_cleanup_reaps_owned_child_when_taskkill_times_out(monkeypatch):
    process = MagicMock(pid=12345)
    process.poll.return_value = None
    process.wait.side_effect = [launcher.subprocess.TimeoutExpired("owned", 3), 0]
    monkeypatch.setattr(launcher, "os", SimpleNamespace(name="nt"))
    monkeypatch.setattr(launcher.subprocess, "run", MagicMock(
        side_effect=launcher.subprocess.TimeoutExpired("taskkill", 5),
    ))
    with pytest.raises(launcher.subprocess.TimeoutExpired):
        launcher.stop_launched_process(process)
    process.kill.assert_called_once()
    assert process.wait.call_count == 2


def test_startup_checks_health_before_rejecting_exited_wrapper(tmp_path, monkeypatch):
    process = MagicMock(pid=12345)
    process.poll.return_value = 0
    spawn = MagicMock(return_value=process)
    sock = MagicMock()
    sock.return_value.__enter__.return_value.connect_ex.return_value = 1
    monkeypatch.setattr(launcher, "healthy", MagicMock(side_effect=[False, True]))
    monkeypatch.setattr(launcher.socket, "socket", sock)
    monkeypatch.setattr(launcher, "command_for", lambda _: (["owned-command"], tmp_path))
    monkeypatch.setattr(launcher.subprocess, "Popen", spawn)
    cleanup = MagicMock()
    monkeypatch.setattr(launcher, "stop_launched_process", cleanup)
    launcher.start_service("web")
    process.poll.assert_not_called()
    cleanup.assert_not_called()


def test_startup_timeout_cleans_its_tree_without_opening_browser(tmp_path, monkeypatch):
    process = MagicMock(pid=12345)
    sock = MagicMock()
    sock.return_value.__enter__.return_value.connect_ex.return_value = 1
    monkeypatch.setattr(launcher, "healthy", lambda _: False)
    monkeypatch.setattr(launcher.socket, "socket", sock)
    monkeypatch.setattr(launcher, "command_for", lambda _: (["owned-command"], tmp_path))
    monkeypatch.setattr(launcher.subprocess, "Popen", MagicMock(return_value=process))
    monkeypatch.setattr(launcher.time, "monotonic", MagicMock(side_effect=[0, 31]))
    cleanup = MagicMock()
    monkeypatch.setattr(launcher, "stop_launched_process", cleanup)
    with pytest.raises(RuntimeError, match="launcher-web.log"):
        launcher.start_service("web")
    cleanup.assert_called_once_with(process)


@pytest.mark.parametrize("code, output, expected", [(0, "web\n", "web"), (1, "", None)])
def test_linux_picker_selection_and_cancel(monkeypatch, code, output, expected):
    monkeypatch.setattr(launcher, "sys", SimpleNamespace(platform="linux"))
    monkeypatch.setattr(launcher, "os", SimpleNamespace(name="posix"))
    monkeypatch.setattr(launcher.shutil, "which", lambda _: "/usr/bin/zenity")
    monkeypatch.setattr(launcher.subprocess, "run", MagicMock(return_value=SimpleNamespace(
        returncode=code, stdout=output, stderr="",
    )))
    assert launcher.choose() == expected


def test_linux_picker_errors_are_not_silently_treated_as_cancel(monkeypatch):
    monkeypatch.setattr(launcher, "sys", SimpleNamespace(platform="linux"))
    monkeypatch.setattr(launcher, "os", SimpleNamespace(name="posix"))
    monkeypatch.setattr(launcher.shutil, "which", lambda _: "/usr/bin/zenity")
    monkeypatch.setattr(launcher.subprocess, "run", MagicMock(return_value=SimpleNamespace(
        returncode=2, stdout="", stderr="picker failed",
    )))
    with pytest.raises(RuntimeError, match="picker failed"):
        launcher.choose()


def test_macos_picker_cancel_starts_nothing(monkeypatch):
    monkeypatch.setattr(launcher, "sys", SimpleNamespace(platform="darwin"))
    monkeypatch.setattr(launcher.subprocess, "run", MagicMock(return_value=SimpleNamespace(
        returncode=0, stdout="false\n", stderr="",
    )))
    assert launcher.choose() is None
