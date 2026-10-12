import type { Tool } from "@modelcontextprotocol/sdk/types.js";

// Generous: editor results can carry base64 screenshots.
export const MAX_FRAME_BYTES = 32 * 1024 * 1024;
// Base64 adds a third, so an imported file must stay well below MAX_FRAME_BYTES.
export const MAX_IMPORT_FILE_BYTES = 20_000_000;

export const CLOSE = {
  INVALID_CODE: 4001,
  SHUTDOWN: 4004,
  REPLACED: 4005,
} as const;

export type ToolAnnouncement = Pick<
  Tool,
  "name" | "description" | "inputSchema" | "annotations"
>;

export type ClientInfo = { name: string; version?: string };

// stdout carries the MCP protocol, so logs go to stderr.
export const log = (msg: string): void => console.error(`[editor-mcp] ${msg}`);

export const numEnv = (name: string): number | undefined => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
};
