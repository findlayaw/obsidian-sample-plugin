@echo off
title MCP Server for Obsidian

echo Starting MCP Server for Obsidian...
echo.

REM Check if the server is already running
tasklist /FI "IMAGENAME eq node.exe" /NH | find "node.exe" > nul
if %ERRORLEVEL% EQU 0 (
    echo Checking for existing MCP processes...
    for /f "tokens=1,2" %%a in ('tasklist /FI "IMAGENAME eq node.exe" /NH') do (
        echo Found node process: %%a with PID: %%b
        
        REM Check if this is our process by looking at command line
        wmic process where "ProcessId=%%b" get CommandLine | find "auto_service.js" > nul
        if %ERRORLEVEL% EQU 0 (
            echo Existing MCP service found. Stopping...
            taskkill /F /PID %%b
            timeout /t 2 /nobreak > nul
        )
        
        wmic process where "ProcessId=%%b" get CommandLine | find "auto_port_bridge.js" > nul
        if %ERRORLEVEL% EQU 0 (
            echo Existing MCP bridge found. Stopping...
            taskkill /F /PID %%b
            timeout /t 2 /nobreak > nul
        )
    )
)

echo Cleaning up temporary files...
if exist "%~dp0service.pid" del "%~dp0service.pid"
if exist "%~dp0bridge.pid" del "%~dp0bridge.pid"

echo Starting MCP service in minimized window...
start "Obsidian MCP Service" /min cmd /c "node %~dp0auto_service.js"

echo.
echo ======================================
echo MCP server started successfully!
echo ======================================
echo.
echo You can now connect to the MCP server.
echo The service is running in the background.
echo.
echo Press any key to exit this window...
pause > nul
