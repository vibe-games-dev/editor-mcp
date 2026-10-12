import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import test from "node:test";
import { WebSocket } from "ws";
import { EditorNotConnectedError, EditorServer, MAX_FAILED_ATTEMPTS } from "./editorServer.js";
import { CLOSE } from "./protocol.js";

const ORIGIN = "https://vibe-games.ai";
let nextBasePort = 41000 + Math.floor(Math.random() * 1000) * 10;

const makeServer = () => {
  const basePort = nextBasePort;
  nextBasePort += 10;
  const server = new EditorServer({ allowedOrigin: ORIGIN, defaultTools: [], basePort, portCount: 10 });
  return { server, basePort };
};

const digitsOf = (code: string) => code.replace("-", "");

type Peer = {
  ws: WebSocket;
  send: (msg: unknown) => void;
  // Resolve once a frame of `type` has arrived (buffered, so no frame is lost).
  next: (type: string) => Promise<Record<string, unknown>>;
  closed: Promise<number>;
};

const connect = (port: number, code: string, origin = ORIGIN): Peer => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?code=${code}`, { origin });
  const queue: Record<string, unknown>[] = [];
  let waiters: (() => void)[] = [];
  ws.on("message", (data) => {
    queue.push(JSON.parse(data.toString()));
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) resolve();
  });
  ws.on("error", () => {});
  const closed = new Promise<number>((resolve) => ws.on("close", (code) => resolve(code)));

  const next = async (type: string) => {
    for (;;) {
      const idx = queue.findIndex((m) => m.type === type);
      if (idx >= 0) return queue.splice(idx, 1)[0];
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };
  return { ws, next, closed, send: (msg) => ws.send(JSON.stringify(msg)) };
};

test("pairs an editor with the code and relays calls", async () => {
  const { server, basePort } = makeServer();
  const { code, connected } = await server.pair();
  assert.match(code, /^0\d{2}-\d{3}$/);
  assert.equal(connected, false);

  const editor = connect(basePort, digitsOf(code));
  await editor.next("ready");
  assert.equal((await server.pair()).connected, true);

  const call = server.call("read_project", { code: "return 1" });
  const execute = await editor.next("execute");
  assert.equal(execute.name, "read_project");
  editor.send({ type: "result", id: execute.id, ok: true, output: 1 });
  assert.equal(await call, 1);

  await server.close();
});

test("rejects calls before an editor connects", async () => {
  const { server } = makeServer();
  await assert.rejects(server.call("read_project", {}), EditorNotConnectedError);
});

test("rejects other origins", async () => {
  const { server, basePort } = makeServer();
  const { code } = await server.pair();
  const peer = connect(basePort, digitsOf(code), "https://evil.example");
  const [err] = (await once(peer.ws, "unexpected-response")) as unknown[];
  assert.ok(err);
  await server.close();
});

test("locks the code after too many incorrect attempts", async () => {
  const { server, basePort } = makeServer();
  const { code } = await server.pair();

  for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
    const peer = connect(basePort, "000000");
    assert.equal(await peer.closed, CLOSE.INVALID_CODE);
  }
  const locked = connect(basePort, digitsOf(code));
  assert.equal(await locked.closed, CLOSE.INVALID_CODE);

  const { code: next } = await server.pair();
  const editor = connect(basePort, digitsOf(next));
  await editor.next("ready");
  await server.close();
});

test("a new editor replaces the current one", async () => {
  const { server, basePort } = makeServer();
  const { code } = await server.pair();

  const first = connect(basePort, digitsOf(code));
  await first.next("ready");
  const rejected = assert.rejects(server.call("read_project", {}), {
    message: "Editor disconnected",
  });
  await first.next("execute");

  const second = connect(basePort, digitsOf(code));
  await second.next("ready");
  assert.equal(await first.closed, CLOSE.REPLACED);
  await rejected;
  await server.close();
});

test("uses the next port when a port is in use", async () => {
  const { server, basePort } = makeServer();
  const blocker = createServer().listen(basePort, "127.0.0.1");
  await once(blocker, "listening");

  const { code } = await server.pair();
  assert.equal(code[0], "1");
  const editor = connect(basePort + 1, digitsOf(code));
  await editor.next("ready");

  await server.close();
  blocker.close();
});

test("forwards client info to the editor", async () => {
  const { server, basePort } = makeServer();
  server.setClientInfo({ name: "claude-code", version: "1.0.0" });
  const { code } = await server.pair();

  const editor = connect(basePort, digitsOf(code));
  const info = await editor.next("client_info");
  assert.equal(info.name, "claude-code");
  await server.close();
});

test("rejects malformed codes and messages without crashing", async () => {
  const { server, basePort } = makeServer();
  const { code } = await server.pair();

  const nonAscii = connect(basePort, encodeURIComponent("é00000"));
  assert.equal(await nonAscii.closed, CLOSE.INVALID_CODE);

  const editor = connect(basePort, digitsOf(code));
  await editor.next("ready");
  editor.ws.send("null");
  editor.ws.send("42");
  const call = server.call("read_project", {});
  const execute = await editor.next("execute");
  editor.send({ type: "result", id: execute.id, ok: true, output: "still alive" });
  assert.equal(await call, "still alive");
  await server.close();
});
