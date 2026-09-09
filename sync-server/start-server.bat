@echo off
title RcdRmd Local Sync Hub
cd /d "%~dp0"

echo ========================================================
echo   Starting RcdRmd Local Cross-Browser Sync Hub...
echo ========================================================

where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [OK] Node.js detected. Launching rcdrmd-sync-server.js...
    node rcdrmd-sync-server.js
    goto end
)

where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [OK] Python detected. Launching rcdrmd-sync-server.py...
    python rcdrmd-sync-server.py
    goto end
)

echo [ERROR] Neither Node.js nor Python was found in your PATH.
echo Please ensure Node.js or Python is installed to use cross-browser sync.
echo Note: The RcdRmd extension will continue to work within each single browser in local mode.
pause

:end
