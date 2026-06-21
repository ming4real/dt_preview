import * as fs from "fs";
import * as path from "path";

export type SourceChunk = {
  file: string;
  text: string;
};

export function resolveIncludes(entryFile: string, seen = new Set<string>()): SourceChunk[] {
  const abs = path.resolve(entryFile);

  if (seen.has(abs)) {
    return [];
  }

  seen.add(abs);

  const text = fs.readFileSync(abs, "utf8");
  const dir = path.dirname(abs);

  const chunks: SourceChunk[] = [];

  const includeRegex = /^\s*(?:\/include\/\s*|#include\s*)["<]([^">]+)[">]/gm;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = includeRegex.exec(text))) {
    chunks.push({
      file: abs,
      text: text.slice(lastIndex, match.index),
    });

    const includePath = path.resolve(dir, match[1]);
    chunks.push(...resolveIncludes(includePath, seen));

    lastIndex = includeRegex.lastIndex;
  }

  chunks.push({
    file: abs,
    text: text.slice(lastIndex),
  });

  return chunks;
}

export function buildExpandedText(chunks: SourceChunk[]): string {
  return chunks
    .map(chunk => `\n/* SOURCE: ${chunk.file} */\n${chunk.text}`)
    .join("\n");
}