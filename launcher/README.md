# Quick launcher

No Electron, background launcher server, automatic installs, or credential copies.
Double-click `Launch Bot.command` on macOS or `Launch Bot.cmd` on Windows.
On Linux, run `./launch-bot.sh`: Zenity provides a native picker when installed,
otherwise the same choices appear in the terminal. macOS uses its native list
dialog; Windows uses the built-in Windows PowerShell graphical picker.

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
Launch failures and missing environments are shown in the launcher's terminal.

Validation on macOS: unit tests and live dashboard/OpenClaw reuse checks.
Windows/Linux entry points are covered by command/path tests, not native OS runs.
