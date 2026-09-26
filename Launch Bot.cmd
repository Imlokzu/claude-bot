@echo off
cd /d "%~dp0"
rem Rebuild when Go is available; the build cache makes this near-instant.
where go >nul 2>nul
if not errorlevel 1 (
  pushd launcher
  go build -trimpath -ldflags="-s -w" -o build\claude-bot-launcher.exe .
  popd
)
"launcher\build\claude-bot-launcher.exe" %*
if errorlevel 1 pause
