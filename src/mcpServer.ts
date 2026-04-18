import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { WsBridge } from "./wsBridge.js";

export const createMcpServer = (bridge: WsBridge) => {
  const server = new Server(
    { name: "editor-mcp", version: "0.0.1" },
    { capabilities: { tools: { listChanged: true } } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: bridge.getTools().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
    })),
  }));

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

  const start = async () => {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  };

  const notifyToolsChanged = () => server.sendToolListChanged();

  return { server, start, notifyToolsChanged };
};
