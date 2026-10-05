import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { toEditorInput, toPathImportTool } from "./importFile.js";
import type { Bridge } from "./protocol.js";
import { mcpTools } from "./tools.js";
import { toToolResultContent } from "./toolResult.js";

const IMPORT_FILE_TOOL = "import_file";

export const createMcpServer = (bridge: Bridge) => {
  const server = new Server(
    { name: "vibe-games-editor-mcp", version: "0.0.1" },
    { capabilities: { tools: { listChanged: true } } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = bridge.getTools() ?? mcpTools;
    return {
      tools: tools.map((tool) => (tool.name === IMPORT_FILE_TOOL ? toPathImportTool(tool) : tool)),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      const input = name === IMPORT_FILE_TOOL ? await toEditorInput(args ?? {}) : (args ?? {});
      const output = await bridge.call(name, input);
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

  server.oninitialized = () => {
    const info = server.getClientVersion();
    if (info?.name) bridge.setClientInfo({ name: info.name, version: info.version });
  };

  bridge.onToolsChanged(() => {
    // A notification fired before connect / after close must not crash us.
    void Promise.resolve(server.sendToolListChanged()).catch(() => {});
  });

  return {
    start: () => server.connect(new StdioServerTransport()),
  };
};
