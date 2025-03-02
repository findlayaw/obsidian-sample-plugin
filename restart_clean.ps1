# Enhanced restart script for Obsidian MCP DevTools plugin
Write-Host "=== Obsidian MCP DevTools Clean Restart ===" -ForegroundColor Blue
Write-Host "This script will kill all related processes and restart the MCP server." -ForegroundColor Cyan

# Find and kill all Node.js processes that might be running our service
Write-Host "`nStep 1: Stopping all related Node.js processes..." -ForegroundColor Yellow
$nodeProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue
$foundMcpProcess = $false

foreach ($process in $nodeProcesses) {
    try {
        # Try to get the command line of the process to identify if it's ours
        $cmd = (Get-WmiObject Win32_Process -Filter "ProcessId = $($process.Id)").CommandLine
        if ($cmd -match "bridge\.js|service\.js") {
            Write-Host "Killing Node.js process (PID: $($process.Id)) - $cmd" -ForegroundColor Red
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            $foundMcpProcess = $true
        }
    } catch {
        # If we can't get command line, just log the process
        Write-Host "Found Node.js process (PID: $($process.Id)) but couldn't determine if related" -ForegroundColor Gray
    }
}

if (-not $foundMcpProcess) {
    Write-Host "No MCP-related Node.js processes found." -ForegroundColor Green
}

# Check for and remove PID files
Write-Host "`nStep 2: Cleaning up PID files..." -ForegroundColor Yellow
if (Test-Path ".\service.pid") {
    Remove-Item -Force ".\service.pid" -ErrorAction SilentlyContinue
    Write-Host "Removed service.pid" -ForegroundColor Green
}
if (Test-Path ".\bridge.pid") {
    Remove-Item -Force ".\bridge.pid" -ErrorAction SilentlyContinue
    Write-Host "Removed bridge.pid" -ForegroundColor Green
}

# Clear ports that might be in use
Write-Host "`nStep 3: Checking for processes using relevant ports..." -ForegroundColor Yellow
$ports = @(27123, 27124, 27125, 27126, 27127, 27128, 27129, 27130)
foreach ($port in $ports) {
    $portProcess = netstat -ano | findstr ":$port"
    if ($portProcess) {
        $pid = ($portProcess -split ' ')[-1]
        try {
            $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
            if ($process) {
                Write-Host "Found process using port $port (PID: $pid, Name: $($process.ProcessName))" -ForegroundColor Red
                Write-Host "Killing process..." -ForegroundColor Red
                Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                Write-Host "Process terminated." -ForegroundColor Green
            }
        } catch {
            Write-Host "Couldn't get information about process using port $port" -ForegroundColor Gray
        }
    } else {
        Write-Host "Port $port is available." -ForegroundColor Green
    }
}

# Wait for ports to be completely released
Write-Host "`nStep 4: Waiting for resources to be released..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

# Start the service in a new window
Write-Host "`nStep 5: Starting MCP DevTools service..." -ForegroundColor Yellow
try {
    Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command `"cd '$pwd'; node service.js`"" -WindowStyle Minimized
    Write-Host "Service started in a minimized PowerShell window." -ForegroundColor Green
} catch {
    Write-Host "Error starting service: $_" -ForegroundColor Red
    Exit 1
}

Write-Host "`n=== Restart Complete ===" -ForegroundColor Blue
Write-Host "The MCP service should now be running in a minimized PowerShell window."
Write-Host "You can now try connecting to the MCP server again."
Write-Host "If issues persist, check which processes are using ports in the 27123-27130 range."
