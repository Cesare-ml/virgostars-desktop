@echo off
setlocal EnableExtensions
rem Native Windows launcher: no PowerShell policy change and no GitHub Actions.
rem Requires an authorized sibling astrological-charts checkout.
for %%D in ("%~dp0..") do set "DESKTOP=%%~fD"
for %%D in ("%DESKTOP%\..\astrological-charts") do set "CHARTS=%%~fD"

echo [VirgoStars Desktop] Read-only Windows preflight
pushd "%DESKTOP%" || goto :error
where node >nul 2>nul
if errorlevel 1 (echo Node.js is missing. Install Node 22 LTS or 24. & goto :failed)
where npm.cmd >nul 2>nul
if errorlevel 1 (echo npm.cmd is missing. Reinstall Node.js/npm. & goto :failed)
node scripts\desktop-doctor.mjs --stage=setup --strict
if errorlevel 1 goto :failed
popd

echo [VirgoStars Desktop] Build the separate graphics library
if not exist "%CHARTS%\package.json" (echo Missing sibling astrological-charts checkout. & goto :error)
pushd "%CHARTS%" || goto :error
call npm.cmd ci
if errorlevel 1 goto :failed
call npm.cmd run build:library
if errorlevel 1 goto :failed
if not exist ".local\demo-pack\manifests\approved-assets.json" (
  call npm.cmd run demo:pack
  if errorlevel 1 goto :failed
)
popd

echo [VirgoStars Desktop] Install dependencies and validate the synthetic build
pushd "%DESKTOP%" || goto :error
call npm.cmd install
if errorlevel 1 goto :failed
call npm.cmd test
if errorlevel 1 goto :failed
rem Audit the native IPC command registry and capabilities before any build.
call npm.cmd run verify:ipc
if errorlevel 1 goto :failed
call npm.cmd run doctor:build
if errorlevel 1 goto :failed
call npm.cmd run build:ui
if errorlevel 1 goto :failed
rem Confirm the actual emitted stylesheet is active before native packaging.
call npm.cmd run verify:css
if errorlevel 1 goto :failed
call npm.cmd run prepare:icon
if errorlevel 1 goto :failed
popd

echo [VirgoStars Desktop] Run Rust unit tests
pushd "%DESKTOP%\src-tauri" || goto :error
cargo test
if errorlevel 1 goto :failed
popd

echo [VirgoStars Desktop] Compile Tauri prototype and verify expected output
pushd "%DESKTOP%" || goto :error
rem Package the exact already-audited Angular output: tauri:build would rebuild it.
call npm.cmd exec --offline -- tauri build
if errorlevel 1 goto :failed
call npm.cmd run doctor:verify
if errorlevel 1 goto :failed
node scripts\verify-windows-pe.mjs
if errorlevel 1 goto :failed
popd
echo Build commands completed. This is NOT an installer or verified WebView2 release.
echo Test offline startup, all chart modes, real PNG export and native IPC on Windows.
exit /b 0

:failed
echo BUILD STOPPED: Review the last failing step. No files were deployed or published.
popd
exit /b 1

:error
echo BUILD STOPPED: Check folders and prerequisites in docs\WINDOWS_BUILD_GATE.md.
exit /b 1
