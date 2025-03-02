const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Configuration
const BRIDGE_PATH = path.join(__dirname, 'auto_port_bridge.js');
const PID_FILE = path.join(__dirname, 'service.pid');
const BRIDGE_PID_FILE = path.join(__dirname, 'bridge.pid');
const LOG_FILE = path.join(__dirname, 'mcp_service.log');
const CHECK_INTERVAL = 10000; // 10 seconds
const MAX_RESTARTS = 5;
const RESTART_COOLDOWN = 60000; // 1 minute

// Initialize state
let bridgeProcess = null;
let restartCount = 0;
let lastRestartTime = 0;
let shutdownRequested = false;
let logStream = null;

// Setup logging
function setupLogging() {
    try {
        // Create or append to log file
        logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
        
        // Add timestamp to log entries
        const originalWrite = logStream.write;
        logStream.write = function(chunk, encoding, callback) {
            const timestamp = new Date().toISOString();
            return originalWrite.call(this, `[${timestamp}] ${chunk}`, encoding, callback);
        };
        
        console.log(`Logging to ${LOG_FILE}`);
    } catch (error) {
        console.error('Failed to set up logging:', error);
    }
}

// Log with timestamp
function log(message) {
    const logMessage = typeof message === 'string' ? message : JSON.stringify(message);
    
    // Log to console
    console.log(logMessage);
    
    // Log to file if available
    if (logStream) {
        logStream.write(logMessage + os.EOL);
    }
}

// Create PID file
function createPidFile() {
    try {
        fs.writeFileSync(PID_FILE, process.pid.toString());
        log(`Service PID: ${process.pid}`);
    } catch (error) {
        log(`Failed to create PID file: ${error.message}`);
    }
}

// Check if a process is running
function isProcessRunning(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return false;
    }
}

// Kill process by PID
function killProcess(pid) {
    try {
        if (isProcessRunning(pid)) {
            log(`Killing process with PID ${pid}`);
            
            if (process.platform === 'win32') {
                // Windows
                spawn('taskkill', ['/F', '/PID', pid]);
            } else {
                // Unix-like
                process.kill(pid, 'SIGTERM');
            }
            return true;
        }
    } catch (error) {
        log(`Failed to kill process ${pid}: ${error.message}`);
    }
    return false;
}

// Clean up existing processes
function cleanupExistingProcesses() {
    // Check for existing service PID
    if (fs.existsSync(PID_FILE)) {
        try {
            const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'));
            if (pid && pid !== process.pid) {
                killProcess(pid);
            }
        } catch (error) {
            log(`Failed to read service PID file: ${error.message}`);
        }
    }
    
    // Check for existing bridge PID
    if (fs.existsSync(BRIDGE_PID_FILE)) {
        try {
            const pid = parseInt(fs.readFileSync(BRIDGE_PID_FILE, 'utf8'));
            if (pid) {
                killProcess(pid);
            }
        } catch (error) {
            log(`Failed to read bridge PID file: ${error.message}`);
        }
    }
    
    // Clean up PID files
    try {
        if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
        if (fs.existsSync(BRIDGE_PID_FILE)) fs.unlinkSync(BRIDGE_PID_FILE);
    } catch (error) {
        log(`Failed to clean up PID files: ${error.message}`);
    }
}

