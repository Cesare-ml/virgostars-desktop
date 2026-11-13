@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem Delegate to the single reviewed Windows x64 bootstrap; do not duplicate builds.
rem No execution-policy changes, extra downloads or production operations.
where powershell.exe >nul 2>nul
if errorlevel 1 (
    echo BUILD STOPPED: Windows PowerShell is required for this prototype. 1>&2
    exit /b 1
)
powershell.exe -NoProfile -NonInteractive -File "%~dp0build-windows-spike.ps1"
set "VS_BUILD_EXIT=%ERRORLEVEL%"
exit /b %VS_BUILD_EXIT%
