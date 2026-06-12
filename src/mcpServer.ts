import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Bridge } from "./protocol.js";
import { mcpTools } from "./tools.js";
import { toToolResultContent } from "./toolResult.js";

export const createMcpServer = (bridge: Bridge) => {
  const server = new Server(
    { name: "vibe-games-editor-mcp", version: "0.0.1" },
    { capabilities: { tools: { listChanged: true } } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: bridge.getTools() ?? mcpTools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      const output = await bridge.call(name, args ?? {});
      return { content: toToolResultContent(output) };
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

  bridge.onToolsChanged(() => {
    // A notification fired before connect / after close must not crash us.
    void Promise.resolve(server.sendToolListChanged()).catch(() => {});
  });

  return {
    start: () => server.connect(new StdioServerTransport()),
  };
};
