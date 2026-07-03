import * as path from "path";
import { DtDiagnostic, DtNode, DtProperty, SourceSpan } from "../dts/types";

export type MonacoPreviewDecoration = {
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
  options: {
    className?: string;
    glyphMarginClassName?: string;
    hoverMessage?: { value: string };
    inlineClassName?: string;
    isWholeLine?: boolean;
    linesDecorationsClassName?: string;
    overviewRuler?: {
      color: string;
      position: number;
    };
    zIndex?: number;
  };
};

export type DeletedPreviewRange = {
  startLine: number;
  endLine: number;
  deleteSource: SourceSpan;
  kind: "deleted-node" | "deleted-property";
};

export type MonacoPreviewModel = {
  text: string;
  decorations: MonacoPreviewDecoration[];
  fileColors: Map<string, string>;
  deletedRanges: DeletedPreviewRange[];
};

export type RenderHtmlOptions = {
  activeFile?: string;
  cspSource?: string;
  includeGraph?: Map<string, Set<string>>;
  monacoBaseUri?: string;
  nonce?: string;
  rootFile?: string;
};

const INDENT = "    ";
const OVERVIEW_RULER_CENTER = 2;
const DEVICE_TREE_EXTENSIONS = new Set([".dts", ".dtsi", ".dtso"]);

