import * as fs from "fs";
import * as path from "path";

export type SourceChunk = {
  file: string;
  text: string;
  startLine: number;
};

export function lineNumberAt(text: string, index: number): number {
  return text.slice(0, index).split(/\r?\n/).length;
}

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
      startLine: lineNumberAt(text, lastIndex),
    });

    const includePath = path.resolve(dir, match[1]);
    chunks.push(...resolveIncludes(includePath, seen));

    lastIndex = includeRegex.lastIndex;
  }

  chunks.push({
    file: abs,
    text: text.slice(lastIndex),
    startLine: lineNumberAt(text, lastIndex),
  });

  return chunks;
}

export function buildExpandedText(chunks: SourceChunk[]): string {
  return chunks
    .map(chunk => `\n/* SOURCE: ${chunk.file} */\n${chunk.text}`)
    .join("\n");
}