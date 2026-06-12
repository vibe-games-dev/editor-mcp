# @vibegames/editor-mcp

Use MCP clients like Claude Code or Codex with the [vibe-games.ai](https://vibe-games.ai) browser editor, so the editor's tools are available directly in your coding assistant.

Several editor tabs and several MCP clients can run at once and stay paired by a per-tab session token, without their tool calls crossing over.

## Setup

1. Open [vibe-games.ai](https://vibe-games.ai).
2. Go to **Settings → AI → MCP**.
3. Choose **Claude Code** or **Codex**.
4. Paste the generated command into your shell.
5. Restart the MCP client.

## MCP client config

The only required value is `VIBEGAMES_MCP_SESSION`, generated per editor tab.

### Claude Code

```json
{
  "mcpServers": {
    "vibe-games-editor": {
      "command": "npx",
      "args": ["-y", "@vibegames/editor-mcp"],
      "env": {
        "VIBEGAMES_MCP_SESSION": "${VIBEGAMES_MCP_SESSION}"
      }
    }
  }
}
```

### Codex

```toml
[mcp_servers.vibe-games-editor]
command = "npx"
args = ["-y", "@vibegames/editor-mcp"]
env_vars = ["VIBEGAMES_MCP_SESSION"]
```

Then launch each session with the token from its editor tab:

```bash
VIBEGAMES_MCP_SESSION='<token-from-editor>' codex
VIBEGAMES_MCP_SESSION='<token-from-editor>' claude
```

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `VIBEGAMES_MCP_SESSION` | — (required) | per-tab pairing token |
| `VIBEGAMES_MCP_PORT` | `7777` | only set if the default port is taken |
| `VIBEGAMES_MCP_HOST` | `127.0.0.1` | loopback only |
| `VIBEGAMES_MCP_CALL_TIMEOUT_MS` | `60000` | per tool call |
