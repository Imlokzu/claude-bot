# Quick launcher

No Electron, background launcher server, automatic installs, or credential copies.
The launcher itself is a single Go binary built from the standard library only
(`launcher/*.go`), so it does not depend on any module's virtual environment:
a moved repository or a broken venv can no longer take the launcher down.

On macOS, open `launcher/build/Claude Bot Launcher.app` directly in Finder for a
standalone window without Terminal. It has six service buttons, progress/error
feedback and a Logs button. The window stays open for further selections.
`Launch Bot.command` builds/opens the same app (Terminal may briefly appear).
The first build requires Go 1.24+ and Apple's Command Line Tools (`xcrun swiftc`);
later launches reuse the binaries. No Go modules or Swift packages are downloaded.

Double-click `Launch Bot.cmd` on Windows.
On Linux, run `./launch-bot.sh`: Zenity provides a native picker when installed,
otherwise the same choices appear in the terminal. Windows uses the built-in
Windows PowerShell graphical picker. The new persistent window is macOS-only.
The entry scripts rebuild the binary when Go is installed and sources changed;
without Go they keep using an already built binary.

Choose Dashboard, Bot screen, OpenClaw, Vision, Display, or Dashboard + OpenClaw.
Only the selected services start. Existing healthy instances are reused; occupied
ports are never cleared forcibly. Closing the picker does not stop services.
The display choice starts its backend and opens its API page, not a device emulator.

Prerequisites: each selected Python module's existing `.venv` and dependencies
(see its README), and an installed/configured OpenClaw for that choice.
Windows environments use `.venv/Scripts/python.exe`; Unix uses `.venv/bin/python`.
Do not copy a macOS virtual environment to another operating system: recreate it.
If PowerShell policy blocks the picker, use the CLI below; the launcher does not
change execution policy. OpenClaw's supported Windows setup may require WSL; in
that case use the Linux launcher inside that configured environment.

```sh
sh launcher/build-cli.sh                         # prints the binary path
launcher/build/claude-bot-launcher --start pair
launcher/build/claude-bot-launcher --start screen --lang en
launcher/build/claude-bot-launcher --repo /path/to/repo   # when run from elsewhere
```

Without `--repo`, the repository is found by walking up from the binary, then
from the working directory, to the folder containing `launcher/go.mod`.

Service logs: `Virtual Bot/service_logs/launcher-<service>.log` (git-ignored).
The launcher does not install auto-start services or alter existing OpenClaw config.
On macOS, launch failures and missing environments appear in the GUI; CLI and
other platform entry points report failures in the terminal. Keep the repository
in place: the `.app` is a local launcher, not a bundled copy of all services.

## Tests

```sh
cd launcher
go test ./...                       # unit tests + real spawn/stop of a fake service
GOOS=windows go vet ./...           # the Windows code paths at least compile
```

The spawn tests re-run the test binary as a fake service on a free port, so
they never touch the real service ports. Windows/Linux pickers are covered by
unit tests, not native OS runs.

Native GUI checks (no live service starts):

```sh
sh launcher/build-macos.sh
cd "Virtual Bot"
BOT_NATIVE_UI_TESTS=1 PYTHONPATH="$PWD" .venv/bin/pytest tests/test_native_launcher.py -q
```
