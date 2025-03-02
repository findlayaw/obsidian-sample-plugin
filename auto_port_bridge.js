const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// Constants
const DEFAULT_PORT = 27125; // Changed from 27123 to avoid conflicts
const PORT_RANGE = [27125, 27135]; // Try these ports in sequence
const DEBUG = true;
const PORT_FILE_PATH = path.join(__dirname, 'active_port.txt');

// Logging
function log(...args) {
    if (DEBUG) {
        console.error('[MCP-Bridge]', ...args);
    }
}

// Handle MCP standard input/output
process.stdin.setEncoding('utf8');
let inputBuffer = '';

// Track server state
let server = null;
let obsidianConnection = null;
const pendingRequests = new Map();
let currentPort = DEFAULT_PORT;
let isShuttingDown = false;

// Attempt to load last successful port
function loadLastSuccessfulPort() {
    try {
        if (fs.existsSync(PORT_FILE_PATH)) {
            const savedPort = parseInt(fs.readFileSync(PORT_FILE_PATH, 'utf8').trim());
            if (savedPort >= PORT_RANGE[0] && savedPort <= PORT_RANGE[1]) {
                currentPort = savedPort;
                log(`Loaded last successful port: ${currentPort}`);
            }
        }
    } catch (error) {
        log('Error loading saved port:', error.message);
    }
}

// Save successful port for future use
function saveSuccessfulPort(port) {
    try {
        fs.writeFileSync(PORT_FILE_PATH, port.toString());
        log(`Saved successful port: ${port}`);
    } catch (error) {
        log('Error saving port:', error.message);
    }
}

// Create WebSocket server with automatic port selection
async function createServer() {
    if (isShuttingDown) return;
    
    // Load last successful port first
    loadLastSuccessfulPort();
    
    // Try ports in sequence
    for (let port = currentPort; port <= PORT_RANGE[1]; port++) {
        try {
            log(`Attempting to create WebSocket server on port ${port}...`);
            
            // Create server asynchronously
            server = new WebSocket.Server({ port });
            
            // Wait for server to be ready
            await new Promise((resolve, reject) => {
                server.on('listening', () => {
                    currentPort = port;
                    log(`WebSocket server successfully started on port ${port}`);
                    
                    // Save this successful port for future use
                    saveSuccessfulPort(port);
                    resolve();
                });
                
                server.on('error', (err) => {
                    if (err.code === 'EADDRINUSE') {
                        log(`Port ${port} already in use, trying next port...`);
                        server.close();
                        // Don't reject, we'll try the next port
                    } else {
                        reject(err);
                    }
                });
            });
            
            // If we get here, server started successfully
            setupServerHandlers();
            return;
            
        } catch (error) {
            if (error.code !== 'EADDRINUSE') {
                log('Unexpected error creating server:', error);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            // Continue with next port
        }
    }
    
    // If we get here, all ports are in use
    log(`All ports in range ${PORT_RANGE[0]}-${PORT_RANGE[1]} are in use!`);
    log('Please check for processes using these ports and terminate them.');
    
    // Try again after a delay
    setTimeout(() => createServer(), 5000);
}

function setupServerHandlers() {
    if (!server) return;
    
    server.on('connection', (ws) => {
        log('Obsidian plugin connected');
        obsidianConnection = ws;

        ws.on('message', (data) => {
            try {
                const response = JSON.parse(data.toString());
                log('Received from Obsidian:', response);
                
                if (pendingRequests.has(response.id)) {
                    const { resolve, reject, timeout } = pendingRequests.get(response.id);
                    clearTimeout(timeout);
                    pendingRequests.delete(response.id);
                    
                    if (response.error) {
                        reject(new Error(typeof response.error === 'object' ? response.error.message : response.error));
                    } else {
                        resolve(response.result);
                    }
                } else {
                    log('No pending request for response:', response);
                }
            } catch (error) {
                log('Error handling WebSocket message:', error);
            }
        });

        ws.on('close', () => {
            log('Obsidian plugin disconnected');
            obsidianConnection = null;
            
            // Reject all pending requests
            for (const [id, { reject, timeout }] of pendingRequests.entries()) {
                clearTimeout(timeout);
                reject(new Error('WebSocket connection closed'));
            }
            pendingRequests.clear();
        });

        ws.on('error', (error) => {
            log('WebSocket connection error:', error);
        });
    });
    
    server.on('error', (error) => {
        log('WebSocket server error:', error);
        
        // Attempt to recreate server if it fails
        if (!isShuttingDown) {
            server.close(() => {
                log('Server closed after error, restarting...');
                setTimeout(createServer, 2000);
            });
        }
    });
    
    server.on('close', () => {
        log('WebSocket server closed');
        
        // Attempt to recreate server if it's closed unexpectedly
        if (!isShuttingDown) {
            setTimeout(createServer, 2000);
        }
    });
}

process.stdin.on('data', (chunk) => {
    inputBuffer += chunk;
    let newlineIndex;
    while ((newlineIndex = inputBuffer.indexOf('\n')) !== -1) {
        const line = inputBuffer.slice(0, newlineIndex);
        inputBuffer = inputBuffer.slice(newlineIndex + 1);
        try {
            const message = JSON.parse(line);
            log('Raw MCP input:', line);
            handleMcpRequest(message).catch(error => {
                log('Error handling MCP request:', error);
                sendMcpError(message.id, error.message);
            });
        } catch (error) {
            log('Error parsing message:', error, 'Raw line:', line);
        }
    }
});

process.stdin.on('end', () => {
    isShuttingDown = true;
    log('MCP bridge shutting down due to end of input');
    cleanup();
});

// Handle MCP requests
async function handleMcpRequest(message) {
    log('Handling MCP request:', message);
    try {
        const response = await processRequest(message);
        if (response !== null) {
            sendMcpResponse(message.id, response);
        }
    } catch (error) {
        log('Error in handleMcpRequest:', error);
        sendMcpError(message.id, error.message);
    }
}

// Process requests
async function processRequest(message) {
    log('Processing request:', message);

    switch (message.method) {
        case 'initialize':
            return {
                protocolVersion: '2024-11-05',
                capabilities: {},
                serverInfo: {
                    name: 'obsidian-devtools',
                    version: '1.0.0'
                }
            };
            
        case 'notifications/initialized':
            return {};

        case 'tools/list':
            return {
                tools: [
                    {
                        name: 'query_elements',
                        description: 'Query DOM elements using CSS selectors',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                selector: {
                                    type: 'string',
                                    description: 'CSS selector to find elements'
                                }
                            },
                            required: ['selector']
                        }
                    },
                    {
                        name: 'get_computed_styles',
                        description: 'Get computed styles for an element',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                selector: {
                                    type: 'string',
                                    description: 'CSS selector to target element'
                                }
                            },
                            required: ['selector']
                        }
                    },
                    {
                        name: 'get_console_logs',
                        description: 'Get recent console logs',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                limit: {
                                    type: 'number',
                                    description: 'Maximum number of logs to retrieve',
                                    default: 100
                                }
                            }
                        }
                    }
                ]
            };

        case 'tools/call':
            if (!obsidianConnection) {
                throw new Error('Not connected to Obsidian plugin');
            }
            log('tools/call - Original request:', message);
            const result = await forwardToObsidian(message.params);
            log('tools/call - Got result from Obsidian:', result);
            // Send using the original request ID to maintain correlation
            sendMcpResponse(message.id || 0, result);
            return null; // Prevent double response

        case 'resources/list':
            return { resources: [] };

        case 'resources/templates/list':
            return { resourceTemplates: [] };

        default:
            throw new Error(`Unknown method: ${message.method}`);
    }
}

