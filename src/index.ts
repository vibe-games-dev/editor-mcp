#!/usr/bin/env node

import { EditorServer } from "./editorServer.js";
import { createMcpServer } from "./mcpServer.js";
import { log, numEnv } from "./protocol.js";
import { mcpTools } from "./tools.js";

const DEFAULT_EDITOR_URL = "https://vibe-games.ai";

const parseEditorUrl = (raw: string) => {
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") return url;
  } catch {}
  log(`VIBEGAMES_EDITOR_URL must be an http or https URL: ${raw}`);
  process.exit(1);
};

const main = async () => {
  const editorUrl = parseEditorUrl(process.env.VIBEGAMES_EDITOR_URL || DEFAULT_EDITOR_URL);
  const server = new EditorServer({
    allowedOrigin: editorUrl.origin,
    defaultTools: mcpTools,
    callTimeoutMs: numEnv("VIBEGAMES_MCP_CALL_TIMEOUT_MS"),
  });

  const shutdown = () => void server.close().then(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.on("end", shutdown);

  await createMcpServer(server).start();
};

main().catch((err) => {
  log(`fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});
