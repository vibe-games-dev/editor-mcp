import { createMcpServer } from "./mcpServer.js";
import { WsBridge } from "./wsBridge.js";

const DEFAULT_PORT = 7777;

const main = async () => {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  let notifyToolsChanged: (() => Promise<void>) | null = null;

  const bridge = new WsBridge(port, {
    onToolsChanged: () => {
      notifyToolsChanged?.().catch((err) =>
        console.error("[editor-mcp] notify failed:", err),
      );
    },
  });

  const mcp = createMcpServer(bridge);
  notifyToolsChanged = mcp.notifyToolsChanged;
  await mcp.start();
  console.error("[editor-mcp] mcp stdio server ready");
};

main().catch((err) => {
  console.error("[editor-mcp] fatal:", err);
  process.exit(1);
});
