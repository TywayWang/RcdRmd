@echo off
title Stop RcdRmd Sync Hub
echo Finding and stopping process on port 32188...

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":32188" ^| findstr "LISTENING"') do (
    echo Terminating PID: %%a
    taskkill /F /PID %%a 2>nul
)

echo [OK] RcdRmd Sync Hub stopped.
ping -n 2 127.0.0.1 >nul
