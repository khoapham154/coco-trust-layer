@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   Coco Trust Layer - Demo Server
echo ============================================
echo.

REM 1. Check Python is installed and on PATH
where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python was not found.
  echo Install Python 3.11 from https://www.python.org/downloads/
  echo During setup, tick "Add python.exe to PATH", then run this file again.
  echo.
  pause
  exit /b 1
)

REM 2. Create a local virtual environment on first run
if not exist ".venv\Scripts\python.exe" (
  echo First run: creating a virtual environment ...
  python -m venv .venv
)

REM 3. Install dependencies (quick after the first time)
echo Installing dependencies ...
".venv\Scripts\python.exe" -m pip install --quiet --upgrade pip
".venv\Scripts\python.exe" -m pip install --quiet -r backend\requirements.txt
if errorlevel 1 (
  echo [ERROR] Dependency install failed. Check your internet connection.
  pause
  exit /b 1
)

REM 4. Set environment
set "PYTHONPATH=%cd%"
set "COCO_ALLOW_DEMO_RESET=1"

REM 5. Seed sample verdicts on first run so the dashboard has data
if not exist "data\runtime\audit.db" (
  echo First run: seeding sample verdicts ...
  ".venv\Scripts\python.exe" tests\run_twenty_scenarios.py
)

REM 6. Launch the gateway
echo.
echo ============================================
echo   Server is starting. KEEP THIS WINDOW OPEN.
echo.
echo   Open these two tabs in Chrome:
echo     http://localhost:8080/dashboard
echo     http://localhost:8080/sandbox/twenty
echo.
echo   To stop the server: press Ctrl+C, then close this window.
echo ============================================
echo.
".venv\Scripts\python.exe" -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8080
pause
