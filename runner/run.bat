@echo off
REM ============================================================
REM  AutoCreate Runner - Windows launcher
REM  (ASCII only - Windows console codepage mangles Korean here;
REM   Korean guidance lives in install.md and in the app screen.)
REM  AM original: ../AutoMarketing/scripts/runner-start.bat
REM ============================================================
setlocal
cd /d "%~dp0"
title AutoCreate Runner

echo.
echo   AutoCreate Runner
echo   -----------------
echo.

REM --- 1) Node check -------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo   [X] Node.js is not installed.
  echo       Install Node 20 LTS from https://nodejs.org  then run this file again.
  echo.
  pause
  exit /b 1
)

REM --- 2) Dependencies ----------------------------------------------
if not exist "node_modules\playwright" (
  echo   [1/2] Installing dependencies ... this takes a few minutes the first time.
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :npmfail
  echo   [2/2] Installing browser ...
  call npx playwright install chromium
  if errorlevel 1 goto :npmfail
  echo   Done.
  echo.
)

REM --- 3) Token ------------------------------------------------------
if not exist ".token" (
  if "%~1"=="" (
    echo   Paste the token from the app screen ^(starts with acr_^)
    set /p ACTOKEN=  Token:
  ) else (
    set ACTOKEN=%~1
  )
  if "%ACTOKEN%"=="" (
    echo   [X] No token entered. Get one from the app: Settings ^> Runner ^> Turn on this PC.
    echo.
    pause
    exit /b 1
  )
  node ac-runner.mjs --token %ACTOKEN%
  if errorlevel 1 goto :tokenfail
)

REM --- 4) Run --------------------------------------------------------
echo   Running. Keep this window open. Press Ctrl+C to stop.
echo.
node ac-runner.mjs
echo.
echo   Runner stopped.
pause
exit /b 0

:npmfail
echo.
echo   [X] Install failed. Check your internet connection and run this file again.
echo.
pause
exit /b 1

:tokenfail
echo.
echo   [X] Could not save the token. Copy it again from the app screen.
echo.
pause
exit /b 1
