import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { MAX_IMPORT_FILE_BYTES, type ToolAnnouncement } from "./protocol.js";

const toMegabytes = (bytes: number) => (bytes / 1_000_000).toFixed(1);

export const readImportFile = async (filePath: unknown, cwd: string) => {
  if (typeof filePath !== "string" || filePath === "")
    throw new Error("path is required.");

  const requested = path.resolve(cwd, filePath);
  const root = await realpath(cwd);
  const resolved = await realpath(requested).catch((err: NodeJS.ErrnoException) => {
    throw err.code === "ENOENT" ? new Error(`File not found: ${filePath}`) : err;
  });

  // Real paths, so a symbolic link cannot point outside the working directory.
  const relative = path.relative(root, resolved);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error(`File is outside the working directory: ${filePath}`);

  const stats = await stat(resolved);
  if (!stats.isFile()) throw new Error(`Not a file: ${filePath}`);
  if (stats.size > MAX_IMPORT_FILE_BYTES)
    throw new Error(
      `File is ${toMegabytes(stats.size)} MB. Max size is ${toMegabytes(MAX_IMPORT_FILE_BYTES)} MB.`,
    );

  return {
    fileName: path.basename(requested),
    data: (await readFile(resolved)).toString("base64"),
  };
};

// The editor runs in a browser and cannot read the disk, so the agent sends
// a path and the server reads the file.
export const toPathImportTool = (tool: ToolAnnouncement): ToolAnnouncement => {
  const name = tool.inputSchema.properties?.name;
  return {
    ...tool,
    description: `${tool.description ?? ""} The file must be inside the working directory.`.trim(),
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          minLength: 1,
          description: "Absolute or relative to the working directory",
        },
        ...(name && { name }),
      },
      required: ["path"],
      additionalProperties: false,
    },
  };
};

export const toEditorInput = async (args: Record<string, unknown>) => {
  const { path: filePath, ...rest } = args;
  return { ...rest, ...(await readImportFile(filePath, process.cwd())) };
};
