@echo off
REM PSLink v2 (Svelte 5) Dev Server launcher
REM   app.bat              -> Vite dev on first free port (default 5173) + auto-open browser
REM   app.bat headless     -> no auto-open browser
REM   app.bat test         -> vitest run (one-shot)
REM   app.bat test:watch   -> vitest in watch mode
REM   app.bat build        -> production build to app/dist/
REM   app.bat check        -> svelte-check + tsc
cd /d "%~dp0app"
if "%1"=="headless" (
    call npm run dev
) else if "%1"=="test" (
    call npm test
) else if "%1"=="test:watch" (
    call npm run test:watch
) else if "%1"=="build" (
    call npm run build
) else if "%1"=="check" (
    call npm run check
) else (
    call npm run dev -- --open
)
echo.
echo === app exited (code %ERRORLEVEL%) ===
pause
