@echo off
cd /d "%~dp0"
if exist "Virtual Bot\.venv\Scripts\python.exe" (
  "Virtual Bot\.venv\Scripts\python.exe" launcher\launcher.py %*
) else (
  py -3 launcher\launcher.py %*
)
if errorlevel 1 pause
