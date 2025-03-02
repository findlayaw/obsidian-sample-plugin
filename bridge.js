const WebSocket = require('ws');

// Use environment variable or default port
const WS_PORT = process.env.WS_PORT ? parseInt(process.env.WS_PORT) : 27125;
console.error(`Starting bridge with port ${WS_PORT}`);

// Handle MCP standard input/output
process.stdin.setEncoding('utf8');
let inputBuffer = '';

// Debugging flag
const DEBUG = true;

function log(...args) {
    if (DEBUG) {
        console.error(...args);
    }
}

process.stdin.on('data', (chunk) => {
    inputBuffer += chunk;
    let newlineIndex;
    while ((newlineIndex = inputBuffer.indexOf('\n')) !== -1) {
        const line = inputBuffer.slice(0, newlineIndex);
        inputBuffer = inputBuffer.slice(newlineIndex + 1);
        try {
            const message = JSON.parse(line);
            log('[DEBUG] Raw MCP input:', line);
            log('[DEBUG] Parsed message:', message);
            if (message.method === 'tools/call') {
                log('[DEBUG] tools/call detected - Message ID:', message.id);
                log('[DEBUG] tools/call params:', message.params);
            }
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
    process.exit(0);
});

// Create WebSocket server
let server = null;
let portAttempts = 0;
const MAX_PORT_ATTEMPTS = 10;

function createServer() {
    try {
        // Current port we're trying to use
        const currentPort = WS_PORT + portAttempts;
        log(`Attempting to create WebSocket server on port ${currentPort}`);
        
        server = new WebSocket.Server({ 
            port: currentPort,
            // Add heartbeat to detect stale connections
            clientTracking: true,
            // Force close any existing sockets on the port
            handleProtocols: () => {
                return true;
            }
        }, () => {
            log(`WebSocket server successfully started on port ${currentPort}`);
            
            // If we used a different port than originally specified, inform the user
            if (portAttempts > 0) {
                log(`Note: Using alternative port ${currentPort} instead of default ${WS_PORT}`);
            }
            
            // Set up ping interval for detecting stale connections
            setInterval(() => {
                server.clients.forEach((client) => {
                    if (client.isAlive === false) {
                        log('Client connection is stale, terminating');
                        return client.terminate();
                    }
                    client.isAlive = false;
                    client.ping();
                });
            }, 5000);
        });
        setupServerHandlers();
    } catch (error) {
        log('Failed to create WebSocket server:', error);
        log('WebSocket server creation error details:', {
            name: error.name,
            message: error.message,
            stack: error.stack,
            port: WS_PORT + portAttempts
        });
        
        // Try with an alternative port if the current one is in use
        if (error.code === 'EADDRINUSE' && portAttempts < MAX_PORT_ATTEMPTS) {
            portAttempts++;
            log(`Port already in use, trying alternative port ${WS_PORT + portAttempts}`);
            setTimeout(createServer, 1000); // Try again after a short delay
        } else if (portAttempts >= MAX_PORT_ATTEMPTS) {
            log(`Error: Failed to find an available port after ${MAX_PORT_ATTEMPTS} attempts`);
            log('Please check for processes using ports in the range ' + 
                `${WS_PORT} - ${WS_PORT + MAX_PORT_ATTEMPTS}`);
            setTimeout(createServer, 5000); // Try again after a longer delay
        } else {
            // For other types of errors
            log(`Error: Failed to create server due to error: ${error.message}`);
            setTimeout(createServer, 3000); // Try again after a medium delay
        }
    }
}

let obsidianConnection = null;
const pendingRequests = new Map();

function setupServerHandlers() {
    server.on('connection', (ws) => {
        log('Obsidian plugin connected');
        
        // Close any existing connection
        if (obsidianConnection) {
            log('Closing existing connection');
            obsidianConnection.close();
        }
        
        obsidianConnection = ws;
        ws.isAlive = true;
        
        ws.on('pong', () => {
            ws.isAlive = true;
        });

        ws.on('message', (data) => {
            try {
                const responseStr = data.toString();
                log('Raw response from Obsidian:', responseStr);
                const response = JSON.parse(responseStr);
                log('Parsed response from Obsidian:', response);
                
                if (pendingRequests.has(response.id)) {
                    const { resolve, reject, timeout } = pendingRequests.get(response.id);
                    clearTimeout(timeout);
                    pendingRequests.delete(response.id);
                    
                    if (response.error) {
                        reject(new Error(typeof response.error === 'object' ? response.error.message : response.error));
                    } else {
                        log('Resolving promise with response data');
                        resolve(response.result);  // Just send the result, processRequest will format it
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
}

// Handle MCP requests
async function handleMcpRequest(message) {
    log('[DEBUG] handleMcpRequest started with message:', message);
    try {
        const response = await processRequest(message);
        log('[DEBUG] processRequest returned:', response);
        if (response !== null) {
            const formattedResponse = {
                jsonrpc: '2.0',
                id: message.id,
                result: response
            };
            log('[DEBUG] Sending MCP response for message ID:', message.id);
            sendMcpResponse(message.id, formattedResponse);
        } else {
            log('[DEBUG] Skipping response for message ID:', message.id, '(null response)');
        }
    } catch (error) {
        log('[DEBUG] Error in handleMcpRequest:', error);
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
                log('[DEBUG] tools/call - No Obsidian connection');
                return {
                    error: {
                        code: -32603,
                        message: 'Not connected to Obsidian plugin'
                    }
                };
            }
            
            try {
                log('[DEBUG] tools/call - Original request:', message);
                const result = await forwardToObsidian(message.params, message.id);
                log('[DEBUG] tools/call - Got result from Obsidian:', result);
                return result;
            } catch (error) {
                log('[DEBUG] tools/call - Error:', error);
                return {
                    error: {
                        code: -32603,
                        message: error.message || 'Error executing command'
                    }
                };
            }

        case 'resources/list':
            return { resources: [] };

        case 'resources/templates/list':
            return { resourceTemplates: [] };

        default:
            throw new Error(`Unknown method: ${message.method}`);
    }
}

// Forward request to Obsidian plugin
function forwardToObsidian(params, mcpRequestId) {
    log('Forwarding to Obsidian:', mcpRequestId, params);
    
    return new Promise((resolve, reject) => {
        // Set up timeout
        const timeout = setTimeout(() => {
            if (pendingRequests.has(mcpRequestId)) {
                pendingRequests.delete(mcpRequestId);
                reject(new Error('Request timed out'));
            }
        }, 15000);

        // Store request handlers
        pendingRequests.set(mcpRequestId, { resolve, reject, timeout });

        // Send request to plugin
        try {
            const request = {
                id: mcpRequestId,
                name: params.name,
                arguments: params.arguments || {},
                jsonrpc: '2.0'
            };
            log('Sending request to plugin:', request);
            const requestStr = JSON.stringify(request);
            log('Sending raw request string:', requestStr);
            obsidianConnection.send(requestStr);
        } catch (error) {
            clearTimeout(timeout);
            pendingRequests.delete(mcpRequestId);
            reject(error);
        }
    });
}

// Send MCP response
function sendMcpResponse(id, response) {
    const responseStr = JSON.stringify(response) + '\n';
    log('[DEBUG] Raw response to be written:', responseStr);
    try {
        process.stdout.write(responseStr);
        // Ensure the write is complete
        if (!process.stdout.write('')) {
            process.stdout.once('drain', () => {
                log('[DEBUG] stdout drained after response');
            });
        }
    } catch (error) {
        log('[DEBUG] Error writing response:', error);
    }
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
    try {
        process.stdout.write(response);
        // Ensure the write is complete
        if (!process.stdout.write('')) {
            process.stdout.once('drain', () => {
                log('[DEBUG] stdout drained after error response');
            });
        }
    } catch (error) {
        log('[DEBUG] Error writing error response:', error);
    }
}

// Add health check mechanism
function performHealthCheck() {
    // Log current state
    log('Health check status:', {
        hasServer: !!server,
        serverClientsCount: server ? server.clients.size : 0,
        hasObsidianConnection: !!obsidianConnection,
        pendingRequestsCount: pendingRequests.size,
        wsPort: WS_PORT,
        timestamp: new Date().toISOString()
    });
    
    // Check for stuck requests
    const now = Date.now();
    for (const [id, { timeout }] of pendingRequests.entries()) {
        const requestAge = now - timeout._idleStart;
        if (requestAge > 10000) { // 10 seconds
            log(`Warning: Request ${id} has been pending for ${requestAge}ms`);
        }
    }
    
    // Schedule next health check
    setTimeout(performHealthCheck, 10000); // Run every 10 seconds
}

// Start the server
createServer();
// Start health checks
setTimeout(performHealthCheck, 5000); // First check after 5 seconds

// Cleanup on exit
process.on('SIGINT', () => {
    if (server) {
        server.close();
    }
    process.exit(0);
});
