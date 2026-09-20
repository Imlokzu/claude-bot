"""Small native service picker; standard library only, no resident launcher daemon."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import time
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, build_opener

ROOT = Path(__file__).resolve().parents[1]
LOGS = ROOT / "Virtual Bot" / "service_logs"
STRINGS = json.loads(Path(__file__).with_name("locales.json").read_text(encoding="utf-8"))
LANG = "uk"
ACTIONS = ("web", "screen", "openclaw", "vision", "display", "pair")
SERVICES = {
    "web": ("Virtual Bot", 8100, "/dash/", ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8100", "--timeout-graceful-shutdown", "3"]),
    "vision": ("Vision Agent", 8000, "/health", ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"]),
    "display": ("claude-bot-display", 8001, "/health", ["-m", "backend.server", "--host", "127.0.0.1", "--port", "8001"]),
    "openclaw": (".", 18789, "/health", ["gateway", "run", "--bind", "loopback", "--port", "18789"]),
}


def t(key: str, **values: object) -> str:
    return STRINGS[LANG][key].format(**values)


def python_for(directory: Path, windows: bool = os.name == "nt") -> Path:
    return directory / ".venv" / ("Scripts/python.exe" if windows else "bin/python")


def command_for(service: str) -> tuple[list[str], Path]:
    folder, _, _, args = SERVICES[service]
    directory = ROOT / folder
    if service == "openclaw":
        executable = shutil.which("openclaw")
        if not executable:
            raise RuntimeError(t("missing_openclaw"))
    else:
        executable = str(python_for(directory))
        if not Path(executable).is_file():
            raise RuntimeError(t("missing_python", path=executable))
    return [executable, *args], directory


def healthy(service: str) -> bool:
    _, port, path, _ = SERVICES[service]
    try:
        # Local probes must not go through an ambient HTTP proxy.
        with build_opener(ProxyHandler({})).open(f"http://127.0.0.1:{port}{path}", timeout=1) as response:
            return response.status == 200
    except (OSError, ValueError):
        return False


def _proxy_is_reachable(value: str) -> bool:
    """Return whether a loopback proxy inherited from the desktop is alive."""
    try:
        parsed = urlsplit(value)
        if parsed.hostname not in {"127.0.0.1", "localhost", "::1"} or not parsed.port:
            return True
        with socket.create_connection((parsed.hostname, parsed.port), timeout=0.3):
            return True
    except (OSError, ValueError):
        return False


def service_environment() -> dict[str, str]:
    """Copy the GUI environment, dropping dead local proxies only.

    Keep a reachable or remote proxy for external model/API traffic. Remove
    only dead loopback proxy variables; this covers every casing variant while
    avoiding needless loss of a working remote proxy.
    """
    environment = os.environ.copy()
    proxy_keys = [key for key in environment if key.lower().endswith("_proxy")]
    for key in proxy_keys:
        if not _proxy_is_reachable(environment[key]):
            environment.pop(key, None)
    return environment


def open_url(url: str) -> None:
    """Open a URL without keeping a GUI helper's stdout pipe alive."""
    if sys.platform == "darwin":
        command = ["open", url]
    elif os.name == "nt":
        os.startfile(url)  # type: ignore[attr-defined,no-untyped-call]
        return
    else:
        command = ["xdg-open", url]
    subprocess.Popen(
        command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=os.name != "nt",
    )


@contextmanager
def launch_lock(service: str):
    """OS locks expire with the launcher, including after a crash."""
    LOGS.mkdir(parents=True, exist_ok=True)
    with (LOGS / f"launcher-{service}.lock").open("a+b") as handle:
        handle.seek(0)
        handle.write(b"0")
        handle.flush()
        handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise RuntimeError(t("busy")) from exc
        try:
            yield
        finally:
            if os.name == "nt":
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def stop_launched_process(process: subprocess.Popen) -> None:
    """Stop only this launch's process tree, never a process discovered by port."""
    if os.name == "nt":
        # npm's .cmd shim can own a separate node.exe child. Terminating only
        # the shim leaves that child listening after a failed startup.
        if process.poll() is None:
            try:
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               timeout=5, check=False,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            finally:
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=3)
        return

    # start_new_session=True makes the exact spawned PID the owned group ID.
    # The leader may already have exited while descendants are still alive.
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        process.wait(timeout=3)
        return
    try:
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        pass
    finally:
        # Reaping the group leader does not prove its descendants have exited.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    process.wait(timeout=3)


