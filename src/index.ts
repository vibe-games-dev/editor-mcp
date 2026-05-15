import { createMcpServer } from "./mcpServer.js";
import { WsBridge } from "./wsBridge.js";

const main = async () => {
  const port = Number(process.env.PORT);
  const token = process.env.EDITOR_MCP_TOKEN;

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(
      "[vibe-games-editor-mcp] PORT env var is required and must be an integer between 1 and 65535.",
    );
    process.exit(1);
  }
  if (!token) {
    console.error(
      "[vibe-games-editor-mcp] EDITOR_MCP_TOKEN env var is required. Generate the command in the Vibe Games editor.",
    );
    process.exit(1);
  }

  const bridge = new WsBridge(port, token);
  await bridge.waitUntilReady();

  const mcp = createMcpServer(bridge);
  await mcp.start();
};

main().catch((err) => {
  console.error("[vibe-games-editor-mcp] fatal:", err);
  process.exit(1);
});
