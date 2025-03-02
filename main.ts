import { App, Plugin } from 'obsidian';

interface DevToolsInspectResult {
    nodeId: string;
    nodeName: string;
    attributes: Record<string, string>;
    computed: Record<string, string>;
}

interface BridgeMessage {
    id: number;
    name: string;
    arguments: any;
}

// Try ports in this range (27125-27135) to align with auto_port_bridge.js
const WS_PORTS = Array.from({length: 11}, (_, i) => 27125 + i);
const DEBUG = true;

function log(...args: any[]) {
    if (DEBUG) {
        console.log('[DevTools MCP]', ...args);
    }
}

export default class ObsidianDevToolsPlugin extends Plugin {
    private webSocket: WebSocket | null = null;
    private consoleMessages: any[] = [];
    private statusBarEl: HTMLElement | null = null;
    private reconnectTimeout: number | null = null;
    private attemptCount: number = 0;
    private currentPortIndex: number = 0;
    private lastActivePort: number | null = null;
    private reconnecting: boolean = false;

    async onload() {
        log('Loading plugin...');

        // Add a ribbon icon for toggling DevTools
        const ribbonIcon = this.addRibbonIcon('bug', 'Toggle DevTools', () => {
            // @ts-ignore - Using internal Electron API
            if (this.app.win?.webContents) {
                // @ts-ignore
                this.app.win.webContents.toggleDevTools();
            }
        });
        
        ribbonIcon.addClass('obsidian-devtools-mcp-icon');

        // Set up console capture
        this.setupConsoleCapture();

        // Add status bar item
        this.statusBarEl = this.addStatusBarItem();
        this.updateStatus('Initializing...');

        // Initial connection attempt
        this.connectToServer();

        log('Plugin loaded');
    }

    onunload() {
        log('Unloading plugin...');
        if (this.reconnectTimeout) {
            window.clearTimeout(this.reconnectTimeout);
        }
        this.webSocket?.close();
        this.restoreConsole();
        log('Plugin unloaded');
    }

    private updateStatus(status: string) {
        log('Status:', status);
        if (this.statusBarEl) {
            this.statusBarEl.setText(`DevTools MCP: ${status}`);
        }
    }

    private connectToServer() {
        // Prevent multiple connection attempts running simultaneously
        if (this.reconnecting) {
            log('Already attempting to reconnect, skipping...');
            return;
        }

        this.reconnecting = true;

        try {
            // Try to load last active port from localStorage if available
            if (this.lastActivePort === null) {
                try {
                    const savedPort = localStorage.getItem('devtools-mcp-port');
                    if (savedPort) {
                        const port = parseInt(savedPort);
                        // Find index of this port or default to 0
                        const index = WS_PORTS.indexOf(port);
                        if (index >= 0) {
                            this.currentPortIndex = index;
                            log('Using saved port:', port, 'at index', index);
                        }
                    }
                } catch (e) {
                    log('Error loading saved port:', e);
                }
            }

            // Get current port to try
            const port = WS_PORTS[this.currentPortIndex];
            this.updateStatus(`Connecting to port ${port}...`);
            log('Connecting to WebSocket on port', port);

            this.webSocket = new WebSocket(`ws://localhost:${port}`);

            this.webSocket.onopen = () => {
                log('Connected to DevTools bridge server on port', port);
                this.updateStatus(`Connected to port ${port}`);
                this.attemptCount = 0;
                this.lastActivePort = port;
                this.reconnecting = false;
                
                // Save successful port for future attempts
                try {
                    localStorage.setItem('devtools-mcp-port', port.toString());
                } catch (e) {
                    log('Error saving port:', e);
                }
            };

            this.webSocket.onmessage = async (event) => {
                try {
                    const message = JSON.parse(event.data) as BridgeMessage;
                    log('Received message:', message);
                    
                    try {
                        const result = await this.executeCommand(message);
                        log('Command result:', result);
                        
                        const response = {
                            jsonrpc: '2.0',
                            id: message.id,
                            result: result
                        };
                        log('Sending response:', response);
                        this.webSocket?.send(JSON.stringify(response));
                    } catch (cmdError: any) {
                        log('Command error:', cmdError);
                        this.webSocket?.send(JSON.stringify({
                            jsonrpc: '2.0',
                            id: message.id,
                            error: {
                                code: -32603,
                                message: cmdError.message || 'Unknown command error'
                            }
                        }));
                    }
                } catch (error: any) {
                    log('Message parsing error:', error);
                    this.webSocket?.send(JSON.stringify({
                        jsonrpc: '2.0',
                        id: -1,
                        error: {
                            code: -32700,
                            message: 'Invalid message format'
                        }
                    }));
                }
            };

            this.webSocket.onerror = (error: Event) => {
                log('WebSocket error:', error);
                this.updateStatus('Error');
            };

            this.webSocket.onclose = () => {
                log('Disconnected from DevTools bridge server');
                this.updateStatus('Disconnected');
                
                // If we had a successful connection before, keep trying the same port
                if (this.lastActivePort !== null) {
                    this.currentPortIndex = WS_PORTS.indexOf(this.lastActivePort);
                }
                
                // Aggressive reconnection with very short initial delay
                const delay = Math.min(50 * Math.pow(1.1, this.attemptCount), 1000);
                this.attemptCount++;
                
                log(`Attempting reconnect to port ${WS_PORTS[this.currentPortIndex]} in ${delay}ms`);
                
                if (this.reconnectTimeout) {
                    window.clearTimeout(this.reconnectTimeout);
                }
                
                // Reset attempt count after 10 tries to prevent backoff from getting too long
                if (this.attemptCount > 10) {
                    this.attemptCount = 0;
                }
                
                this.reconnectTimeout = window.setTimeout(() => {
                    this.reconnecting = false; // Reset reconnecting flag
                    this.connectToServer();  // Actually try to reconnect
                }, delay);
            };
        } catch (error) {
            this.updateStatus('Connection Failed');
            
            // Reset reconnecting flag and try again after shorter delay
            this.reconnecting = false;
            
            // Try next port with a shorter delay
            this.currentPortIndex = (this.currentPortIndex + 1) % WS_PORTS.length;
            const delay = Math.min(100 * Math.pow(1.2, this.attemptCount), 2000);
            
            // Reset attempt count after 10 tries
            if (this.attemptCount > 10) {
                this.attemptCount = 0;
            }
            
            if (this.reconnectTimeout) {
                window.clearTimeout(this.reconnectTimeout);
            }
            
            this.reconnectTimeout = window.setTimeout(() => {
                this.connectToServer();
            }, delay);
        }
    }

