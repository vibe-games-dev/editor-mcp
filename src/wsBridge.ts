import { randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { WebSocket, WebSocketServer } from "ws";

const DEFAULT_CALL_TIMEOUT_MS = 60_000;

export type ToolAnnouncement = Pick<
  Tool,
  "name" | "description" | "inputSchema" | "annotations"
>;

type ClientMessage =
  | { type: "tools_changed"; tools: ToolAnnouncement[] }
  | { type: "result"; id: string; ok: true; output: unknown }
  | { type: "result"; id: string; ok: false; error: string };

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: NodeJS.Timeout;
};

const tokensMatch = (expected: string, provided: string | null): boolean => {
  if (!provided) return false;
  const bufferExpected = Buffer.from(expected);
  const bufferProvided = Buffer.from(provided);
  if (bufferExpected.length !== bufferProvided.length) return false;
  return timingSafeEqual(bufferExpected, bufferProvided);
};

export class WsBridge {
  private readonly wss: WebSocketServer;
  private client: WebSocket | null = null;
  private tools: ToolAnnouncement[] = [];
  private readonly pending = new Map<string, PendingCall>();
  private readonly ready: Promise<void>;
  private readonly callTimeoutMs: number;
  private toolsChangedHandler: (() => void) | null = null;

  constructor(port: number, token: string, callTimeoutMs: number = DEFAULT_CALL_TIMEOUT_MS) {
    this.callTimeoutMs = callTimeoutMs;
    this.wss = new WebSocketServer({
      host: "127.0.0.1",
      port,
      verifyClient: (info: { req: IncomingMessage }) => {
        const url = new URL(info.req.url ?? "/", "ws://127.0.0.1");
        return tokensMatch(token, url.searchParams.get("token"));
      },
    });
    this.wss.on("connection", (ws) => this.attach(ws));

    this.ready = new Promise<void>((resolve, reject) => {
      this.wss.once("listening", () => {
        console.error(`[vibe-games-editor-mcp] ws listening on 127.0.0.1:${port}`);
        resolve();
      });
      this.wss.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          reject(
            new Error(
              `Port ${port} is already in use. Set PORT to a different value or stop the other editor-mcp instance.`,
            ),
          );
        } else {
          reject(err);
        }
      });
    });

    this.wss.on("error", (err) => {
      console.error("[vibe-games-editor-mcp] ws error:", err);
    });
  }

  waitUntilReady(): Promise<void> {
    return this.ready;
  }

  port(): number {
    const address = this.wss.address();
    if (!address || typeof address === "string") {
      throw new Error("ws server not bound");
    }
    return address.port;
  }

  async close(): Promise<void> {
    for (const client of this.wss.clients) {
      client.terminate();
    }
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }

  onToolsChanged(handler: () => void): void {
    this.toolsChangedHandler = handler;
  }

  getTools(): ToolAnnouncement[] {
    return this.tools;
  }

  call(name: string, input: Record<string, unknown>): Promise<unknown> {
    const ws = this.client;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Editor not connected"));
    }
    const id = randomUUID();
    const message = { type: "execute" as const, id, name, input };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.rejectPending(
            id,
            new Error(`Tool '${name}' timed out after ${this.callTimeoutMs}ms`),
          ),
        this.callTimeoutMs,
      );
      this.pending.set(id, { resolve, reject, timer });
      try {
        ws.send(JSON.stringify(message), (err) => {
          if (err) this.rejectPending(id, err);
        });
      } catch (err) {
        this.rejectPending(id, err);
      }
    });
  }

  private attach(ws: WebSocket) {
    if (this.client) {
      console.error("[vibe-games-editor-mcp] rejecting duplicate editor connection");
      ws.close(4002, "editor already connected");
      return;
    }
    this.client = ws;
    console.error("[vibe-games-editor-mcp] editor connected");
    ws.on("message", (data) => this.handleMessage(data.toString()));
    ws.on("close", () => {
      if (this.client !== ws) return;
      this.client = null;
      this.tools = [];
      this.rejectAllPending(new Error("Editor disconnected"));
      console.error("[vibe-games-editor-mcp] editor disconnected");
      this.toolsChangedHandler?.();
    });
    ws.on("error", (err) => {
      console.error("[vibe-games-editor-mcp] client error:", err);
    });
  }

  private handleMessage(raw: string) {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch (err) {
      console.error("[vibe-games-editor-mcp] invalid json:", err);
      return;
    }

    switch (msg.type) {
      case "tools_changed":
        this.tools = msg.tools;
        this.toolsChangedHandler?.();
        break;
      case "result":
        if (msg.ok) this.resolvePending(msg.id, msg.output);
        else this.rejectPending(msg.id, new Error(msg.error));
        break;
    }
  }

  private resolvePending(id: string, value: unknown) {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.resolve(value);
  }

  private rejectPending(id: string, reason: unknown) {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.reject(reason);
  }

  private rejectAllPending(reason: unknown) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.pending.clear();
  }
}
