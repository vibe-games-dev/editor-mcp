#!/usr/bin/env node

import { startBroker } from "./broker.js";
import { BrokerClient } from "./brokerClient.js";
import { createMcpServer } from "./mcpServer.js";
import {
  BROKER_SUBCOMMAND,
  DEFAULT_BROKER_HOST,
  DEFAULT_BROKER_PORT,
  DEFAULT_CALL_TIMEOUT_MS,
  numEnv,
} from "./protocol.js";

const startAdapter = async () => {
  const session = process.env.VIBEGAMES_MCP_SESSION;
  if (!session) {
    console.error(
      "[adapter] VIBEGAMES_MCP_SESSION env var is required. Generate the launch command in the Vibe Games editor.",
    );
    process.exit(1);
  }

  const host = process.env.VIBEGAMES_MCP_HOST ?? DEFAULT_BROKER_HOST;
  const port = numEnv("VIBEGAMES_MCP_PORT") ?? DEFAULT_BROKER_PORT;
  const callTimeoutMs =
    numEnv("VIBEGAMES_MCP_CALL_TIMEOUT_MS") ?? DEFAULT_CALL_TIMEOUT_MS;

  const client = new BrokerClient(host, port, session, callTimeoutMs);

  const shutdown = () => {
    client.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Connect stdio before dialing the broker, so a tool announcement can't fire
  // a list-changed notification before the transport is ready.
  const mcp = createMcpServer(client);
  await mcp.start();
  client.start();
};

const main = async () => {
  if (process.argv[2] === BROKER_SUBCOMMAND) {
    await startBroker();
    return;
  }
  await startAdapter();
};

main().catch((err) => {
  console.error("[vibe-games-editor-mcp] fatal:", err);
  process.exit(1);
});
