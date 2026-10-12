import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { toEditorInput, toPathImportTool } from "./importFile.js";
import { EditorNotConnectedError, type EditorServer, NOT_CONNECTED_MESSAGE } from "./editorServer.js";
import type { ToolAnnouncement } from "./protocol.js";
import { toToolResultContent } from "./toolResult.js";

const IMPORT_FILE_TOOL = "import_file";
const CONNECT_EDITOR_TOOL = "connect_editor";

const connectEditorTool: ToolAnnouncement = {
  name: CONNECT_EDITOR_TOOL,
  description: `Connect to the Vibe Games editor in the user's browser. Returns a pairing code for the user. Call this when the user asks to connect, or when an editor tool returns '${NOT_CONNECTED_MESSAGE}'.`,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, idempotentHint: true },
};

const connectEditor = async (editor: EditorServer) => {
  const { code, connected } = await editor.pair();
  return connected
    ? `Connected to the editor. To connect a different editor tab, enter the pairing code ${code} in that tab.`
    : [
        `Pairing code: ${code}`,
        `Tell the user: open your project in the Vibe Games editor (${editor.allowedOrigin}), click "Connect agent" and enter the pairing code ${code}.`,
        "Continue when the user tells you that the editor is connected.",
      ].join("\n");
};

export const createMcpServer = (editor: EditorServer) => {
  const server = new Server(
    { name: "vibe-games-editor-mcp", version: "0.0.1" },
    { capabilities: { tools: { listChanged: true } } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = editor.getTools();
    return {
      tools: [
        connectEditorTool,
        ...tools.map((tool) => (tool.name === IMPORT_FILE_TOOL ? toPathImportTool(tool) : tool)),
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      if (name === CONNECT_EDITOR_TOOL)
        return { content: [{ type: "text" as const, text: await connectEditor(editor) }] };
      const input = name === IMPORT_FILE_TOOL ? await toEditorInput(args ?? {}) : (args ?? {});
      const output = await editor.call(name, input);
      return { content: toToolResultContent(output) };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text:
              err instanceof EditorNotConnectedError
                ? `${err.message}. Call ${CONNECT_EDITOR_TOOL} and give the pairing code to the user.`
                : err instanceof Error
                  ? err.message
                  : String(err),
          },
        ],
      };
    }
  });

  server.oninitialized = () => {
    const info = server.getClientVersion();
    if (info?.name) editor.setClientInfo({ name: info.name, version: info.version });
  };

  editor.onToolsChanged(() => {
    // A notification fired before connect / after close must not crash us.
    void Promise.resolve(server.sendToolListChanged()).catch(() => {});
  });

  return {
    start: () => server.connect(new StdioServerTransport()),
  };
};
