import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  CLOSE,
  type ControlMessage,
  createLog,
  DEFAULT_BROKER_HOST,
  DEFAULT_BROKER_PORT,
  DEFAULT_HEARTBEAT_MS,
  DEFAULT_IDLE_MS,
  MAX_FRAME_BYTES,
  numEnv,
  type Role,
} from "./protocol.js";

type Session = { editor: WebSocket | null; agent: WebSocket | null };

type BrokerOptions = {
  host?: string;
  port?: number;
  idleMs?: number;
  heartbeatMs?: number;
};

type TrackedSocket = WebSocket & { isAlive?: boolean };

const log = createLog("broker");

// Hash so the raw token never lands in a map key or a log.
const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

const partnerOf = (role: Role): Role => (role === "editor" ? "agent" : "editor");

const sendControl = (ws: WebSocket, message: ControlMessage) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
};

const parseConnect = (
  req: IncomingMessage,
): { role: Role; token: string } | null => {
  const url = new URL(req.url ?? "/", "ws://localhost");
  const role = url.pathname.slice(1); // "/editor" -> "editor", "/agent" -> "agent"
  const token = url.searchParams.get("session");
  if ((role !== "editor" && role !== "agent") || !token) return null;
  return { role, token };
};

/**
 * Anemic relay: owns the loopback port, pairs one editor and one agent per
 * session token, and forwards their frames opaquely. A heartbeat reaps dead
 * peers; an idle timer lets the broker exit once no peers remain.
 */
export class Broker {
  private readonly wss: WebSocketServer;
  private readonly sessions = new Map<string, Session>();
  private readonly idleMs: number;
  private readonly ready: Promise<void>;
  private closed = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly heartbeatTimer: NodeJS.Timeout;
  onIdleExit: (() => void) | null = null;

  constructor(opts: BrokerOptions = {}) {
    const host = opts.host ?? DEFAULT_BROKER_HOST;
    const port = opts.port ?? DEFAULT_BROKER_PORT;
    const heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;

    this.wss = new WebSocketServer({ host, port, maxPayload: MAX_FRAME_BYTES });
    this.wss.on("connection", (ws, req) => this.onConnection(ws, req));
    this.wss.on("error", (err) => log(`server error: ${err.message}`));

    this.ready = new Promise<void>((resolve, reject) => {
      this.wss.once("listening", () => {
        log(`listening on ${host}:${port}`);
        resolve();
      });
      this.wss.once("error", reject);
    });

    this.heartbeatTimer = setInterval(() => this.heartbeat(), heartbeatMs);
    this.heartbeatTimer.unref();
    // Spawned-but-unused brokers must still exit; start the idle countdown now.
    this.armIdle();
  }

  waitUntilReady(): Promise<void> {
    return this.ready;
  }

  port(): number {
    const address = this.wss.address();
    if (!address || typeof address === "string")
      throw new Error("broker not bound");
    return address.port;
  }

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.heartbeatTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    for (const ws of this.wss.clients)
      ws.close(CLOSE.BROKER_SHUTDOWN, "broker shutdown");
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => {
        for (const ws of this.wss.clients) ws.terminate();
      }, 250);
      force.unref();
      this.wss.close(() => {
        clearTimeout(force);
        resolve();
      });
    });
  }

  private onConnection(ws: WebSocket, req: IncomingMessage) {
    const info = parseConnect(req);
    if (!info) {
      ws.close(CLOSE.PROTOCOL_ERROR, "expected /editor or /agent with ?session");
      return;
    }
    const { role, token } = info;
    const key = hashToken(token);
    const tag = key.slice(0, 8);

    const session = this.sessions.get(key) ?? { editor: null, agent: null };
    if (session[role]) {
      log(`rejecting duplicate ${role} for ${tag}`);
      ws.close(CLOSE.DUPLICATE_ROLE, `${role} already connected`);
      return;
    }
    session[role] = ws;
    this.sessions.set(key, session);
    (ws as TrackedSocket).isAlive = true;
    this.cancelIdle();

    const partnerRole = partnerOf(role);

    const partner = session[partnerRole];
    const partnerReady = partner !== null && partner.readyState === WebSocket.OPEN;
    sendControl(ws, { type: "ready", peerConnected: partnerReady });
    if (partnerReady) sendControl(partner, { type: "peer_connected" });
    log(`${role} connected ${tag} (peer ${partnerReady ? "present" : "absent"})`);

    ws.on("message", (data, isBinary) => {
      const target = session[partnerRole];
      if (target && target.readyState === WebSocket.OPEN)
        target.send(data, { binary: isBinary });
    });
    ws.on("pong", () => {
      (ws as TrackedSocket).isAlive = true;
    });
    ws.on("close", () => this.onClose(key, role, ws));
    ws.on("error", () => {});
  }

  private onClose(key: string, role: Role, ws: WebSocket) {
    const session = this.sessions.get(key);
    if (!session || session[role] !== ws) return;
    session[role] = null;
    const partner = session[partnerOf(role)];
    if (partner) sendControl(partner, { type: "peer_disconnected" });
    if (!session.editor && !session.agent) this.sessions.delete(key);
    log(`${role} disconnected ${key.slice(0, 8)}`);
    if (this.sessions.size === 0) this.armIdle();
  }

  private heartbeat() {
    for (const client of this.wss.clients) {
      const ws = client as TrackedSocket;
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }

  private cancelIdle() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private armIdle() {
    if (this.closed) return;
    this.cancelIdle();
    this.idleTimer = setTimeout(() => {
      log("idle, shutting down");
      void this.close().then(() => this.onIdleExit?.());
    }, this.idleMs);
    this.idleTimer.unref();
  }
}

export const startBroker = async (): Promise<void> => {
  const broker = new Broker({
    host: process.env.VIBEGAMES_MCP_HOST,
    port: numEnv("VIBEGAMES_MCP_PORT"),
    idleMs: numEnv("VIBEGAMES_MCP_IDLE_MS"),
    heartbeatMs: numEnv("VIBEGAMES_MCP_HEARTBEAT_MS"),
  });
  broker.onIdleExit = () => process.exit(0);

  try {
    await broker.waitUntilReady();
  } catch (err) {
    // Lost the bind race with another broker — that one wins, exit quietly.
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
      log("port already in use, another broker is running");
      process.exit(0);
    }
    throw err;
  }

  const shutdown = () => void broker.close().then(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};
