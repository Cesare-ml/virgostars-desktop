@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem Delegate to the single reviewed Windows x64 bootstrap; do not duplicate builds.
rem No execution-policy changes, extra downloads or production operations.
rem Avoid PATH/current-directory hijacking of an unqualified powershell.exe.
rem Use the Windows-supplied host; execution policy and profiles are unchanged.
set "VS_SYSTEM_POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%VS_SYSTEM_POWERSHELL%" (
    echo BUILD STOPPED: Windows PowerShell is required for this prototype. 1>&2
    exit /b 1
)
"%VS_SYSTEM_POWERSHELL%" -NoProfile -NonInteractive -File "%~dp0build-windows-spike.ps1"
set "VS_BUILD_EXIT=%ERRORLEVEL%"
exit /b %VS_BUILD_EXIT%
