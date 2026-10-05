import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { readImportFile, toPathImportTool } from "./importFile.js";
import { MAX_IMPORT_FILE_BYTES, type ToolAnnouncement } from "./protocol.js";

let base: string;
let project: string;

before(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), "import-file-")));
  project = path.join(base, "project");
  await mkdir(path.join(project, "textures"), { recursive: true });
  await writeFile(path.join(project, "textures/stone.png"), "hello");
  await writeFile(path.join(base, "secret.png"), "secret");
  await symlink(path.join(base, "secret.png"), path.join(project, "link.png"));
  await writeFile(path.join(project, "large.png"), Buffer.alloc(MAX_IMPORT_FILE_BYTES + 1));
});

after(async () => {
  await rm(base, { recursive: true, force: true });
});

test("reads a file in a folder whose name starts with two dots", async () => {
  await mkdir(path.join(project, "..assets"));
  await writeFile(path.join(project, "..assets/stone.png"), "hello");
  assert.equal((await readImportFile("..assets/stone.png", project)).fileName, "stone.png");
});

test("reads a file inside the working directory as base64", async () => {
  assert.deepEqual(await readImportFile("textures/stone.png", project), {
    fileName: "stone.png",
    data: Buffer.from("hello").toString("base64"),
  });
});

test("rejects files that cannot be imported", async () => {
  const cases: [string, RegExp][] = [
    [path.join(base, "secret.png"), /outside the working directory/],
    ["link.png", /outside the working directory/],
    ["textures", /Not a file/],
    ["missing.png", /File not found/],
    ["large.png", /Max size/],
  ];
  for (const [filePath, error] of cases)
    await assert.rejects(readImportFile(filePath, project), error);
});

test("announces a path input in place of the file data", () => {
  const editorTool: ToolAnnouncement = {
    name: "import_file",
    description: "Import a file.",
    inputSchema: {
      type: "object",
      properties: { fileName: {}, data: {}, name: { type: "string" } },
      required: ["fileName", "data"],
    },
  };
  const tool = toPathImportTool(editorTool);
  assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}), ["path", "name"]);
  assert.deepEqual(tool.inputSchema.required, ["path"]);
});
