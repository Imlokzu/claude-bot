# Quick launcher

No Electron, background launcher server, automatic installs, or credential copies.
On macOS, open `launcher/build/Claude Bot Launcher.app` directly in Finder for a
standalone window without Terminal. It has six service buttons, progress/error
feedback and a Logs button. The window stays open for further selections.
`Launch Bot.command` builds/opens the same app (Terminal may briefly appear).
The first build requires Apple's Command Line Tools (`xcrun swiftc`); later
launches reuse the tiny native binary. No Swift packages are downloaded.

Double-click `Launch Bot.cmd` on Windows.
On Linux, run `./launch-bot.sh`: Zenity provides a native picker when installed,
otherwise the same choices appear in the terminal. Windows uses the built-in
Windows PowerShell graphical picker. The new persistent window is macOS-only.

Choose Dashboard, Bot screen, OpenClaw, Vision, Display, or Dashboard + OpenClaw.
Only the selected services start. Existing healthy instances are reused; occupied
ports are never cleared forcibly. Closing the picker does not stop services.
The display choice starts its backend and opens its API page, not a device emulator.

Prerequisites: Python 3.9+, each selected Python module's existing `.venv` and
dependencies (see its README), and an installed/configured OpenClaw for that choice.
Windows environments use `.venv/Scripts/python.exe`; Unix uses `.venv/bin/python`.
Do not copy a macOS virtual environment to another operating system: recreate it.
If PowerShell policy blocks the picker, use the CLI below; the launcher does not
change execution policy. OpenClaw's supported Windows setup may require WSL; in
that case use the Linux launcher inside that configured environment.

```sh
python3 launcher/launcher.py --start pair
python3 launcher/launcher.py --start screen --lang en
```

Service logs: `Virtual Bot/service_logs/launcher-<service>.log` (git-ignored).
The launcher does not install auto-start services or alter existing OpenClaw config.
On macOS, launch failures and missing environments appear in the GUI; CLI and
other platform entry points report failures in the terminal. Keep the repository
in place: the `.app` is a local launcher, not a bundled copy of all services.

Validation on macOS: unit tests and live dashboard/OpenClaw reuse checks.
Windows/Linux entry points are covered by command/path tests, not native OS runs.

Native GUI checks (no live service starts):

```sh
sh launcher/build-macos.sh
cd "Virtual Bot"
BOT_NATIVE_UI_TESTS=1 PYTHONPATH="$PWD" .venv/bin/pytest tests/test_native_launcher.py -q
```
