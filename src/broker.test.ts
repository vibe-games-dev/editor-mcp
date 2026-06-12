import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { WebSocket } from "ws";
import { Broker } from "./broker.js";
import { BrokerClient } from "./brokerClient.js";
import { CLOSE } from "./protocol.js";

const makeBroker = async (opts?: { idleMs?: number; heartbeatMs?: number }) => {
  const broker = new Broker({
    host: "127.0.0.1",
    port: 0,
    idleMs: opts?.idleMs ?? 60_000,
    heartbeatMs: opts?.heartbeatMs ?? 60_000,
  });
  await broker.waitUntilReady();
  return { broker, port: broker.port() };
};

type Peer = {
  ws: WebSocket;
  send: (msg: unknown) => void;
  // Resolve once a frame of `type` has arrived (buffered, so no frame is lost).
  next: (type: string) => Promise<Record<string, unknown>>;
};

const connect = async (
  port: number,
  role: "editor" | "agent",
  session: string,
): Promise<Peer> => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/${role}?session=${session}`);
  const queue: Record<string, unknown>[] = [];
  let waiters: (() => void)[] = [];
  ws.on("message", (data) => {
    queue.push(JSON.parse(data.toString()));
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) resolve();
  });
  await once(ws, "open");

  const next = async (type: string) => {
    for (;;) {
      const idx = queue.findIndex((m) => m.type === type);
      if (idx >= 0) return queue.splice(idx, 1)[0];
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };
  return { ws, next, send: (msg) => ws.send(JSON.stringify(msg)) };
};

const waitFor = async (predicate: () => boolean) => {
  for (let i = 0; i < 50 && !predicate(); i++)
    await new Promise((resolve) => setTimeout(resolve, 20));
};

const close = (ws: WebSocket) =>
  new Promise<void>((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    ws.once("close", () => resolve());
    // terminate, not close: a paused or already-reaped socket would never
    // finish a graceful close handshake.
    ws.terminate();
  });

test("pairs editor and agent and forwards in both directions", async (ctx) => {
  const { broker, port } = await makeBroker();
  ctx.after(() => broker.close());

  const editor = await connect(port, "editor", "s1");
  const agent = await connect(port, "agent", "s1");
  ctx.after(() => close(editor.ws));
  ctx.after(() => close(agent.ws));

  agent.send({ type: "execute", id: "1", name: "ping", input: {} });
  assert.equal((await editor.next("execute")).name, "ping");

  editor.send({ type: "result", id: "1", ok: true, output: 42 });
  assert.equal((await agent.next("result")).output, 42);
});

test("pairs regardless of connection order", async (ctx) => {
  const { broker, port } = await makeBroker();
  ctx.after(() => broker.close());

  const agent = await connect(port, "agent", "s1");
  ctx.after(() => close(agent.ws));
  assert.equal((await agent.next("ready")).peerConnected, false);

  const editor = await connect(port, "editor", "s1");
  ctx.after(() => close(editor.ws));
  assert.equal((await agent.next("peer_connected")).type, "peer_connected");
});

test("isolates two sessions", async (ctx) => {
  const { broker, port } = await makeBroker();
  ctx.after(() => broker.close());

  const editorA = await connect(port, "editor", "A");
  const agentA = await connect(port, "agent", "A");
  const editorB = await connect(port, "editor", "B");
  const agentB = await connect(port, "agent", "B");
  for (const peer of [editorA, agentA, editorB, agentB])
    ctx.after(() => close(peer.ws));

  agentA.send({ type: "execute", id: "1", name: "forA", input: {} });
  assert.equal((await editorA.next("execute")).name, "forA");

  const leaked = await Promise.race([
    editorB.next("execute").then(() => true),
    new Promise<false>((r) => setTimeout(() => r(false), 100)),
  ]);
  assert.equal(leaked, false);
});

test("rejects a duplicate role with code 4002", async (ctx) => {
  const { broker, port } = await makeBroker();
  ctx.after(() => broker.close());

  const first = await connect(port, "editor", "s1");
  ctx.after(() => close(first.ws));

  const second = new WebSocket(`ws://127.0.0.1:${port}/editor?session=s1`);
  ctx.after(() => close(second));
  const [code] = (await once(second, "close")) as [number];
  assert.equal(code, CLOSE.DUPLICATE_ROLE);
});

