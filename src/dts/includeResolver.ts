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
  dependencyGraph: Map<string, Set<string>>;
};

export type ReadFile = (file: string) => string;

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
  dependencyGraph: Map<string, Set<string>>,
  readFile: ReadFile,
  includeSource?: SourceSpan
): SourceChunk[] {
  const abs = path.resolve(entryFile);
  dependencyGraph.set(abs, dependencyGraph.get(abs) ?? new Set<string>());

  if (seen.has(abs)) {
    return [];
  }

  seen.add(abs);

  let text: string;

  try {
    text = readFile(abs);
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
    dependencyGraph.get(abs)?.add(includePath);
    const includeLine = lineNumberAt(text, match.index);
    chunks.push(...resolveIncludesInternal(includePath, seen, diagnostics, dependencyGraph, readFile, {
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

function readFileFromDisk(file: string): string {
  return fs.readFileSync(file, "utf8");
}

export function resolveIncludes(entryFile: string, seen = new Set<string>()): SourceChunk[] {
  const diagnostics: DtDiagnostic[] = [];
  const dependencyGraph = new Map<string, Set<string>>();

  return resolveIncludesInternal(entryFile, seen, diagnostics, dependencyGraph, readFileFromDisk);
}

export function resolveIncludesWithDiagnostics(entryFile: string, readFile: ReadFile = readFileFromDisk): IncludeResolution {
  const diagnostics: DtDiagnostic[] = [];
  const dependencyGraph = new Map<string, Set<string>>();
  const chunks = resolveIncludesInternal(entryFile, new Set<string>(), diagnostics, dependencyGraph, readFile);

  return { chunks, diagnostics, dependencyGraph };
}

export function collectTransitiveIncludes(rootFile: string, dependencyGraph: Map<string, Set<string>>): Set<string> {
  const root = path.resolve(rootFile);
  const includes = new Set<string>();
  const pending = [...(dependencyGraph.get(root) ?? [])];

  while (pending.length > 0) {
    const file = pending.pop();

    if (!file || includes.has(file)) {
      continue;
    }

    includes.add(file);

    for (const child of dependencyGraph.get(file) ?? []) {
      pending.push(child);
    }
  }

  return includes;
}

export function isIncludedByRoot(
  rootFile: string,
  changedFile: string,
  dependencyGraph: Map<string, Set<string>>
): boolean {
  return collectTransitiveIncludes(rootFile, dependencyGraph).has(path.resolve(changedFile));
}

export function buildExpandedText(chunks: SourceChunk[]): string {
  return chunks
    .map(chunk => `\n/* SOURCE: ${chunk.file} */\n${chunk.text}`)
    .join("\n");
}