let nextRequestId = 1;

// Forward request to Obsidian plugin
function forwardToObsidian(params) {
    const id = nextRequestId++;
    log('Forwarding to Obsidian:', id, params);
    
    return new Promise((resolve, reject) => {
        // Set up timeout
        const timeout = setTimeout(() => {
            if (pendingRequests.has(id)) {
                pendingRequests.delete(id);
                reject(new Error('Request timed out after 15 seconds'));
            }
        }, 15000); // 15 second timeout

        // Store request handlers
        pendingRequests.set(id, { resolve, reject, timeout });

        // Send request to plugin
        try {
            if (!obsidianConnection) {
                clearTimeout(timeout);
                pendingRequests.delete(id);
                reject(new Error('No connection to Obsidian plugin'));
                return;
            }
            
            const request = {
                id,
                name: params.name,
                arguments: params.arguments || {},
                jsonrpc: '2.0'
            };
            log('Sending request to plugin:', request);
            obsidianConnection.send(JSON.stringify(request));
        } catch (error) {
            clearTimeout(timeout);
            pendingRequests.delete(id);
            reject(error);
        }
    });
}

// Send MCP response
function sendMcpResponse(id, result) {
    const response = JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n';
    log('Raw response to be written:', response);
    process.stdout.write(response);
    // Force flush stdout
    process.stdout.write('');
}

// Send MCP error
function sendMcpError(id, error) {
    const response = JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: {
            code: -32603,
            message: error
        }
    }) + '\n';
    log('Sending MCP error:', { id, error });
    process.stdout.write(response);
}

// Health check
function performHealthCheck() {
    if (isShuttingDown) return;
    
    log('Health check status:', {
        serverPort: currentPort,
        hasServer: !!server,
        serverClientsCount: server ? server.clients.size : 0,
        hasObsidianConnection: !!obsidianConnection,
        pendingRequestsCount: pendingRequests.size,
        timestamp: new Date().toISOString()
    });
    
    // Schedule next health check
    setTimeout(performHealthCheck, 30000); // 30 second intervals
}

// Graceful cleanup
function cleanup() {
    isShuttingDown = true;
    log('Cleaning up resources...');
    
    // Close server if open
    if (server) {
        try {
            server.close(() => {
                log('Server closed gracefully');
            });
        } catch (error) {
            log('Error closing server:', error);
        }
    }
    
    // Clear timeouts
    for (const { timeout } of pendingRequests.values()) {
        clearTimeout(timeout);
    }
    
    log('Cleanup complete');
}

// Handle process signals
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
    log('Uncaught exception:', error);
    // Don't exit, try to recover
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    log('Unhandled rejection at:', promise, 'reason:', reason);
    // Don't exit, try to recover
});

// Start the server
log('Starting MCP bridge with auto port selection');
createServer().then(() => {
    log('MCP bridge initialized');
    // Start health checks after 10 seconds
    setTimeout(performHealthCheck, 10000);
}).catch(error => {
    log('Fatal error during startup:', error);
    process.exit(1);
});
