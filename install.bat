@echo off
REM ============================================================
REM  Meshy GLB Exporter - easy installer (Windows)
REM  Double-click this file. It builds the extension (if needed)
REM  and opens Chrome + the folder so you can load it.
REM ============================================================
setlocal
cd /d "%~dp0"
title Meshy GLB Exporter - Installer

echo.
echo  ============================================
echo    Meshy GLB Exporter - easy installer
echo  ============================================
echo.

set "HAVE_DIST="
if exist "dist\manifest.json" set "HAVE_DIST=1"

REM --- Make sure we have a built "dist" folder ---------------
where node >nul 2>nul
if errorlevel 1 (
  if defined HAVE_DIST (
    echo  Node.js was not found, but a ready-made "dist" folder is here.
    echo  Using it as-is.
    echo.
    goto load
  )
  echo  [!] Node.js is not installed, and there is no built "dist" folder yet.
  echo      I will open the Node.js download page now.
  echo      Install it (Next - Next - Finish), then run this file again.
  echo.
  pause
  start "" "https://nodejs.org/en/download/prebuilt-installer"
  goto end
)

echo  [1/3] Installing build tools (first time can take a minute)...
call npm install
if errorlevel 1 (
  echo.
  echo  [!] "npm install" failed. Scroll up to read the error.
  goto fail
)

echo.
echo  [2/3] Building the extension...
call npm run build
if errorlevel 1 (
  echo.
  echo  [!] Build failed. Scroll up to read the error.
  goto fail
)

:load
echo.
echo  [3/3] Opening Chrome and the project folder...
REM Copy the dist path to the clipboard so it can be pasted into the picker.
<nul set /p "=%~dp0dist" | clip
start "" chrome "chrome://extensions/"
start "" "%~dp0"

echo.
echo  ============================================
echo    ALMOST DONE - 4 clicks in Chrome:
echo  ============================================
echo    1) Turn ON "Developer mode"  (switch, top-right)
echo    2) Click "Load unpacked"     (button, top-left)
echo    3) Choose the "dist" folder  (this folder is open in a window;
echo       the path is also copied - just paste it and press Enter)
echo    4) Done! Open a model on meshy.ai and click the blue GLB button.
echo.
echo  If Chrome did not open, type this in its address bar:  chrome://extensions
echo.
echo  Changed the code later? Run this file again, then click the round
echo  reload arrow on the extension's card.
echo.
goto end

:fail
echo.
pause
endlocal
exit /b 1

:end
echo.
pause
endlocal
exit /b 0