// Start bridge process
function startBridge() {
    if (shutdownRequested) return null;
    
    log(`Starting MCP bridge: ${BRIDGE_PATH}`);

    // Check if we should throttle restarts
    const now = Date.now();
    if (restartCount >= MAX_RESTARTS && (now - lastRestartTime) < RESTART_COOLDOWN) {
        log(`Too many restarts (${restartCount}) in a short period. Cooling down for ${RESTART_COOLDOWN/1000} seconds.`);
        setTimeout(() => {
            restartCount = 0;
            startBridge();
        }, RESTART_COOLDOWN);
        return null;
    }
    
    try {
        // Create bridge process
        const bridge = spawn('node', [BRIDGE_PATH], {
            env: {
                ...process.env,
                NODE_OPTIONS: '--no-deprecation'
            },
            stdio: ['pipe', 'pipe', 'pipe']
        });
        
        // Save bridge PID
        if (bridge.pid) {
            fs.writeFileSync(BRIDGE_PID_FILE, bridge.pid.toString());
            log(`Bridge PID: ${bridge.pid}`);
        }
        
        // Handle bridge output
        bridge.stdout.on('data', (data) => {
            try {
                // Process bridge responses
                process.stdout.write(data);
            } catch (error) {
                log(`Error processing bridge output: ${error.message}`);
            }
        });
        
        // Handle bridge errors/logs
        bridge.stderr.on('data', (data) => {
            log(`Bridge: ${data.toString().trim()}`);
        });
        
        // Handle bridge exit
        bridge.on('exit', (code, signal) => {
            log(`Bridge exited with code ${code} and signal ${signal}`);
            
            // Update restart tracking
            restartCount++;
            lastRestartTime = Date.now();
            
            // Restart bridge if not explicitly killed
            if (!shutdownRequested && signal !== 'SIGTERM' && signal !== 'SIGINT') {
                log(`Restarting bridge in 2 seconds (restart count: ${restartCount})`);
                setTimeout(() => {
                    bridgeProcess = startBridge();
                }, 2000);
            }
        });
        
        // Handle bridge process errors
        bridge.on('error', (error) => {
            log(`Bridge process error: ${error.message}`);
            // Process error event will trigger exit handler
        });
        
        // Forward stdin to bridge
        process.stdin.pipe(bridge.stdin);
        
        return bridge;
    } catch (error) {
        log(`Failed to start bridge: ${error.message}`);
        return null;
    }
}

// Periodic health check
function startHealthCheck() {
    if (shutdownRequested) return;
    
    const interval = setInterval(() => {
        if (shutdownRequested) {
            clearInterval(interval);
            return;
        }
        
        // Check if bridge is running
        if (bridgeProcess && !isProcessRunning(bridgeProcess.pid)) {
            log('Health check: Bridge process is not running, restarting...');
            bridgeProcess = startBridge();
        }
        
        // Log current state
        log(`Health check: Service running (PID: ${process.pid}), Bridge running: ${bridgeProcess ? 'Yes' : 'No'}`);
        
    }, CHECK_INTERVAL);
}

// Cleanup on exit
function cleanup() {
    shutdownRequested = true;
    log('Shutting down MCP service...');
    
    // Kill bridge process
    if (bridgeProcess) {
        try {
            bridgeProcess.kill('SIGTERM');
        } catch (error) {
            log(`Error stopping bridge process: ${error.message}`);
        }
    }
    
    // Clean up PID files
    try {
        if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
        if (fs.existsSync(BRIDGE_PID_FILE)) fs.unlinkSync(BRIDGE_PID_FILE);
    } catch (error) {
        log(`Error cleaning up PID files: ${error.message}`);
    }
    
    // Close log stream
    if (logStream) {
        logStream.end('Service shutdown complete\n');
    }
    
    log('Service cleanup complete');
}

// Handle signals
process.on('SIGINT', () => {
    log('Received SIGINT signal');
    cleanup();
    process.exit(0);
});

process.on('SIGTERM', () => {
    log('Received SIGTERM signal');
    cleanup();
    process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    log(`Uncaught exception: ${error.message}`);
    log(error.stack);
    cleanup();
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    log('Unhandled rejection at:');
    log(promise);
    log('Reason:');
    log(reason);
    // Don't exit - try to continue running
});

// Main function
function main() {
    setupLogging();
    log('=== MCP Service Starting ===');
    log(`Node.js version: ${process.version}`);
    log(`Platform: ${process.platform}`);
    
    // Clean up any existing processes
    cleanupExistingProcesses();
    
    // Create PID file
    createPidFile();
    
    // Start bridge process
    bridgeProcess = startBridge();
    
    // Start health check
    startHealthCheck();
    
    log('MCP service started successfully');
}

// Start the service
main();
