@echo off
REM ============================================================
REM  AutoCreate Runner - Windows launcher
REM  (ASCII only - Windows console codepage mangles Korean here;
REM   Korean guidance lives in install.md and in the app screen.)
REM  AM original: ../AutoMarketing/scripts/runner-start.bat
REM ============================================================
REM  enabledelayedexpansion is REQUIRED - see the key block below.
REM  Without it, a variable SET inside a parenthesised block cannot be READ
REM  in that same block: %VAR% is substituted when cmd PARSES the block,
REM  not when it runs. That made the key check always see an empty value,
REM  so every customer who pasted a key got "No key entered" (found 2026-09-15
REM  by actually running this file - it had never been exercised end to end).
setlocal enabledelayedexpansion
cd /d "%~dp0"
title AutoCreate Runner

REM  The runner prints Korean. Node writes UTF-8 bytes; a Korean Windows console
REM  defaults to codepage 949 and renders them as garbage ("?щ꼫" instead of "러너").
REM  Switch this window to UTF-8 so our own messages are readable. Quiet on failure -
REM  an old console that cannot do 65001 should still run the program.
chcp 65001 >nul 2>nul

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

REM --- 3) Key (the app screen calls this the "key") -------------------
if not exist ".token" (
  if "%~1"=="" (
    echo   Paste the key from the app screen ^(starts with acr_^)
    set /p ACTOKEN=  Key:
  ) else (
    set ACTOKEN=%~1
  )
  REM  !VAR! (not %VAR%) - reads the value SET a few lines above, inside this same block.
  if "!ACTOKEN!"=="" (
    echo   [X] No key entered. Get one from the app: Settings ^> Runner ^> Turn on this PC.
    echo.
    pause
    exit /b 1
  )
  node ac-runner.mjs --token !ACTOKEN!
  if errorlevel 1 goto :tokenfail
)

REM --- 4) Run (restart loop) -----------------------------------------
REM  Exit code 75 means "I just updated myself, start me again"
REM  (runner\lib\update.mjs). Any other code ends the loop, so a real
REM  crash or Ctrl+C still stops the program instead of spinning.
echo   Running. Keep this window open. Press Ctrl+C to stop.
echo.
:runloop
node ac-runner.mjs
if errorlevel 76 goto :stopped
if errorlevel 75 (
  echo.
  echo   Updated - restarting ...
  echo.
  goto :runloop
)
:stopped
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
echo   [X] Could not save the key. Copy it again from the app screen.
echo.
pause
exit /b 1
