@echo off
title Stop MCP Server

echo Stopping MCP Server for Obsidian...
echo.

REM Find and kill MCP processes
echo Looking for MCP processes...
set FOUND_PROCESS=0

for /f "tokens=1,2" %%a in ('tasklist /FI "IMAGENAME eq node.exe" /NH') do (
    wmic process where "ProcessId=%%b" get CommandLine | find "auto_service.js" > nul
    if %ERRORLEVEL% EQU 0 (
        echo Found MCP service with PID: %%b
        taskkill /F /PID %%b
        set FOUND_PROCESS=1
    )
    
    wmic process where "ProcessId=%%b" get CommandLine | find "auto_port_bridge.js" > nul
    if %ERRORLEVEL% EQU 0 (
        echo Found MCP bridge with PID: %%b
        taskkill /F /PID %%b
        set FOUND_PROCESS=1
    )
)

if %FOUND_PROCESS% EQU 0 (
    echo No running MCP processes found.
) else (
    echo MCP processes have been terminated.
)

echo Cleaning up temporary files...
if exist "%~dp0service.pid" del "%~dp0service.pid"
if exist "%~dp0bridge.pid" del "%~dp0bridge.pid"

echo.
echo ======================================
echo MCP server stopped successfully!
echo ======================================
echo.
echo Press any key to exit...
pause > nul