    private async executeCommand(message: BridgeMessage) {
        log('Executing command:', message);
        
        if (!this.app.workspace) {
            throw new Error('Workspace not available');
        }

        switch (message.name) {
            case 'query_elements':
                return await this.queryElements(message.arguments.selector);
            case 'get_computed_styles':
                return await this.getComputedStyles(message.arguments.selector);
            case 'get_console_logs':
                return await this.getConsoleLogs(message.arguments.limit);
            default:
                throw new Error(`Unknown command: ${message.name}`);
        }
    }

    private async queryElements(selector: string) {
        log('Querying elements:', selector);
        try {
            const elements = document.querySelectorAll(selector);
            if (elements.length === 0) {
                log('No elements found for selector:', selector);
            }
            
            const results = Array.from(elements).map(el => ({
                nodeName: el.nodeName,
                innerHTML: el.innerHTML,
                className: el.className,
                id: el.id,
                textContent: el.textContent?.trim() || '',
                // Add basic element properties that won't cause circular references
                attributes: Object.fromEntries(
                    Array.from(el.attributes || [])
                        .map(attr => [attr.name, attr.value])
                ),
                children: Array.from(el.children).length,
                tagName: el.tagName.toLowerCase()
            }));
            
            log('Query results:', results);
            return results;
        } catch (error) {
            log('Query error:', error);
            throw error;
        }
    }

    private async getComputedStyles(selector: string) {
        log('Getting styles for:', selector);
        const element = document.querySelector(selector);
        if (!element) {
            log('Element not found:', selector);
            return null;
        }
        
        try {
            const computed = window.getComputedStyle(element);
            const styles = Object.fromEntries(
                Array.from(computed).map(key => [key, computed.getPropertyValue(key)])
            );
            
            log('Style results:', styles);
            return styles;
        } catch (error) {
            log('Style error:', error);
            throw error;
        }
    }

    private originalConsole: Record<string, any> = {};

    private setupConsoleCapture() {
        log('Setting up console capture');
        // Store original console methods
        ['log', 'info', 'warn', 'error'].forEach(method => {
            this.originalConsole[method] = console[method];
            (console as any)[method] = (...args: any[]) => {
                // Call original method
                this.originalConsole[method](...args);
                
                // Store message
                this.consoleMessages.push({
                    type: method,
                    message: args.map(arg => 
                        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
                    ).join(' '),
                    timestamp: new Date().toISOString()
                });

                // Keep only last 1000 messages
                if (this.consoleMessages.length > 1000) {
                    this.consoleMessages.shift();
                }
            };
        });
    }

    private restoreConsole() {
        log('Restoring console methods');
        // Restore original console methods
        Object.keys(this.originalConsole).forEach(method => {
            (console as any)[method] = this.originalConsole[method];
        });
    }

    private async getConsoleLogs(limit: number = 100) {
        log('Getting console logs, limit:', limit);
        const logs = this.consoleMessages.slice(-limit);
        log('Console logs:', logs);
        return logs;
    }
}
