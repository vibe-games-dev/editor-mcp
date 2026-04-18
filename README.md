# editor-mcp

Local MCP server that bridges external MCP clients (Claude Desktop, Claude Code, Cursor, ...) to the Vibe Games editor running in the browser.

The server speaks:
- **stdio MCP** to the upstream MCP client.
- **WebSocket** (localhost only) to an editor tab, which connects as a WS client and announces its tool list.

Tool definitions are discovered dynamically — whatever tools the editor registers on connect become available to the MCP client.

## Install

```bash
pnpm install
pnpm build
```

## Run in dev

```bash
pnpm dev
```

## Run built

```bash
pnpm start
# or:
node dist/index.js
```

Environment:

- `PORT` — WebSocket port to listen on (default `7777`). Must match the port configured in the editor's settings.

## Wire up to Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "editor-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/editor-mcp/dist/index.js"],
      "env": { "PORT": "7777" }
    }
  }
}
```

Then open the Vibe Games editor, enable **Local MCP Server** in settings, and confirm the port matches.

## Protocol

```
Browser → Server
  { type: "hello",          tools: [...] }
  { type: "tools_changed",  tools: [...] }
  { type: "result", id, ok: true,  output }
  { type: "result", id, ok: false, error }

Server → Browser
  { type: "execute", id, name, input }
```
