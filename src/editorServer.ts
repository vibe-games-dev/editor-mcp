import { randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { CLOSE, type ClientInfo, log, MAX_FRAME_BYTES, type ToolAnnouncement } from "./protocol.js";

const HOST = "127.0.0.1";
// The first digit of the pairing code selects one of these ports.
const BASE_PORT = 7777;
const PORT_COUNT = 10;
const HEARTBEAT_MS = 30_000;
const DEFAULT_CALL_TIMEOUT_MS = 60_000;
export const MAX_FAILED_ATTEMPTS = 5;

type Pairing = { code: string; connected: boolean };

export const NOT_CONNECTED_MESSAGE = "Editor not connected";

export class EditorNotConnectedError extends Error {
  constructor() {
    super(NOT_CONNECTED_MESSAGE);
  }
}

type EditorServerOptions = {
  allowedOrigin: string;
  // Listed until the editor announces its own tools.
  defaultTools: ToolAnnouncement[];
  callTimeoutMs?: number;
  basePort?: number;
  portCount?: number;
};

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: NodeJS.Timeout;
};

type TrackedSocket = WebSocket & { isAlive?: boolean };

// Editor input is untrusted; keep only well-formed announcements.
const parseToolAnnouncements = (value: unknown): ToolAnnouncement[] =>
  Array.isArray(value)
    ? value.filter(
        (tool): tool is ToolAnnouncement =>
          typeof tool === "object" &&
          tool !== null &&
          typeof (tool as { name?: unknown }).name === "string",
      )
    : [];

const formatCode = (digits: string) => `${digits.slice(0, 3)}-${digits.slice(3)}`;

// Compare bytes, not characters: timingSafeEqual throws on buffers of different length.
const codesMatch = (expected: string, actual: string) => {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
};

const readCode = (url: string | undefined) => {
  try {
    return new URL(url ?? "/", "ws://localhost").searchParams.get("code") ?? "";
  } catch {
    return "";
  }
};

const isAddressInUse = (err: unknown) =>
  (err as NodeJS.ErrnoException).code === "EADDRINUSE";

/**
 * Loopback WebSocket server for one editor tab.
 * The tab connects with a 6-digit pairing code: the first digit selects the
 * port, the other digits are the secret. Only the configured origin can
 * connect, and the code locks after too many incorrect attempts.
 */
export class EditorServer {
  readonly allowedOrigin: string;
  private readonly defaultTools: ToolAnnouncement[];
  private readonly callTimeoutMs: number;
  private readonly basePort: number;
  private readonly portCount: number;
  private listening: Promise<void> | null = null;
  private wss: WebSocketServer | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private slot = 0;
  // null = no valid code; pair() makes a new one.
  private code: string | null = null;
  private failedAttempts = 0;
  private editor: TrackedSocket | null = null;
  private tools: ToolAnnouncement[] | null = null;
  private clientInfo: ClientInfo | null = null;
  private toolsChangedHandler: (() => void) | null = null;
  private readonly pending = new Map<string, PendingCall>();

  constructor(opts: EditorServerOptions) {
    this.allowedOrigin = opts.allowedOrigin;
    this.defaultTools = opts.defaultTools;
    this.callTimeoutMs = opts.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    this.basePort = opts.basePort ?? BASE_PORT;
    this.portCount = opts.portCount ?? PORT_COUNT;
  }

  async pair(): Promise<Pairing> {
    this.listening ??= this.listen().catch((err) => {
      this.listening = null;
      throw err;
    });
    await this.listening;
    if (this.code === null) {
      this.code = `${this.slot}${randomInt(0, 100_000).toString().padStart(5, "0")}`;
      this.failedAttempts = 0;
    }
    return { code: formatCode(this.code), connected: this.editor !== null };
  }

  onToolsChanged(handler: () => void): void {
    this.toolsChangedHandler = handler;
  }

  getTools(): ToolAnnouncement[] {
    return this.tools ?? this.defaultTools;
  }

  setClientInfo(info: ClientInfo): void {
    this.clientInfo = info;
    this.sendClientInfo();
  }