type IncludeFileEntry = {
  id: string;
  displayName: string;
  fullPath: string;
  color: string;
  colorIndex: number;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colorForFile(file: string): string {
  let hash = 0;

  for (const char of file) {
    hash = char.charCodeAt(0) + ((hash << 5) - hash);
  }

  return `hsl(${Math.abs(hash) % 360}, 70%, 80%)`;
}

function isDeviceTreeSourceFile(file: string): boolean {
  return DEVICE_TREE_EXTENSIONS.has(path.extname(file).toLowerCase());
}

function missingIncludeFiles(diagnostics: DtDiagnostic[]): Set<string> {
  const missing = new Set<string>();
  const prefix = "Included file not found: ";

  for (const diagnostic of diagnostics) {
    if (diagnostic.message.startsWith(prefix)) {
      const file = diagnostic.message.slice(prefix.length);

      if (isDeviceTreeSourceFile(file)) {
        missing.add(file);
      }
    }
  }

  return missing;
}

function displayFileName(file: string, rootFile?: string): string {
  if (!rootFile || file === rootFile) {
    return path.basename(file);
  }

  const relative = path.relative(path.dirname(rootFile), file);

  return relative.startsWith("..") || path.isAbsolute(relative)
    ? path.basename(file)
    : relative;
}

function sourceLabel(source: SourceSpan): string {
  return `${source.file}:${source.startLine}`;
}

function nodeName(node: DtNode): string {
  return node.name === "/"
    ? "/"
    : `${node.name}${node.unitAddress ? `@${node.unitAddress}` : ""}`;
}

function propertyText(property: DtProperty): string {
  if (property.originalText) {
    return property.originalText;
  }

  return property.value === "true"
    ? `${property.name};`
    : `${property.name} = ${formatDtsValue(property.value)};`;
}

function formatDtsValue(value: string): string {
  return value
    .replace(/<\s*&\s*/g, "<&")
    .replace(/<\s+/g, "<")
    .replace(/\s+>/g, ">")
    .replace(/\[\s+/g, "[")
    .replace(/\s+\]/g, "]")
    .replace(/,\s*/g, ", ");
}

function deletionCommentStart(source: SourceSpan): string {
  return `/* Deleted by ${sourceLabel(source)}`;
}

function lineRange(lineNumber: number, line: string) {
  return {
    startLineNumber: lineNumber,
    startColumn: 1,
    endLineNumber: lineNumber,
    endColumn: Math.max(line.length + 1, 1),
  };
}

function decorationForSource(
  lineNumber: number,
  line: string,
  source: SourceSpan,
  className: string
): MonacoPreviewDecoration {
  return {
    range: lineRange(lineNumber, line),
    options: {
      isWholeLine: true,
      linesDecorationsClassName: className,
      hoverMessage: { value: `Source: ${sourceLabel(source)}` },
    },
  };
}

function rangeForLines(startLineNumber: number, endLineNumber: number, endLine: string) {
  return {
    startLineNumber,
    startColumn: 1,
    endLineNumber,
    endColumn: Math.max(endLine.length + 1, 1),
  };
}

function decorationForDeletedBlock(
  startLineNumber: number,
  endLineNumber: number,
  endLine: string,
  source: SourceSpan
): MonacoPreviewDecoration {
  return {
    range: rangeForLines(startLineNumber, endLineNumber, endLine),
    options: {
      className: "dtbe-deleted-block",
      inlineClassName: "dtbe-deleted-inline",
      isWholeLine: true,
      linesDecorationsClassName: "dtbe-deleted-block-line",
      hoverMessage: { value: `Deleted by ${sourceLabel(source)}` },
      overviewRuler: {
        color: "var(--vscode-disabledForeground)",
        position: OVERVIEW_RULER_CENTER,
      },
      zIndex: 100,
    },
  };
}

function decorationForUnresolvedReference(
  startLineNumber: number,
  endLineNumber: number,
  endLine: string,
  message: string
): MonacoPreviewDecoration {
  return {
    range: rangeForLines(startLineNumber, endLineNumber, endLine),
    options: {
      className: "dtbe-unresolved-reference",
      inlineClassName: "dtbe-unresolved-reference-inline",
      isWholeLine: true,
      linesDecorationsClassName: "dtbe-unresolved-reference-line",
      hoverMessage: { value: message },
      overviewRuler: {
        color: "var(--vscode-editorError-foreground)",
        position: OVERVIEW_RULER_CENTER,
      },
      zIndex: 90,
    },
  };
}

function fileClass(index: number): string {
  return `dt-source-${index}`;
}

function addFileColor(file: string, fileColors: Map<string, string>): string {
  if (!fileColors.has(file)) {
    fileColors.set(file, colorForFile(file));
  }

  return fileClass([...fileColors.keys()].indexOf(file));
}

function lineIntersectsDeletedRanges(lineNumber: number, deletedRanges: DeletedPreviewRange[]): boolean {
  return deletedRanges.some(range => lineNumber >= range.startLine && lineNumber <= range.endLine);
}

export function renderPreviewModel(root: DtNode): MonacoPreviewModel {
  const lines: string[] = [];
  const decorations: MonacoPreviewDecoration[] = [];
  const fileColors = new Map<string, string>();
  const sourceLines: Array<{
    line: string;
    lineNumber: number;
    source: SourceSpan;
  }> = [];
  const deletedRanges: DeletedPreviewRange[] = [];
  const unresolvedReferenceRanges: Array<{
    startLine: number;
    endLine: number;
    message: string;
  }> = [];

  function pushLine(
    line: string,
    source?: SourceSpan
  ): number {
    const lineParts = line.split(/\r?\n/);
    const firstLineNumber = lines.length + 1;

    for (const linePart of lineParts) {
      lines.push(linePart);
      const lineNumber = lines.length;

      if (source) {
        sourceLines.push({
          line: linePart,
          lineNumber,
          source,
        });
      }
    }

    return firstLineNumber;
  }

  function propertyLine(property: DtProperty, depth: number): string {
    const indent = INDENT.repeat(depth);

    return `${indent}${propertyText(property)}`;
  }

  function nodeOpenLine(node: DtNode, depth: number): string {
    const indent = INDENT.repeat(depth);
    const label = node.label ? `${node.label}: ` : "";

    return `${indent}${label}${nodeName(node)} {`;
  }

  function collectNodeLines(node: DtNode, depth: number): string[] {
    const indent = INDENT.repeat(depth);
    const nodeLines = [nodeOpenLine(node, depth)];

    for (const property of node.properties) {
      nodeLines.push(propertyLine(property, depth + 1));
    }

    for (const child of node.children) {
      nodeLines.push(...collectNodeLines(child, depth + 1));
    }

    nodeLines.push(`${indent}};`);

    return nodeLines;
  }

  function renderDeletedBlock(
    linesInBlock: string[],
    depth: number,
    deletedBy: SourceSpan,
    kind: DeletedPreviewRange["kind"]
  ) {
    const indent = INDENT.repeat(depth);
    const startLineNumber = lines.length + 1;

    pushLine(`${indent}${deletionCommentStart(deletedBy)}`);

    for (const line of linesInBlock) {
      pushLine(line);
    }

    const endLine = `${indent}*/`;
    const endLineNumber = pushLine(endLine);

    deletedRanges.push({
      startLine: startLineNumber,
      endLine: endLineNumber,
      deleteSource: deletedBy,
      kind,
    });
  }

  function renderProperty(property: DtProperty, depth: number) {
    if (property.deletedBy) {
      renderDeletedBlock([propertyLine(property, depth)], depth, property.deletedBy, "deleted-property");
      return;
    }

    pushLine(propertyLine(property, depth), property.source);
  }

  function renderNode(node: DtNode, depth: number) {
    if (node.deletedBy) {
      renderDeletedBlock(collectNodeLines(node, depth), depth, node.deletedBy, "deleted-node");
      return;
    }

    const startLine = pushLine(nodeOpenLine(node, depth), node.source);

    for (const property of node.properties) {
      renderProperty(property, depth + 1);
    }

    for (const child of node.children) {
      renderNode(child, depth + 1);
    }

    const endLine = pushLine(`${INDENT.repeat(depth)}};`, node.source);

    if (node.unresolvedReference) {
      unresolvedReferenceRanges.push({
        startLine,
        endLine,
        message: node.unresolvedReference.message,
      });
    }
  }

  renderNode(root, 0);

  for (const { line, lineNumber, source } of sourceLines) {
    if (!lineIntersectsDeletedRanges(lineNumber, deletedRanges)) {
      decorations.push(decorationForSource(lineNumber, line, source, addFileColor(source.file, fileColors)));
    }
  }

  for (const range of deletedRanges) {
    decorations.push(decorationForDeletedBlock(
      range.startLine,
      range.endLine,
      lines[range.endLine - 1] ?? "",
      range.deleteSource
    ));
  }

  for (const range of unresolvedReferenceRanges) {
    decorations.push(decorationForUnresolvedReference(
      range.startLine,
      range.endLine,
      lines[range.endLine - 1] ?? "",
      range.message
    ));
  }

  return {
    text: lines.join("\n"),
    decorations,
    fileColors,
    deletedRanges,
  };
}

function sourceColorCss(fileColors: Map<string, string>): string {
  return [...fileColors.entries()].map(([file, color], index) => {
    const className = fileClass(index);

    return `
.${className} {
  border-left: 4px solid ${color};
}
.${className}::after {
  content: "";
  display: inline-block;
  width: 10px;
  height: 100%;
  background: ${color};
  opacity: 0.55;
}
`;
  }).join("\n");
}

function includeFileEntry(file: string, root: string, fileColors: Map<string, string>): IncludeFileEntry {
  if (!fileColors.has(file)) {
    fileColors.set(file, colorForFile(file));
  }

  return {
    id: `include-file-${[...fileColors.keys()].indexOf(file)}`,
    displayName: displayFileName(file, root),
    fullPath: file,
    color: fileColors.get(file) ?? colorForFile(file),
    colorIndex: [...fileColors.keys()].indexOf(file),
  };
}

function renderIncludeHierarchy(
  rootFile: string | undefined,
  includeGraph: Map<string, Set<string>> | undefined,
  fileColors: Map<string, string>,
  diagnostics: DtDiagnostic[]
): string {
  if (!rootFile) {
    return "";
  }

  const root = path.resolve(rootFile);
  const missing = missingIncludeFiles(diagnostics);
  const shown = new Set<string>();

  function childrenFor(file: string): string[] {
    return [...(includeGraph?.get(file) ?? [])].sort((a, b) => a.localeCompare(b));
  }

  function row(file: string, depth: number, branch: string, duplicate: boolean): string {
    const missingFile = missing.has(file);
    const entry = includeFileEntry(file, root, fileColors);
    const classes = [
      "include-tree-row",
      missingFile ? "include-tree-row-missing" : "",
      duplicate ? "include-tree-row-duplicate" : "",
    ].filter(Boolean).join(" ");
    const suffix = missingFile ? " missing" : duplicate ? " already shown" : "";

    return `
      <div class="${classes}" style="padding-left: ${depth * 18}px" title="${escapeHtml(file)}${suffix}">
        <span class="include-tree-branch">${escapeHtml(branch)}</span>
        <span class="include-tree-swatch" style="background: ${entry.color}"></span>
        <button
          id="${entry.id}"
          class="include-tree-file"
          type="button"
          data-file-id="${entry.id}"
          data-file-path="${escapeHtml(entry.fullPath)}"
          data-display-name="${escapeHtml(entry.displayName)}"
          data-color-index="${entry.colorIndex}"
          style="color: ${entry.color}"
          title="${escapeHtml(entry.fullPath)}"
        >${escapeHtml(entry.displayName)}</button>
        ${missingFile ? '<span class="include-tree-warning">⚠ Missing</span>' : ""}
        ${duplicate ? '<span class="include-tree-note">already shown</span>' : ""}
      </div>`;
  }

  function renderFile(file: string, depth: number, branch: string, ancestors: Set<string>): string {
    const duplicate = shown.has(file);
    const circular = ancestors.has(file);
    shown.add(file);

    let html = row(file, depth, branch, duplicate || circular);

    if (duplicate || circular) {
      return html;
    }

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(file);

    const children = childrenFor(file);

    children.forEach((child, index) => {
      html += renderFile(child, depth + 1, index === children.length - 1 ? "└─" : "├─", nextAncestors);
    });

    return html;
  }

  return `
<section class="include-tree" aria-label="Include hierarchy">
  <div class="include-tree-title">Root:</div>
  <div class="include-tree-list">
    ${renderFile(root, 0, "", new Set<string>())}
  </div>
</section>`;
}

function jsonScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function nonceValue(value?: string): string {
  return value ?? Math.random().toString(36).slice(2);
}

export function renderHtml(root: DtNode, optionsOrRootFile?: RenderHtmlOptions | string): string {
  const options = typeof optionsOrRootFile === "string"
    ? { rootFile: optionsOrRootFile }
    : optionsOrRootFile ?? {};
  const nonce = nonceValue(options.nonce);
  const activeFile = options.activeFile ? path.resolve(options.activeFile) : undefined;
  const cspSource = options.cspSource ?? "'self'";
  const monacoBaseUri = options.monacoBaseUri ?? "";
  const model = renderPreviewModel(root);
  const rootFile = options.rootFile;
  const includeHierarchy = renderIncludeHierarchy(rootFile, options.includeGraph, model.fileColors, root.diagnostics ?? []);

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; font-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'nonce-${nonce}'; worker-src ${cspSource} blob: data:;">
<style>
html,
body {
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
  font-family: var(--vscode-editor-font-family);
  font-size: var(--vscode-editor-font-size);
  background: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
}

body {
  display: flex;
  flex-direction: column;
}

.include-tree {
  flex: 0 0 auto;
  max-height: 28vh;
  overflow: auto;
  padding: 8px 10px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editor-background);
}

.include-tree-title {
  font-weight: bold;
  margin-bottom: 4px;
}

.include-tree-row {
  display: flex;
  align-items: center;
  min-height: 18px;
  white-space: nowrap;
}

.include-tree-branch {
  width: 20px;
  color: var(--vscode-descriptionForeground);
}

.include-tree-swatch {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  margin-right: 5px;
  border-radius: 2px;
}

.include-tree-file {
  appearance: none;
  background: transparent;
  border: 0;
  border-radius: 3px;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  margin: 0;
  padding: 1px 4px;
  text-align: left;
}

.include-tree-file:hover {
  background: var(--vscode-list-hoverBackground);
  text-decoration: underline;
}

.include-tree-file:focus {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: 1px;
}

.include-tree-file.active-file {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground) !important;
}

