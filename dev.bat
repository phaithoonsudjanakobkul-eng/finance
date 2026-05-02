@echo off
REM PSLink Dev Server launcher
REM   dev.bat              -> HTTPS local + open in main Chrome + DevTools
REM   dev.bat tunnel       -> above + Cloudflare Tunnel public URL
REM   dev.bat headless     -> no auto-open browser
cd /d "%~dp0"
if "%1"=="tunnel" (
    node dev-server.js tunnel
) else if "%1"=="headless" (
    node dev-server.js --no-open
) else (
    node dev-server.js
)
echo.
echo === Dev server exited (code %ERRORLEVEL%) ===
pause
