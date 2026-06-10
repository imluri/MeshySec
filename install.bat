@echo off
setlocal EnableDelayedExpansion
title Meshy GLB Exporter - Build ^& Install

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
cd /d "%ROOT%"

echo.
echo  ============================================
echo    Meshy GLB Exporter - build ^& install
echo  ============================================
echo.

:: ---- Node.js (required) ----
where node >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Node.js was not found.
    echo  Install Node 18+ from https://nodejs.org/ then run this again.
    echo  Opening the download page now...
    echo.
    start "" "https://nodejs.org/en/download/prebuilt-installer"
    pause & exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo  Node %%v found.

:: ---- npm (ships with Node, but check anyway) ----
where npm >nul 2>&1
if errorlevel 1 (
    echo  ERROR: npm was not found. Reinstall Node.js from https://nodejs.org/ then run this again.
    echo.
    pause & exit /b 1
)

echo.
echo  [1/2] Installing dependencies (npm install)...
call npm install
if errorlevel 1 ( echo  ERROR: npm install failed. & pause & exit /b 1 )

echo.
echo  [2/2] Building the extension (npm run build)...
call npm run build
if errorlevel 1 ( echo  ERROR: build failed. & pause & exit /b 1 )

:: Copy the dist path so it can be pasted into Chrome's folder picker.
<nul set /p "=%ROOT%\dist" | clip

echo.
echo  Opening Chrome's extensions page and this folder...
start "" chrome "chrome://extensions/"
start "" "%ROOT%"

echo.
echo  ============================================
echo    Almost done - in Chrome:
echo  ============================================
echo    1. Turn on "Developer mode" (top-right switch).
echo    2. Click "Load unpacked" (top-left).
echo    3. Choose the "dist" folder (this folder just opened;
echo       its path is on your clipboard - paste it and press Enter).
echo    4. Open a model on meshy.ai and click the blue GLB button.
echo.
echo  If Chrome did not open, paste this in its address bar:  chrome://extensions
echo  Rebuilt later? Run this again, then click reload on the extension's card.
echo.
endlocal
pause