.include-tree-warning,
.include-tree-note {
  margin-left: 8px;
  color: var(--vscode-editorWarning-foreground);
  font-size: 0.85em;
}

.include-tree-row-duplicate .include-tree-file {
  opacity: 0.65;
}

#editor {
  flex: 1 1 auto;
  min-height: 0;
}

.dtbe-deleted-block,
.dtbe-deleted-inline {
  color: var(--vscode-disabledForeground) !important;
  opacity: 0.55;
  font-style: italic;
}

.dtbe-deleted-block span,
.dtbe-deleted-block .mtk1,
.dtbe-deleted-block .mtk2,
.dtbe-deleted-block .mtk3,
.dtbe-deleted-block .mtk4,
.dtbe-deleted-block .mtk5,
.dtbe-deleted-block .mtk6,
.dtbe-deleted-block .mtk7,
.dtbe-deleted-block .mtk8,
.dtbe-deleted-block .mtk9 {
  color: var(--vscode-descriptionForeground) !important;
  font-style: italic;
}

.dtbe-deleted-block-line {
  border-left: 4px solid var(--vscode-disabledForeground);
}

.dtbe-unresolved-reference,
.dtbe-unresolved-reference-inline {
  background: color-mix(in srgb, var(--vscode-editorError-foreground) 16%, transparent);
  text-decoration: underline wavy var(--vscode-editorError-foreground);
}