test("rejects a malformed connection", async (ctx) => {
  const { broker, port } = await makeBroker();
  ctx.after(() => broker.close());

  const ws = new WebSocket(`ws://127.0.0.1:${port}/agent`); // missing ?session
  ctx.after(() => close(ws));
  const [code] = (await once(ws, "close")) as [number];
  assert.equal(code, CLOSE.PROTOCOL_ERROR);
});

test("notifies the remaining peer on disconnect", async (ctx) => {
  const { broker, port } = await makeBroker();
  ctx.after(() => broker.close());

  const editor = await connect(port, "editor", "s1");
  const agent = await connect(port, "agent", "s1");
  ctx.after(() => close(editor.ws));

  await agent.next("ready");
  await editor.next("peer_connected");
  await close(agent.ws);
  assert.equal((await editor.next("peer_disconnected")).type, "peer_disconnected");
});

test("heartbeat reaps a peer that stops responding", async (ctx) => {
  const { broker, port } = await makeBroker({ heartbeatMs: 30 });
  ctx.after(() => broker.close());

  const editor = await connect(port, "editor", "s1");
  const agent = await connect(port, "agent", "s1");
  ctx.after(() => close(editor.ws));
  ctx.after(() => close(agent.ws));

  await agent.next("ready");
  // Simulate a hard kill: stop reading the socket so it never pongs.
  (agent.ws as unknown as { pause: () => void }).pause();

  assert.equal((await editor.next("peer_disconnected")).type, "peer_disconnected");
});

test("exits one idle window after the last peer leaves", async (ctx) => {
  const { broker, port } = await makeBroker({ idleMs: 80 });
  ctx.after(() => broker.close());
  const exited = new Promise<void>((resolve) => {
    broker.onIdleExit = resolve;
  });

  const agent = await connect(port, "agent", "s1");
  await agent.next("ready");
  await close(agent.ws);

  await exited;
});

test("adapter round-trips a tool call through the broker", async (ctx) => {
  const { broker, port } = await makeBroker();
  ctx.after(() => broker.close());

  const editor = await connect(port, "editor", "s1");
  ctx.after(() => close(editor.ws));
  editor.ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "execute")
      editor.send({ type: "result", id: msg.id, ok: true, output: { echo: msg.name } });
  });

  const client = new BrokerClient("127.0.0.1", port, "s1", 1000);
  client.start();
  ctx.after(() => client.close());

  await waitFor(() => client.isPaired());

  assert.deepEqual(await client.call("hello", {}), { echo: "hello" });
});

test("adapter picks up tools announced after it pairs (editor-first)", async (ctx) => {
  const { broker, port } = await makeBroker();
  ctx.after(() => broker.close());

  // Editor connects first; it re-announces its tools when the agent appears,
  // which is the contract that covers the broker not buffering frames.
  const editor = await connect(port, "editor", "s1");
  ctx.after(() => close(editor.ws));
  editor.ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "peer_connected")
      editor.send({
        type: "tools_changed",
        tools: [{ name: "foo", description: "d", inputSchema: { type: "object" } }],
      });
  });

  const client = new BrokerClient("127.0.0.1", port, "s1", 1000);
  client.start();
  ctx.after(() => client.close());

  await waitFor(() => client.getTools() !== null);
  assert.equal(client.getTools()?.[0].name, "foo");
});

test("adapter call rejects when no editor is paired", async (ctx) => {
  const { broker, port } = await makeBroker();
  ctx.after(() => broker.close());

  const client = new BrokerClient("127.0.0.1", port, "lonely", 1000);
  client.start();
  ctx.after(() => client.close());
  await new Promise((r) => setTimeout(r, 100)); // connect, with no editor present

  await assert.rejects(() => client.call("x", {}), /Editor not connected/);
});

test("adapter rejects an in-flight call when the broker drops", async (ctx) => {
  const { broker, port } = await makeBroker();

  const editor = await connect(port, "editor", "s1"); // present but never replies
  ctx.after(() => close(editor.ws));

  const client = new BrokerClient("127.0.0.1", port, "s1", 5000);
  client.start();
  ctx.after(() => client.close());
  await waitFor(() => client.isPaired());

  const pending = client.call("hang", {});
  await broker.close(); // drop the broker out from under the call
  await assert.rejects(() => pending, /disconnected/);
  client.close(); // stop the adapter from autostarting a replacement broker
});
