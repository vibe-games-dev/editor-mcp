export type ToolAnnouncement = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};

export type ClientMessage =
  | { type: "hello"; tools: ToolAnnouncement[] }
  | { type: "tools_changed"; tools: ToolAnnouncement[] }
  | { type: "result"; id: string; ok: true; output: unknown }
  | { type: "result"; id: string; ok: false; error: string };

export type ServerMessage = {
  type: "execute";
  id: string;
  name: string;
  input: Record<string, unknown>;
};
