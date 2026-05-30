import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type ToolResultPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mediaType: string };

export const isToolResultParts = (
  output: unknown,
): output is ToolResultPart[] =>
  Array.isArray(output) &&
  output.every((part) => part?.type === "text" || part?.type === "image");

export const toToolResultContent = (
  output: unknown,
): CallToolResult["content"] =>
  isToolResultParts(output)
    ? output.map((part) =>
        part.type === "image"
          ? { type: "image", data: part.data, mimeType: part.mediaType }
          : { type: "text", text: part.text },
      )
    : [{ type: "text", text: JSON.stringify(output) }];
