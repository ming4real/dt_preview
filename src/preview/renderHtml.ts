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
  cspSource?: string;
  monacoBaseUri?: string;
  nonce?: string;
  rootFile?: string;
};

const INDENT = "    ";
const OVERVIEW_RULER_CENTER = 2;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeCss(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function colorForFile(file: string): string {
  let hash = 0;

  for (const char of file) {
    hash = char.charCodeAt(0) + ((hash << 5) - hash);
  }

  return `hsl(${Math.abs(hash) % 360}, 70%, 80%)`;
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
  return property.value === "true"
    ? `${property.name};`
    : `${property.name} = ${property.value};`;
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

function decorationForWarning(lineNumber: number, line: string, diagnostic: DtDiagnostic): MonacoPreviewDecoration {
  return {
    range: lineRange(lineNumber, line),
    options: {
      isWholeLine: true,
      linesDecorationsClassName: "dt-warning-line",
      glyphMarginClassName: "dt-warning-glyph",
      hoverMessage: { value: diagnostic.message },
      overviewRuler: {
        color: "var(--vscode-editorWarning-foreground)",
        position: OVERVIEW_RULER_CENTER,
      },
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
  const warningLines: Array<{
    diagnostic: DtDiagnostic;
    line: string;
    lineNumber: number;
  }> = [];
  const deletedRanges: DeletedPreviewRange[] = [];

  function pushLine(
    line: string,
    source?: SourceSpan
  ): number {
    lines.push(line);
    const lineNumber = lines.length;

    if (source) {
      sourceLines.push({
        line,
        lineNumber,
        source,
      });
    }

    return lineNumber;
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

    pushLine(nodeOpenLine(node, depth), node.source);

    for (const property of node.properties) {
      renderProperty(property, depth + 1);
    }

    for (const child of node.children) {
      renderNode(child, depth + 1);
    }

    pushLine(`${INDENT.repeat(depth)}};`, node.source);
  }

  for (const diagnostic of root.diagnostics ?? []) {
    const line = `/* ${diagnostic.severity}: ${diagnostic.message} */`;
    const lineNumber = pushLine(line);
    warningLines.push({
      diagnostic,
      line,
      lineNumber,
    });
  }

  if ((root.diagnostics?.length ?? 0) > 0) {
    pushLine("");
  }

  renderNode(root, 0);

  for (const { line, lineNumber, source } of sourceLines) {
    if (!lineIntersectsDeletedRanges(lineNumber, deletedRanges)) {
      decorations.push(decorationForSource(lineNumber, line, source, addFileColor(source.file, fileColors)));
    }
  }

  for (const { diagnostic, line, lineNumber } of warningLines) {
    if (!lineIntersectsDeletedRanges(lineNumber, deletedRanges)) {
      decorations.push(decorationForWarning(lineNumber, line, diagnostic));
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
  content: "${escapeCss(path.basename(file))}";
  color: ${color};
}
`;
  }).join("\n");
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
  const cspSource = options.cspSource ?? "'self'";
  const monacoBaseUri = options.monacoBaseUri ?? "";
  const model = renderPreviewModel(root);
  const rootFile = options.rootFile;
  const rootBanner = rootFile ? `
<div class="preview-root" title="${escapeHtml(rootFile)}">
  <span class="preview-root-label">Preview Root:</span>
  <span>${escapeHtml(path.basename(rootFile))}</span>
  <span class="preview-root-path">${escapeHtml(rootFile)}</span>
</div>
` : "";

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; font-src ${cspSource}; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'nonce-${nonce}'; worker-src ${cspSource} blob: data:;">
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

.preview-root {
  flex: 0 0 auto;
  padding: 8px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editor-background);
  white-space: nowrap;
}

.preview-root-label {
  font-weight: bold;
  margin-right: 6px;
}

.preview-root-path {
  opacity: 0.65;
  margin-left: 12px;
  font-size: 0.85em;
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

.dt-warning-line {
  border-left: 4px solid var(--vscode-editorWarning-foreground);
}

.dt-warning-glyph {
  background: var(--vscode-editorWarning-foreground);
  border-radius: 50%;
}

.lines-content .cdr {
  opacity: 0.85;
  padding-left: 4px;
}

${sourceColorCss(model.fileColors)}
</style>
</head>
<body>
${rootBanner}
<div id="editor"></div>
<script nonce="${nonce}">
const previewData = ${jsonScript({
    text: model.text,
    decorations: model.decorations,
    monacoBaseUri,
  })};
</script>
<script nonce="${nonce}" src="${escapeHtml(monacoBaseUri)}/loader.js"></script>
<script nonce="${nonce}">
const vscodeApi = acquireVsCodeApi();
require.config({ paths: { vs: previewData.monacoBaseUri } });
self.MonacoEnvironment = {
  getWorkerUrl: function (_moduleId, label) {
    const workerMain = previewData.monacoBaseUri + '/base/worker/workerMain.js';
    return 'data:text/javascript;charset=utf-8,' + encodeURIComponent(
      'self.MonacoEnvironment = { baseUrl: ' + JSON.stringify(previewData.monacoBaseUri + '/') + ' };' +
      'importScripts(' + JSON.stringify(workerMain) + ');'
    );
  }
};
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
    }
  });
  vscodeApi.setState({ initialized: true });
});
</script>
</body>
</html>
`;
}
