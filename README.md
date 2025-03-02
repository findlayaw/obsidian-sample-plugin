# Obsidian DevTools MCP Integration

A Model Context Protocol (MCP) server implementation for Obsidian that provides programmatic access to Obsidian's developer tools. This allows AI assistants to interact with Obsidian's console and Elements panel.

## Features

- Full MCP compatibility for AI assistants like Claude
- Automatic port selection to avoid conflicts
- Robust error handling and recovery
- Detailed logging
- Simple one-click start/stop

## Installation

### Option 1: Easy Installation (Recommended)

1. Download all files to your Obsidian plugins directory
2. Run `start_mcp.bat` to start the MCP server

### Option 2: Manual Installation

1. Create the plugin directory:
   ```powershell
   # Windows
   mkdir "%APPDATA%\Obsidian\plugins\obsidian-devtools-mcp"
   ```

2. Copy these files to the plugin directory:
   ```powershell
   # Required plugin files
   copy "main.js" "%APPDATA%\Obsidian\plugins\obsidian-devtools-mcp\"
   copy "manifest.json" "%APPDATA%\Obsidian\plugins\obsidian-devtools-mcp\"
   copy "styles.css" "%APPDATA%\Obsidian\plugins\obsidian-devtools-mcp\"
   
   # New MCP bridge files (recommended)
   copy "auto_port_bridge.js" "%APPDATA%\Obsidian\plugins\obsidian-devtools-mcp\"
   copy "auto_service.js" "%APPDATA%\Obsidian\plugins\obsidian-devtools-mcp\"
   copy "start_mcp.bat" "%APPDATA%\Obsidian\plugins\obsidian-devtools-mcp\"
   copy "stop_mcp.bat" "%APPDATA%\Obsidian\plugins\obsidian-devtools-mcp\"
   ```

3. Start the improved MCP service:
   ```powershell
   # Run the batch file for automatic startup
   start_mcp.bat
   
   # Or start manually
   node auto_service.js
   ```

## Configuration

1. Ensure your `cline_mcp_settings.json` includes the devtools configuration:
   ```json
   {
     "mcpServers": {
       "obsidian-devtools": {
         "command": "node",
         "args": [
           "C:\\repos\\obsidian-MCP\\obsidian-devtools-plugin\\auto_service.js"
         ],
         "env": {
           "PATH": "%PATH%;C:\\Program Files\\nodejs"
         },
         "disabled": false,
         "autoApprove": [
           "query_elements",
           "get_computed_styles",
           "get_console_logs"
         ],
         "alwaysAllow": [
           "query_elements",
           "get_computed_styles",
           "get_console_logs"
         ]
       }
     }
   }
   ```

   > **Note**: Make sure to update the path to point to your actual installation directory

## Features

The plugin provides three main tools:

1. `query_elements`: Query DOM elements using CSS selectors
   ```typescript
   use_mcp_tool({
     server_name: "obsidian-devtools",
     tool_name: "query_elements",
     arguments: {
       selector: ".workspace"
     }
   });
   ```

2. `get_computed_styles`: Get computed styles for elements
   ```typescript
   use_mcp_tool({
     server_name: "obsidian-devtools",
     tool_name: "get_computed_styles",
     arguments: {
       selector: ".workspace-split"
     }
   });
   ```

3. `get_console_logs`: Access console logs
   ```typescript
   use_mcp_tool({
     server_name: "obsidian-devtools",
     tool_name: "get_console_logs",
     arguments: {
       limit: 50
     }
   });
   ```

## Status Indicators

The plugin provides visual feedback through:
- Status bar item showing connection status
- Console logs for detailed debugging
- A bug icon in the ribbon for toggling DevTools

## Troubleshooting

### Common Issues:

1. **Connection Issues**:
   - Check that Obsidian is running and the plugin is enabled
   - The server will now automatically find an available port between 27125-27135
   - Check your MCP client (Claude, VSCode, etc.) is running with the latest settings

2. **If tool calls fail**:
   - Run `stop_mcp.bat` and then `start_mcp.bat` to restart the MCP server
   - Check the `mcp_service.log` file for detailed error messages
   - Verify the auto_service.js process is running (check Task Manager)

3. **Common Error Messages**:
   - "Not connected": The WebSocket connection is not established
   - "Port in use": The auto port selection should prevent this, but you can manually verify
   - "Request timed out": The plugin didn't respond within 15 seconds

4. **Debug Steps**:
   - Check the log file at `mcp_service.log` for detailed diagnostic information
   - Enable Developer Tools in Obsidian to view console messages
   - Run `netstat -ano | findstr "2712"` to check for processes using relevant ports

5. **Manual Cleanup**:
   - Run `stop_mcp.bat` to properly terminate all processes
   - Delete temporary files: `service.pid`, `bridge.pid`, and `active_port.txt`
   - Restart Obsidian and your MCP client

## Development

1. Clone the repository
2. Install dependencies: `npm install`
3. Build the plugin: `npm run build`
4. For development: `npm run dev`

## Architecture

The plugin uses a robust three-part architecture:

1. **Obsidian Plugin** (main.ts) - Handles DOM interaction and UI elements in Obsidian

2. **Bridge Server** (auto_port_bridge.js) - Manages WebSocket communication with:
   - Automatic port selection to avoid conflicts
   - Robust error handling and recovery
   - Detailed logging capabilities
   - Graceful shutdown and cleanup

3. **Service Wrapper** (auto_service.js) - Provides system-level features:
   - Process management and monitoring
   - Health checks and automatic restarts
   - Input/output handling
   - Log file management

This enhanced architecture ensures reliable operation even in complex environments with multiple MCP clients or services running simultaneously.

## License

MIT License. See LICENSE file for details.
