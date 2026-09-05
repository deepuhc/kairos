@echo off
REM Double-click this file to install Kairos on Windows.
REM
REM It checks for git + Node.js 20+, downloads the installer, and runs it. The
REM installer clones Kairos to %USERPROFILE%\Kairos, installs dependencies,
REM builds, and creates a Kairos.cmd launcher plus a desktop shortcut. After
REM that, updates are one click inside the app.
setlocal
set RAW=https://raw.githubusercontent.com/deepuhc/kairos/main/install/kairos-install.mjs

echo Kairos installer
echo ================

where git >nul 2>&1
if errorlevel 1 (
  echo Error: git is not installed. Get it from https://git-scm.com/download/win and re-run.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo Error: Node.js is not installed. Get Node 20+ from https://nodejs.org and re-run.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 20 (
  echo Error: Node.js 20+ is required. Get it from https://nodejs.org and re-run.
  pause
  exit /b 1
)

set TMP=%TEMP%\kairos-install.mjs
echo Downloading installer...
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing '%RAW%' -OutFile '%TMP%' } catch { exit 1 }"
if errorlevel 1 (
  echo Error: could not download the installer from %RAW%
  pause
  exit /b 1
)

echo Running installer...
node "%TMP%"
set STATUS=%ERRORLEVEL%
del "%TMP%" >nul 2>&1

echo.
if "%STATUS%"=="0" (
  echo Install complete. Look for the Kairos shortcut on your Desktop, or run Kairos.cmd in %USERPROFILE%\Kairos.
) else (
  echo Install did not complete (exit %STATUS%).
)
pause
