# Upgrading Obsidian MCP DevTools

This guide explains how to upgrade from the original version to the enhanced version with improved reliability.

## Files to Keep

These files should be kept as they are part of the core plugin:

- `main.js` - The main plugin code
- `main.ts` - Source TypeScript file
- `manifest.json` - Plugin manifest
- `styles.css` - Plugin styles
- `.editorconfig` - Editor configuration
- `.eslintignore` - ESLint configuration
- `.eslintrc` - ESLint rules
- `.gitignore` - Git ignore rules
- `.npmrc` - NPM configuration
- `esbuild.config.mjs` - Build configuration
- `tsconfig.json` - TypeScript configuration
- `LICENSE` - License file
- `package.json` - Package configuration
- `package-lock.json` - Package lock file
- `version-bump.mjs` - Version bump script
- `versions.json` - Version history

## Files to Replace

These files have been enhanced and should use the new versions:

| Old File | New File | Purpose |
|----------|----------|---------|
| `bridge.js` | `auto_port_bridge.js` | Enhanced WebSocket bridge with automatic port selection |
| `service.js` | `auto_service.js` | Improved service wrapper with health checks and logging |

## New Files

These new files provide additional functionality:

- `start_mcp.bat` - Easy start script
- `stop_mcp.bat` - Easy stop script
- `mcp_service.log` - Log file (created automatically)
- `active_port.txt` - Port tracking file (created automatically)

## Installation Steps

1. Back up your original files if needed
2. Keep all files in the "Files to Keep" section
3. Replace the files in the "Files to Replace" section with their new versions
4. Add the new files in the "New Files" section
5. Run `start_mcp.bat` to start the enhanced MCP server

## Configuring Claude and Other MCP Clients

When configuring your MCP client, use `auto_service.js` instead of the original `service.js`. For example, in your `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "obsidian-devtools": {
      "command": "node",
      "args": [
        "C:\\path\\to\\obsidian-devtools-mcp\\auto_service.js"
      ],
      ...
    }
  }
}
```

## Temporary Files

The following files are created during operation and can be safely deleted when the server is not running:

- `service.pid` - Service process ID
- `bridge.pid` - Bridge process ID
- `active_port.txt` - Currently active port

## Files That Can Be Removed

These files are no longer needed and can be safely removed:

- `restart.ps1` - Replaced by `start_mcp.bat` and `stop_mcp.bat`
- `install.ps1` - No longer needed
- `uninstall.ps1` - No longer needed

## Troubleshooting

If you encounter issues after upgrading:

1. Run `stop_mcp.bat` to stop all MCP processes
2. Delete any temporary files: `service.pid`, `bridge.pid`, `active_port.txt`
3. Try running `start_mcp.bat` again
4. Check the `mcp_service.log` file for any error messages
