import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const DEFAULT_BROKER_HOST = "127.0.0.1";
export const DEFAULT_BROKER_PORT = 7777;
export const DEFAULT_IDLE_MS = 15 * 60_000;
export const DEFAULT_HEARTBEAT_MS = 30_000;
export const DEFAULT_CALL_TIMEOUT_MS = 60_000;
// Generous: editor results can carry base64 screenshots.
export const MAX_FRAME_BYTES = 32 * 1024 * 1024;

export const RECONNECT_MIN_MS = 500;
export const RECONNECT_MAX_MS = 10_000;

export type Role = "editor" | "agent";

// CLI subcommand that runs the broker. Shared so the adapter's autostart argv
// and the entry-point dispatch can never drift apart.
export const BROKER_SUBCOMMAND = "broker";

export const CLOSE = {
  PROTOCOL_ERROR: 4000,
  DUPLICATE_ROLE: 4002,
  BROKER_SHUTDOWN: 4004,
} as const;

export type ToolAnnouncement = Pick<
  Tool,
  "name" | "description" | "inputSchema" | "annotations"
>;

// The only frames the broker authors; everything else it forwards opaquely.
export type ControlMessage =
  | { type: "ready"; peerConnected: boolean }
  | { type: "peer_connected" }
  | { type: "peer_disconnected" };

// Editor <-> adapter frames are relayed and validated at the endpoints, so they
// have no type here. They must not reuse a ControlMessage `type`.

export interface Bridge {
  // null until the editor announces its tools, so callers can fall back.
  getTools(): ToolAnnouncement[] | null;
  onToolsChanged(handler: () => void): void;
  call(name: string, input: Record<string, unknown>): Promise<unknown>;
}

// Prefixed stderr logger, e.g. createLog("broker")("listening").
export const createLog =
  (prefix: string) =>
  (msg: string): void =>
    console.error(`[${prefix}] ${msg}`);

export const numEnv = (name: string): number | undefined => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
};
