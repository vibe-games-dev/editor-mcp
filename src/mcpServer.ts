import { setTimeout as sleep } from "node:timers/promises";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { mcpTools } from "./tools.js";
import type { WsBridge } from "./wsBridge.js";

const INITIAL_TOOLS_WAIT_MS = 750;

export const createMcpServer = (bridge: WsBridge) => {
  const server = new Server(
    { name: "vibe-games-editor-mcp", version: "0.0.1" },
    { capabilities: { tools: { listChanged: true } } },
  );

  let firstListDone = false;

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (!firstListDone) {
      firstListDone = true;
      if (bridge.getTools().length === 0) {
        await sleep(INITIAL_TOOLS_WAIT_MS);
      }
    }
    const merged = new Map(mcpTools.map((tool) => [tool.name, tool]));
    for (const tool of bridge.getTools()) {
      merged.set(tool.name, tool);
    }
    return { tools: [...merged.values()] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      const output = await bridge.call(name, args ?? {});
      return {
        content: [{ type: "text" as const, text: JSON.stringify(output) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: err instanceof Error ? err.message : String(err),
          },
        ],
      };
    }
  });

  bridge.onToolsChanged(() => server.sendToolListChanged());

  return {
    start: () => server.connect(new StdioServerTransport()),
  };
};
