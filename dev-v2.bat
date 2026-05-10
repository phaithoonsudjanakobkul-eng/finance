@echo off
REM PSLink v2 (Vite) Dev Server launcher
REM   dev-v2.bat            -> Vite dev on :5173 + auto-open Chrome at /src/
REM   dev-v2.bat headless   -> no auto-open (run server only)
REM   dev-v2.bat e2e        -> run Playwright e2e suite (boots dev server transiently)
REM
REM Why a separate bat from dev.bat:
REM   dev.bat       -> HTTPS :8443 serving the MONOLITH (root index.html) for production-style edits
REM   dev-v2.bat    -> HTTP  :5173 serving the v2 Vite shell at /src/ for migration work
REM
REM CRITICAL — open at /src/ WITH trailing slash. Bare /src falls back to root
REM index.html (the monolith) instead of redirecting. This launcher passes the
REM correct URL to vite's --open flag so the browser never lands on the wrong one.

cd /d "%~dp0"

if "%1"=="headless" (
    npm run dev:vite:headless
) else if "%1"=="e2e" (
    npm run e2e
) else (
    npm run dev:v2
)
echo.
echo === Vite dev server exited (code %ERRORLEVEL%) ===
pause
