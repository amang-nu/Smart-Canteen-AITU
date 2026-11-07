@echo off
setlocal
cd /d "%~dp0"
title AITU Smart Canteen - SERVER
echo ============================================
echo   AITU SMART CANTEEN - START
echo ============================================
echo.
if not exist "server.py" (
    echo ERROR: server.py is missing. Extract all files from ZIP first.
    pause
    exit /b 1
)
powershell -NoProfile -Command "try { $c=New-Object System.Net.Sockets.TcpClient; $a=$c.BeginConnect('127.0.0.1',3001,$null,$null); if ($a.AsyncWaitHandle.WaitOne(1200)) { $c.EndConnect($a); $c.Close(); exit 0 }; $c.Close(); exit 1 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 (
    echo ERROR: Port 3001 is already in use.
    echo Stop the old website server ^(Ctrl+C in its terminal^) and try again.
    echo The old website might be using the old database.
    pause
    exit /b 1
)
echo Starting the new website at http://localhost:3001
echo This window must remain open.
echo.
where py >nul 2>nul
if not errorlevel 1 (
    py -3 server.py
    goto ended
)
where python >nul 2>nul
if not errorlevel 1 (
    python server.py
    goto ended
)
echo ERROR: Python 3 was not found.
:ended
echo.
echo Server stopped, or could not start.
pause
endlocal
