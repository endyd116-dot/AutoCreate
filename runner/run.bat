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

REM --- 0) Auto-start (P1R8 3.5 - OPT-IN ONLY, never automatic) -------
REM  We decided NOT to build a tray app (see docs/active/2026-09-15-runner-tray-decision.md).
REM  The one real thing a tray app gave us that we did not already have is "come back
REM  after a reboot". A Startup shortcut does that in ~10 lines instead of a whole
REM  Electron build + a code-signing certificate.
REM  The customer runs this on purpose; we never install it behind their back.
if /I "%~1"=="--autostart"     goto :autostart_on
if /I "%~1"=="--autostart-off" goto :autostart_off

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

REM ============================================================
REM  Auto-start helpers
REM  Paths go through environment variables on purpose: putting a Windows path
REM  with spaces inside a PowerShell -Command string means fighting two layers of
REM  quoting, and that is exactly how we produced "silently did nothing" before
REM  (PITFALLS AC-67 - do not fight the escaping, avoid it).
REM  WindowStyle 7 = start minimised, so the console does not jump in the
REM  customer's face at every login.
REM ============================================================
:autostart_on
set "AC_LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\AutoCreate Runner.lnk"
set "AC_TARGET=%~f0"
set "AC_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$w=New-Object -COM WScript.Shell; $s=$w.CreateShortcut($env:AC_LNK); $s.TargetPath=$env:AC_TARGET; $s.WorkingDirectory=$env:AC_DIR; $s.WindowStyle=7; $s.Description='AutoCreate Runner'; $s.Save()" >nul 2>nul
REM  Do not trust the exit code - check the file is actually there (PITFALLS AC-66:
REM  "we called it" is not "it happened"; read the disk).
if exist "%AC_LNK%" (
  echo   [OK] This PC will start the runner automatically when you log in.
  echo        Window starts minimised. To undo:  run.bat --autostart-off
) else (
  echo   [X] Could not create the startup shortcut.
  echo       Start it by hand after each reboot, or add run.bat to the Startup folder:
  echo       press Win+R, type  shell:startup  , and drop a shortcut to this file there.
)
echo.
pause
exit /b 0

:autostart_off
set "AC_LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\AutoCreate Runner.lnk"
if exist "%AC_LNK%" (
  del /f /q "%AC_LNK%" >nul 2>nul
  if exist "%AC_LNK%" (
    echo   [X] Could not remove it. Delete this file by hand:
    echo       %AC_LNK%
  ) else (
    echo   [OK] Auto-start turned off. The runner no longer starts by itself.
  )
) else (
  echo   [OK] Auto-start was not on. Nothing to do.
)
echo.
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
