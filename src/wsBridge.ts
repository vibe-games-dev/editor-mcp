import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import type {
  ClientMessage,
  ServerMessage,
  ToolAnnouncement,
} from "./types.js";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: NodeJS.Timeout;
};

export type BridgeEvents = {
  onToolsChanged: (tools: ToolAnnouncement[]) => void;
};

const CALL_TIMEOUT_MS = 60_000;

export class WsBridge {
  private readonly wss: WebSocketServer;
  private client: WebSocket | null = null;
  private tools: ToolAnnouncement[] = [];
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly port: number,
    private readonly events: BridgeEvents,
  ) {
    this.wss = new WebSocketServer({ host: "127.0.0.1", port });
    this.wss.on("connection", (ws) => this.attach(ws));
    this.wss.on("listening", () => {
      console.error(`[editor-mcp] ws listening on 127.0.0.1:${port}`);
    });
    this.wss.on("error", (err) => {
      console.error("[editor-mcp] ws error:", err);
    });
  }

  getTools(): ToolAnnouncement[] {
    return this.tools;
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  call(name: string, input: Record<string, unknown>): Promise<unknown> {
    if (!this.client) {
      return Promise.reject(new Error("Editor not connected"));
    }
    const id = randomUUID();
    const message: ServerMessage = { type: "execute", id, name, input };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Tool '${name}' timed out after ${CALL_TIMEOUT_MS}ms`));
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.client?.send(JSON.stringify(message));
    });
  }

  private attach(ws: WebSocket) {
    if (this.client) {
      console.error("[editor-mcp] replacing existing editor connection");
      this.client.close(4000, "replaced by new connection");
    }
    this.client = ws;
    console.error("[editor-mcp] editor connected");
    ws.on("message", (data) => this.handleMessage(data.toString()));
    ws.on("close", () => {
      if (this.client === ws) {
        this.client = null;
        this.tools = [];
        this.rejectAllPending(new Error("Editor disconnected"));
        console.error("[editor-mcp] editor disconnected");
        this.events.onToolsChanged([]);
      }
    });
    ws.on("error", (err) => {
      console.error("[editor-mcp] client error:", err);
    });
  }

  private handleMessage(raw: string) {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch (err) {
      console.error("[editor-mcp] invalid json:", err);
      return;
    }

    if (msg.type === "hello" || msg.type === "tools_changed") {
      this.tools = msg.tools;
      this.events.onToolsChanged(this.tools);
      return;
    }

    if (msg.type === "result") {
      const p = this.pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      if (msg.ok) {
        p.resolve(msg.output);
      } else {
        p.reject(new Error(msg.error));
      }
    }
  }

  private rejectAllPending(err: Error) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }
}
