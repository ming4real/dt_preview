import * as fs from "fs";
import * as path from "path";
import { DtDiagnostic, SourceSpan } from "./types";

export type SourceChunk = {
  file: string;
  text: string;
  startLine: number;
};

export type IncludeResolution = {
  chunks: SourceChunk[];
  diagnostics: DtDiagnostic[];
};

export function lineNumberAt(text: string, index: number): number {
  return text.slice(0, index).split(/\r?\n/).length;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function resolveIncludesInternal(
  entryFile: string,
  seen: Set<string>,
  diagnostics: DtDiagnostic[],
  includeSource?: SourceSpan
): SourceChunk[] {
  const abs = path.resolve(entryFile);

  if (seen.has(abs)) {
    return [];
  }

  seen.add(abs);

  let text: string;

  try {
    text = fs.readFileSync(abs, "utf8");
  } catch (error) {
    if (isMissingFileError(error) && includeSource) {
      diagnostics.push({
        severity: "warning",
        message: `Included file not found: ${abs}`,
        source: includeSource,
      });

      return [];
    }

    throw error;
  }

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
    const includeLine = lineNumberAt(text, match.index);
    chunks.push(...resolveIncludesInternal(includePath, seen, diagnostics, {
      file: abs,
      startLine: includeLine,
      endLine: includeLine,
    }));

    lastIndex = includeRegex.lastIndex;
  }

  chunks.push({
    file: abs,
    text: text.slice(lastIndex),
    startLine: lineNumberAt(text, lastIndex),
  });

  return chunks;
}

export function resolveIncludes(entryFile: string, seen = new Set<string>()): SourceChunk[] {
  return resolveIncludesInternal(entryFile, seen, []);
}

export function resolveIncludesWithDiagnostics(entryFile: string): IncludeResolution {
  const diagnostics: DtDiagnostic[] = [];
  const chunks = resolveIncludesInternal(entryFile, new Set<string>(), diagnostics);

  return { chunks, diagnostics };
}

export function buildExpandedText(chunks: SourceChunk[]): string {
  return chunks
    .map(chunk => `\n/* SOURCE: ${chunk.file} */\n${chunk.text}`)
    .join("\n");
}
