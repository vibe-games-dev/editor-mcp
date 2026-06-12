import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import {
  type Bridge,
  BROKER_SUBCOMMAND,
  CLOSE,
  createLog,
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  type ToolAnnouncement,
} from "./protocol.js";

// Don't spawn a second broker within this window (covers the bind race).
const SPAWN_COOLDOWN_MS = 2_000;

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: NodeJS.Timeout;
};

const log = createLog("adapter");

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

// Detached so the broker outlives this adapter; it comes up on the same
// host/port we are dialing. A lost bind race just exits quietly.
const spawnBroker = (host: string, port: number) => {
  log("no broker found, starting one");
  const child = spawn(
    process.execPath,
    [...process.execArgv, process.argv[1], BROKER_SUBCOMMAND],
    {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        VIBEGAMES_MCP_HOST: host,
        VIBEGAMES_MCP_PORT: String(port),
      },
    },
  );
  child.on("error", (err) => log(`failed to start broker: ${err.message}`));
  // stdio is ignored, so surface an early failure (e.g. couldn't bind).
  child.on("exit", (code) => {
    if (code) log(`broker exited early with code ${code}`);
  });
  child.unref();
};

/**
 * Outbound `agent`-role connection to the broker, implementing {@link Bridge}.
 * Reconnects with bounded backoff and starts a broker on demand if none runs.
 */
export class BrokerClient implements Bridge {
  private ws: WebSocket | null = null;
  // null = the editor has not announced its tools yet (fall back to defaults).
  private tools: ToolAnnouncement[] | null = null;
  private editorConnected = false;
  private closed = false;
  private reconnectMs = RECONNECT_MIN_MS;
  private lastSpawnAt = 0;
  private toolsChangedHandler: (() => void) | null = null;
  private readonly pending = new Map<string, PendingCall>();

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly session: string,
    private readonly callTimeoutMs: number,
  ) {}

  private agentUrl(): string {
    // Bracket IPv6 literals (e.g. ::1) for the WebSocket URL.
    const host = this.host.includes(":") ? `[${this.host}]` : this.host;
    return `ws://${host}:${this.port}/agent?session=${encodeURIComponent(this.session)}`;
  }

  start(): void {
    this.connect();
  }

  onToolsChanged(handler: () => void): void {
    this.toolsChangedHandler = handler;
  }

  getTools(): ToolAnnouncement[] | null {
    return this.tools;
  }

  isPaired(): boolean {
    return this.editorConnected;
  }

  call(name: string, input: Record<string, unknown>): Promise<unknown> {
    const ws = this.ws;
    if (!this.editorConnected || !ws || ws.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error("Editor not connected"));

    const id = randomUUID();
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
      ws.send(JSON.stringify({ type: "execute", id, name, input }), (err) => {
        if (err) this.rejectPending(id, err);
      });
    });
  }

  close(): void {
    this.closed = true;
    this.ws?.terminate();
  }

  private connect() {
    if (this.closed) return;
    const ws = new WebSocket(this.agentUrl());
    this.ws = ws;

    ws.on("open", () => log("connected to broker"));
    ws.on("message", (data) => this.handleMessage(data.toString()));
    ws.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ECONNREFUSED")
        this.maybeSpawnBroker();
    });
    ws.on("close", (code) => this.onDisconnect(code));
  }

  private maybeSpawnBroker() {
    const now = Date.now();
    if (now - this.lastSpawnAt < SPAWN_COOLDOWN_MS) return;
    this.lastSpawnAt = now;
    spawnBroker(this.host, this.port);
  }

  private onDisconnect(code?: number) {
    this.ws = null;
    this.setEditorConnected(false);
    this.rejectAllPending(new Error("Broker disconnected"));
    if (this.closed) return;

    let delay = this.reconnectMs;
    if (code === CLOSE.DUPLICATE_ROLE) {
      // Another agent holds this token; fast retries are pointless, so go slow.
      log("session token already in use by another agent; retrying slowly");
      delay = RECONNECT_MAX_MS;
    } else {
      this.reconnectMs = Math.min(this.reconnectMs * 2, RECONNECT_MAX_MS);
    }
    setTimeout(() => this.connect(), delay).unref();
  }

  private handleMessage(raw: string) {
    let msg: { type?: string; [key: string]: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.type) {
      case "ready":
        // Reset backoff here, not on `open`: a duplicate-role connection also
        // opens, but never receives `ready` before its 4002 close.
        this.reconnectMs = RECONNECT_MIN_MS;
        this.setEditorConnected(Boolean(msg.peerConnected));
        break;
      case "peer_connected":
        this.setEditorConnected(true);
        break;
      case "peer_disconnected":
        this.setEditorConnected(false);
        break;
      case "tools_changed":
        this.tools = parseToolAnnouncements(msg.tools);
        this.toolsChangedHandler?.();
        break;
      case "result": {
        if (typeof msg.id !== "string") break;
        // Strict, so a stray `ok: "false"` is not read as success.
        if (msg.ok === true) this.resolvePending(msg.id, msg.output);
        else
          this.rejectPending(
            msg.id,
            new Error(msg.error ? String(msg.error) : "unknown editor error"),
          );
        break;
      }
    }
  }

  private setEditorConnected(connected: boolean) {
    if (this.editorConnected === connected) return;
    this.editorConnected = connected;
    if (!connected) {
      this.tools = null;
      this.rejectAllPending(new Error("Editor disconnected"));
      this.toolsChangedHandler?.();
    }
  }

  private takePending(id: string): PendingCall | undefined {
    const pending = this.pending.get(id);
    if (!pending) return undefined;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    return pending;
  }

  private resolvePending(id: string, value: unknown) {
    this.takePending(id)?.resolve(value);
  }

  private rejectPending(id: string, reason: unknown) {
    this.takePending(id)?.reject(reason);
  }

  private rejectAllPending(reason: unknown) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.pending.clear();
  }
}
