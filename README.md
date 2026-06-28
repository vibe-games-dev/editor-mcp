# @vibegames/editor-mcp

Use MCP clients like Claude Code or Codex with the [vibe-games.ai](https://vibe-games.ai) browser editor to build games — your coding assistant drives the editor directly through its tools.

Several editor tabs and several MCP clients can run at once and stay paired by a per-tab session token, without their tool calls crossing over.

## Setup

1. Open the [vibe-games.ai editor](https://vibe-games.ai/editor/playground).
2. Open **Settings**, go to the **AI** tab, and turn on **Local MCP Server**.
3. Pick your agent — **Claude** or **Codex**.
4. Run the two generated commands in your shell: the first installs the MCP server (once), the second starts a session with that tab's token.
5. The **Connect Agent** badge in the chat header shows your agent with a green dot once it connects.

For screenshots, browser support, and troubleshooting, see the [full setup guide](https://vibe-games.ai/docs/ai-setup/local-mcp).

## MCP client config (reference)

You normally don't write this by hand — the editor generates these commands for you with the token filled in (see [Setup](#setup)). It's here only so you know what's being added.

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