.dtbe-unresolved-reference-line {
  border-left: 4px solid var(--vscode-editorError-foreground);
}

.lines-content .cdr {
  opacity: 0.85;
  padding-left: 4px;
}

${sourceColorCss(model.fileColors)}
</style>
</head>
<body>
${includeHierarchy}
<div id="editor"></div>
<script nonce="${nonce}">
const previewData = ${jsonScript({
    activeFile,
    text: model.text,
    decorations: model.decorations,
    monacoBaseUri,
  })};
</script>
<script nonce="${nonce}" src="${escapeHtml(monacoBaseUri)}/vs/loader.js"></script>
<script nonce="${nonce}">
const vscodeApi = acquireVsCodeApi();
require.config({ paths: { vs: previewData.monacoBaseUri + '/vs' } });
require(['vs/editor/editor.main'], function () {
  monaco.languages.register({ id: 'devicetree' });
  monaco.languages.setMonarchTokensProvider('devicetree', {
    tokenizer: {
      root: [
        [/\\/\\*/, 'comment', '@comment'],
        [/".*?"/, 'string'],
        [/\\/[a-zA-Z0-9_-]+\\//, 'keyword'],
        [/[a-zA-Z_][\\w.+-]*(?=\\s*:)/, 'type.identifier'],
        [/[a-zA-Z_#][\\w.+,-]*/, 'identifier'],
        [/[{};=<>@&]/, 'delimiter'],
        [/0x[0-9a-fA-F]+|\\d+/, 'number']
      ],
      comment: [
        [/[^*/]+/, 'comment'],
        [/\\*\\//, 'comment', '@pop'],
        [/[*/]/, 'comment']
      ]
    }
  });
  monaco.languages.setLanguageConfiguration('devicetree', {
    comments: { blockComment: ['/*', '*/'] },
    brackets: [['{', '}'], ['<', '>']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '<', close: '>' },
      { open: '"', close: '"' }
    ]
  });

  const editor = monaco.editor.create(document.getElementById('editor'), {
    value: previewData.text,
    language: 'devicetree',
    readOnly: true,
    automaticLayout: true,
    scrollBeyondLastLine: false,
    minimap: { enabled: true },
    glyphMargin: true,
    lineNumbers: 'on',
    renderWhitespace: 'selection',
    wordWrap: 'off',
    theme: document.body.classList.contains('vscode-light') ? 'vs' : 'vs-dark'
  });

  editor.createDecorationsCollection(previewData.decorations);
  function setActiveFile(file) {
    document.querySelectorAll('.include-tree-file.active-file').forEach(function (item) {
      item.classList.remove('active-file');
    });

    if (!file) {
      return;
    }

    document.querySelectorAll('.include-tree-file').forEach(function (item) {
      if (item.dataset.filePath === file) {
        item.classList.add('active-file');
      }
    });
  }

  document.querySelectorAll('.include-tree-file').forEach(function (item) {
    item.addEventListener('click', function () {
      if (item.dataset.filePath) {
        vscodeApi.postMessage({
          command: 'openFile',
          file: item.dataset.filePath
        });
      }
    });
  });

  setActiveFile(previewData.activeFile);

  window.addEventListener('keydown', function (event) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      editor.getAction('actions.find').run();
    }
  });
  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'updatePreview') {
      editor.setValue(event.data.text);
      editor.createDecorationsCollection(event.data.decorations);
    } else if (event.data && event.data.command === 'activeFile') {
      setActiveFile(event.data.file);
    }
  });
  vscodeApi.setState({ initialized: true });
});
</script>
</body>
</html>
`;
}