def start_service(service: str) -> None:
    with launch_lock(service):
        if healthy(service):
            return
        _, port, _, _ = SERVICES[service]
        with socket.socket() as probe:
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                raise RuntimeError(t("port_busy", port=port))
        command, directory = command_for(service)
        log_path = LOGS / f"launcher-{service}.log"
        options = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS} if os.name == "nt" else {"start_new_session": True}
        with log_path.open("ab") as log:
            process = subprocess.Popen(command, cwd=directory, stdin=subprocess.DEVNULL,
                                       stdout=log, stderr=subprocess.STDOUT,
                                       env=service_environment(), **options)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if healthy(service):
                return
            if process.poll() is not None:
                break
            time.sleep(0.3)
        # Never leave an unknown pending launch behind or kill an existing service.
        stop_launched_process(process)
        raise RuntimeError(t("failed", log=log_path))


def launch(action: str) -> None:
    if action not in ACTIONS:
        raise ValueError(action)
    if action == "pair":
        start_service("openclaw")
        start_service("web")
    else:
        start_service("web" if action == "screen" else action)
    url = {
        "web": "http://127.0.0.1:8100/dash/#/chat",
        "pair": "http://127.0.0.1:8100/dash/#/chat",
        "screen": "http://127.0.0.1:8100/screen",
        "openclaw": "http://127.0.0.1:18789/",
        "vision": "http://127.0.0.1:8000/vision/stream.mjpg",
        "display": "http://127.0.0.1:8001/docs",
    }[action]
    open_url(url)


def choose() -> str | None:
    labels = [t(action) for action in ACTIONS]
    if sys.platform == "darwin":
        items = ", ".join(json.dumps(label, ensure_ascii=False) for label in labels)
        script = f'choose from list {{{items}}} with title {json.dumps(t("title"), ensure_ascii=False)} with prompt {json.dumps(t("choose"), ensure_ascii=False)} OK button name {json.dumps(t("launch"), ensure_ascii=False)} cancel button name {json.dumps(t("cancel"), ensure_ascii=False)}'
        result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(result.stderr.strip())
        selected = result.stdout.strip()
        return ACTIONS[labels.index(selected)] if selected in labels else None
    if os.name == "nt":
        payload = {"title": t("title"), "items": [{"id": key, "label": t(key)} for key in ACTIONS]}
        result = subprocess.run(["powershell.exe", "-NoProfile", "-STA", "-File", str(Path(__file__).with_name("picker.ps1"))],
                                input=json.dumps(payload), capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(result.stderr.strip())
        selected = result.stdout.strip()
        return selected if selected in ACTIONS else None
    if shutil.which("zenity"):
        result = subprocess.run(["zenity", "--list", "--title", t("title"), "--text", t("choose"),
                                 "--column", "id", "--column", t("launch"), "--hide-column", "1", "--print-column", "1",
                                 *[value for key in ACTIONS for value in (key, t(key))]], capture_output=True, text=True)
        if result.returncode not in (0, 1):
            raise RuntimeError(result.stderr.strip())
        selected = result.stdout.strip()
        return selected if selected in ACTIONS else None
    print(t("title"))
    for index, label in enumerate(labels, 1):
        print(f"{index}. {label}")
    value = input(t("terminal")).strip()
    return ACTIONS[int(value) - 1] if value.isdigit() and 1 <= int(value) <= len(ACTIONS) else None


def main() -> int:
    global LANG
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", choices=ACTIONS)
    parser.add_argument("--lang", choices=STRINGS, default="uk")
    args = parser.parse_args()
    LANG = args.lang
    try:
        action = args.start or choose()
        if action:
            launch(action)
            print(t("ready", name=t(action)))
        return 0
    except (OSError, RuntimeError, EOFError, subprocess.SubprocessError) as exc:
        print(t("error", message=exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