  call(name: string, input: Record<string, unknown>): Promise<unknown> {
    const ws = this.editor;
    if (!ws || ws.readyState !== WebSocket.OPEN)
      return Promise.reject(new EditorNotConnectedError());

    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.takePending(id)?.reject(
            new Error(`Tool '${name}' timed out after ${this.callTimeoutMs}ms`),
          ),
        this.callTimeoutMs,
      );
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ type: "execute", id, name, input }), (err) => {
        if (err) this.takePending(id)?.reject(err);
      });
    });
  }

  async close(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.editor?.close(CLOSE.SHUTDOWN, "server shutdown");
    const wss = this.wss;
    if (!wss) return;
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => {
        for (const ws of wss.clients) ws.terminate();
      }, 250);
      force.unref();
      wss.close(() => {
        clearTimeout(force);
        resolve();
      });
    });
  }

  private async listen() {
    for (let slot = 0; slot < this.portCount; slot++) {
      try {
        this.wss = await this.listenOn(this.basePort + slot);
        this.slot = slot;
        log(`listening on ${HOST}:${this.basePort + slot} for ${this.allowedOrigin}`);
        this.wss.on("connection", (ws, req) => this.onConnection(ws, req));
        this.wss.on("error", (err) => log(`server error: ${err.message}`));
        this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
        this.heartbeatTimer.unref();
        return;
      } catch (err) {
        if (!isAddressInUse(err)) throw err;
      }
    }
    throw new Error(
      `No free port in ${this.basePort}-${this.basePort + this.portCount - 1}. Close other agents that use the editor.`,
    );
  }

  private listenOn(port: number) {
    return new Promise<WebSocketServer>((resolve, reject) => {
      const wss = new WebSocketServer({
        host: HOST,
        port,
        maxPayload: MAX_FRAME_BYTES,
        // A browser cannot fake the Origin header, so other web pages cannot connect.
        verifyClient: ({ origin }: { origin: string }) => origin === this.allowedOrigin,
      });
      // Only for the bind: after listening, the "error" handler in listen() takes over.
      const onBindError = (err: Error) => {
        wss.close();
        reject(err);
      };
      wss.once("error", onBindError);
      wss.once("listening", () => {
        wss.off("error", onBindError);
        resolve(wss);
      });
    });
  }

  private onConnection(ws: TrackedSocket, req: IncomingMessage) {
    if (this.code === null || !codesMatch(this.code, readCode(req.url))) {
      if (this.code !== null && ++this.failedAttempts >= MAX_FAILED_ATTEMPTS) {
        this.code = null;
        log("too many incorrect pairing codes, the code is locked");
      }
      ws.close(CLOSE.INVALID_CODE, "invalid pairing code");
      return;
    }
    this.failedAttempts = 0;

    const previous = this.editor;
    if (previous) {
      this.detachEditor();
      previous.close(CLOSE.REPLACED, "another editor connected");
    }

    this.editor = ws;
    ws.isAlive = true;
    log("editor connected");
    ws.send(JSON.stringify({ type: "ready" }));
    this.sendClientInfo();

    ws.on("message", (data) => {
      if (this.editor === ws) this.handleMessage(data.toString());
    });
    ws.on("pong", () => {
      ws.isAlive = true;
    });
    ws.on("close", () => {
      if (this.editor !== ws) return;
      log("editor disconnected");
      this.detachEditor();
    });
    ws.on("error", () => {});
  }

  private detachEditor() {
    this.editor = null;
    this.rejectAllPending(new Error("Editor disconnected"));
    this.setTools(null);
  }

  // Notify only on a real change, because clients re-list the tools on each notification.
  private setTools(tools: ToolAnnouncement[] | null) {
    const before = JSON.stringify(this.getTools());
    this.tools = tools;
    if (JSON.stringify(this.getTools()) !== before) this.toolsChangedHandler?.();
  }

  private sendClientInfo(): void {
    const ws = this.editor;
    if (!this.clientInfo || ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "client_info", ...this.clientInfo }));
  }

  private heartbeat() {
    const ws = this.editor;
    if (!ws) return;
    if (ws.isAlive === false) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  }

  private handleMessage(raw: string) {
    let msg: { type?: string; [key: string]: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg !== "object" || msg === null) return;
    switch (msg.type) {
      case "tools_changed":
        this.setTools(parseToolAnnouncements(msg.tools));
        break;
      case "result": {
        if (typeof msg.id !== "string") break;
        // Strict, so a stray `ok: "false"` is not read as success.
        const pending = this.takePending(msg.id);
        if (msg.ok === true) pending?.resolve(msg.output);
        else pending?.reject(new Error(msg.error ? String(msg.error) : "unknown editor error"));
        break;
      }
    }
  }

  private takePending(id: string): PendingCall | undefined {
    const pending = this.pending.get(id);
    if (!pending) return undefined;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    return pending;
  }

  private rejectAllPending(reason: unknown) {
    for (const id of [...this.pending.keys()]) this.takePending(id)?.reject(reason);
  }
}
