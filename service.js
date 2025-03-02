const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Get bridge path
const bridgePath = path.join(__dirname, 'bridge.js');
console.error('Starting DevTools service with bridge:', bridgePath);

// Track sent responses to prevent duplicates
let responsesSent = new Set();

// Function to start bridge process
function startBridge() {
    console.error('Starting DevTools bridge...');
    
    const bridge = spawn('node', [bridgePath], {
        // Inherit parent env but override specific vars
        env: {
            ...process.env,
            WS_PORT: '27125' // Changed from 27123 to 27125
        }
    });

    // Set up input buffer for bridge stdout
    let bridgeOutputBuffer = '';
    
    // Handle bridge stdout (responses to MCP)
    bridge.stdout.on('data', (data) => {
        console.error('[SERVICE] Received raw data from bridge:', data.toString());
        bridgeOutputBuffer += data.toString('utf8');
        
        let newlineIndex;
        while ((newlineIndex = bridgeOutputBuffer.indexOf('\n')) !== -1) {
            const response = bridgeOutputBuffer.slice(0, newlineIndex);
            bridgeOutputBuffer = bridgeOutputBuffer.slice(newlineIndex + 1);
            
            try {
                // Parse and validate JSON-RPC response
                const parsed = JSON.parse(response);
                if (typeof parsed !== 'object' || parsed === null) {
                    console.error('[SERVICE] Invalid JSON-RPC response: Not an object');
                    return;
                }
                
                if (parsed.jsonrpc !== '2.0') {
                    console.error('[SERVICE] Invalid JSON-RPC response: Wrong version or missing jsonrpc field');
                    return;
                }
                
                if (!('id' in parsed)) {
                    console.error('[SERVICE] Invalid JSON-RPC response: Missing id field');
                    return;
                }
                
                if (!('result' in parsed) && !('error' in parsed)) {
                    console.error('[SERVICE] Invalid JSON-RPC response: Missing result or error field');
                    return;
                }
                
                // Valid JSON-RPC 2.0 response, forward it once
                const responseId = parsed.id;
                if (responsesSent && responsesSent.has(responseId)) {
                    console.error(`[SERVICE] Response with ID ${responseId} already sent, skipping`);
                    return;
                }
                
                console.error('[SERVICE] Writing validated response to MCP:', response);
                process.stdout.write(response + '\n', (err) => {
                    if (err) {
                        console.error('[SERVICE] Error writing response:', err);
                    } else {
                        if (!responsesSent) responsesSent = new Set();
                        responsesSent.add(responseId);
                    }
                });
            } catch (error) {
                console.error('[SERVICE] Error processing bridge response:', error);
            }
        }
    });

    // Handle bridge stderr (logging)
    bridge.stderr.on('data', (data) => {
        console.error(`[Bridge] ${data.toString().trim()}`);
    });

    // Set up input buffer for MCP input
    let mcpInputBuffer = '';
    
    // Forward MCP input to bridge with explicit handling
    process.stdin.on('data', (data) => {
        console.error('[SERVICE] Received MCP input:', data.toString());
        mcpInputBuffer += data.toString('utf8');
        
        let newlineIndex;
        while ((newlineIndex = mcpInputBuffer.indexOf('\n')) !== -1) {
            const request = mcpInputBuffer.slice(0, newlineIndex);
            mcpInputBuffer = mcpInputBuffer.slice(newlineIndex + 1);
            
            try {
                // Validate it's a proper JSON-RPC request
                const parsed = JSON.parse(request);
                if (!parsed.jsonrpc || !parsed.method) {
                    console.error('[SERVICE] Invalid JSON-RPC request:', request);
                    return;
                }
                
                console.error('[SERVICE] Forwarding validated request to bridge:', request);
                bridge.stdin.write(request + '\n');
            } catch (error) {
                console.error('[SERVICE] Error processing MCP request:', error);
            }
        }
    });

    bridge.on('exit', (code, signal) => {
        console.error(`Bridge exited with code ${code} and signal ${signal}`);
        // Restart bridge after delay unless it was explicitly killed
        if (signal !== 'SIGTERM' && signal !== 'SIGINT') {
            console.error('Restarting bridge in 1 second...');
            setTimeout(startBridge, 1000);
        }
    });

    // Handle errors
    bridge.on('error', (error) => {
        console.error('Bridge process error:', error);
        // Error event will trigger exit handler
    });

    return bridge;
}

// Create pid file
const pidFile = path.join(__dirname, 'service.pid');
fs.writeFileSync(pidFile, process.pid.toString());
console.error('Service PID:', process.pid);

// Start initial bridge process
let bridgeProcess = startBridge();

// Log initial startup
console.error('DevTools service started');

// Cleanup handler
function cleanup() {
    console.error('Shutting down DevTools service...');
    if (bridgeProcess) {
        bridgeProcess.kill('SIGTERM');
    }
    try {
        fs.unlinkSync(pidFile);
    } catch (e) {
        // Ignore errors
    }
    process.exit(0);
}

// Handle shutdown signals
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    cleanup();
});
