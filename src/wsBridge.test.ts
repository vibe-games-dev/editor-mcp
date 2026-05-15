import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { WsBridge } from "./wsBridge.js";

const TOKEN = "test-token";

const makeBridge = async (callTimeoutMs?: number) => {
  const bridge = new WsBridge(0, TOKEN, callTimeoutMs);
  await bridge.waitUntilReady();
  return { bridge, port: bridge.port() };
};

const connect = async (port: number, token = TOKEN): Promise<WebSocket> => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return ws;
};

const closeClient = (ws: WebSocket) =>
  new Promise<void>((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    ws.once("close", () => resolve());
    ws.close();
  });

type ExecuteRequest = { id: string; name: string; input: unknown };
type ExecuteResult =
  | { ok: true; output: unknown }
  | { ok: false; error: string };

const replyToExecute = (
  client: WebSocket,
  buildResponse: (request: ExecuteRequest) => ExecuteResult,
) => {
  client.on("message", (data) => {
    const message = JSON.parse(data.toString());
    if (message.type !== "execute") return;
    const result = buildResponse(message);
    client.send(JSON.stringify({ type: "result", id: message.id, ...result }));
  });
};

test("accepts client with valid token", async (ctx) => {
  const { bridge, port } = await makeBridge();
  ctx.after(() => bridge.close());

  const client = await connect(port);
  ctx.after(() => closeClient(client));

  assert.equal(client.readyState, WebSocket.OPEN);
});

test("rejects client with invalid token", async (ctx) => {
  const { bridge, port } = await makeBridge();
  ctx.after(() => bridge.close());

  const client = new WebSocket(`ws://127.0.0.1:${port}/?token=wrong`);
  ctx.after(() => closeClient(client));

  const outcome = await new Promise<"opened" | "errored">((resolve) => {
    client.once("open", () => resolve("opened"));
    client.once("error", () => resolve("errored"));
  });
  assert.equal(outcome, "errored");
});

test("rejects duplicate editor connection with code 4002", async (ctx) => {
  const { bridge, port } = await makeBridge();
  ctx.after(() => bridge.close());

  const first = await connect(port);
  ctx.after(() => closeClient(first));

  const second = new WebSocket(`ws://127.0.0.1:${port}/?token=${TOKEN}`);
  ctx.after(() => closeClient(second));

  const code = await new Promise<number>((resolve) => {
    second.once("close", (closeCode) => resolve(closeCode));
  });
  assert.equal(code, 4002);
});

test("call rejects when no editor is connected", async (ctx) => {
  const { bridge } = await makeBridge();
  ctx.after(() => bridge.close());

  await assert.rejects(() => bridge.call("doStuff", {}), /Editor not connected/);
});

test("round-trip resolves with editor output", async (ctx) => {
  const { bridge, port } = await makeBridge();
  ctx.after(() => bridge.close());

  const client = await connect(port);
  ctx.after(() => closeClient(client));

  replyToExecute(client, () => ({ ok: true, output: { value: 42 } }));

  const result = await bridge.call("doStuff", { value: 1 });
  assert.deepEqual(result, { value: 42 });
});

test("round-trip rejects with editor error", async (ctx) => {
  const { bridge, port } = await makeBridge();
  ctx.after(() => bridge.close());

  const client = await connect(port);
  ctx.after(() => closeClient(client));

  replyToExecute(client, () => ({ ok: false, error: "boom" }));

  await assert.rejects(() => bridge.call("doStuff", {}), /boom/);
});

test("concurrent calls correlate replies by id", async (ctx) => {
  const { bridge, port } = await makeBridge();
  ctx.after(() => bridge.close());

  const client = await connect(port);
  ctx.after(() => closeClient(client));

  const incoming: ExecuteRequest[] = [];
  const bothReceived = new Promise<void>((resolve) => {
    client.on("message", (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === "execute") {
        incoming.push(message);
        if (incoming.length === 2) resolve();
      }
    });
  });

  const firstCall = bridge.call("first", {});
  const secondCall = bridge.call("second", {});
  await bothReceived;

  client.send(
    JSON.stringify({ type: "result", id: incoming[1].id, ok: true, output: "second-out" }),
  );
  client.send(
    JSON.stringify({ type: "result", id: incoming[0].id, ok: true, output: "first-out" }),
  );

  assert.equal(await firstCall, "first-out");
  assert.equal(await secondCall, "second-out");
});

test("invalid JSON from client does not crash the bridge", async (ctx) => {
  const { bridge, port } = await makeBridge();
  ctx.after(() => bridge.close());

  const client = await connect(port);
  ctx.after(() => closeClient(client));

  client.send("not-json{{{");

  const fired = new Promise<void>((resolve) => bridge.onToolsChanged(() => resolve()));
  client.send(
    JSON.stringify({
      type: "tools_changed",
      tools: [{ name: "after_garbage", description: "d", inputSchema: { type: "object" } }],
    }),
  );
  await fired;

  assert.equal(bridge.getTools()[0].name, "after_garbage");
});

test("call rejects after timeout when editor never replies", async (ctx) => {
  const { bridge, port } = await makeBridge(50);
  ctx.after(() => bridge.close());

  const client = await connect(port);
  ctx.after(() => closeClient(client));

  await assert.rejects(
    () => bridge.call("slow", {}),
    /Tool 'slow' timed out after 50ms/,
  );
});

test("disconnect rejects pending calls", async (ctx) => {
  const { bridge, port } = await makeBridge();
  ctx.after(() => bridge.close());

  const client = await connect(port);

  const pending = bridge.call("doStuff", {});
  client.terminate();

  await assert.rejects(() => pending, /Editor disconnected/);
});

test("tools_changed updates getTools and fires handler", async (ctx) => {
  const { bridge, port } = await makeBridge();
  ctx.after(() => bridge.close());

  const client = await connect(port);
  ctx.after(() => closeClient(client));

  const fired = new Promise<void>((resolve) => bridge.onToolsChanged(() => resolve()));

  client.send(
    JSON.stringify({
      type: "tools_changed",
      tools: [{ name: "foo", description: "d", inputSchema: { type: "object" } }],
    }),
  );

  await fired;
  assert.equal(bridge.getTools().length, 1);
  assert.equal(bridge.getTools()[0].name, "foo");
});
