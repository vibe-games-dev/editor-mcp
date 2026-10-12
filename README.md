# @vibegames/editor-mcp

Use MCP clients like Claude Code or Codex with the [vibe-games.ai](https://vibe-games.ai) browser editor to build games — your coding assistant drives the editor directly through its tools.

Each MCP client runs its own server process and connects to one editor tab with a pairing code. Several agents can run at the same time.

## Setup

1. Install the MCP server in your agent (once). See [MCP client config](#mcp-client-config).
2. Open your project in the [vibe-games.ai editor](https://vibe-games.ai/editor/playground) and click **Connect agent**.
3. Ask your agent to connect to the Vibe Games editor. It calls `connect_editor` and gives you a 6-digit pairing code.
4. Enter the code in the **Connect agent** popup. The editor connects when you enter the last digit.

For screenshots, browser support, and troubleshooting, see the [full setup guide](https://vibe-games.ai/docs/ai-setup/local-mcp).

## How pairing works

- `connect_editor` starts a WebSocket server on `127.0.0.1`, on the first free port from `7777` to `7786`, and makes a pairing code such as `312-845`.
- The first digit of the code selects the port. The other digits are the secret.
- The server accepts connections only from the origin of `VIBEGAMES_EDITOR_URL`. A browser cannot change the `Origin` header, so other web pages cannot connect.
- After 5 incorrect codes, the code locks. Call `connect_editor` again to get a new code.
- The code stays valid while the server process runs, so a reloaded editor tab connects again. When a second tab connects with the code, the first tab disconnects.

## MCP client config

### Claude Code

```bash
claude mcp add vibe-games-editor -- npx -y @vibegames/editor-mcp
```

### Codex

```bash
codex mcp add vibe-games-editor -- npx -y @vibegames/editor-mcp
```

### opencode

```bash
opencode mcp add vibe-games-editor -- npx -y @vibegames/editor-mcp
```

### Local development

Set the editor URL to your development server:

```bash
claude mcp add vibe-games-editor --env VIBEGAMES_EDITOR_URL=http://localhost:3000 -- npx -y @vibegames/editor-mcp
```

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `VIBEGAMES_EDITOR_URL` | `https://vibe-games.ai` | the only origin that can connect |
| `VIBEGAMES_MCP_CALL_TIMEOUT_MS` | `60000` | per tool call |
