import { DtNode } from "../dts/types";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function colorForFile(file: string): string {
  let hash = 0;

  for (const char of file) {
    hash = char.charCodeAt(0) + ((hash << 5) - hash);
  }

  return `hsl(${Math.abs(hash) % 360}, 70%, 80%)`;
}

function renderDeletionComment(file: string, line: number, depth: number): string {
  const indent = "&nbsp;".repeat(depth * 4);

  return `
<div class="delete-comment">
  ${indent}/* deleted by ${escapeHtml(file)}:${line} */
</div>
`;
}

function renderNode(node: DtNode, depth = 0, ancestorDeleted = false): string {
  const indent = "&nbsp;".repeat(depth * 4);
  const file = node.source.file;
  const color = colorForFile(file);
  const isDeleted = ancestorDeleted || Boolean(node.deletedBy);
  const lineColor = isDeleted ? "var(--vscode-disabledForeground)" : color;
  const deletedClass = isDeleted ? " deleted" : "";

  const name =
    node.name === "/"
      ? "/"
      : `${node.name}${node.unitAddress ? `@${node.unitAddress}` : ""}`;
  const label = node.label ? `<span class="label">${escapeHtml(node.label)}:</span> ` : "";

  let html = node.deletedBy
    ? renderDeletionComment(node.deletedBy.file, node.deletedBy.startLine, depth)
    : "";

  html += `
<div class="node${deletedClass}" style="border-left-color:${lineColor}">
  ${indent}${label}<span class="node-name">${escapeHtml(name)}</span> {
  <span class="source" style="color:${lineColor}">${escapeHtml(file)}:${node.source.startLine}</span>
</div>
`;

  for (const prop of node.properties) {
    const propDeleted = isDeleted || Boolean(prop.deletedBy);
    const propColor = propDeleted ? "var(--vscode-disabledForeground)" : colorForFile(prop.source.file);
    const propDeletedClass = propDeleted ? " deleted" : "";

    if (prop.deletedBy) {
      html += renderDeletionComment(prop.deletedBy.file, prop.deletedBy.startLine, depth + 1);
    }

    html += `
<div class="prop${propDeletedClass}" style="border-left-color:${propColor}">
  ${indent}&nbsp;&nbsp;<span class="prop-name">${escapeHtml(prop.name)}</span>
  <span>= ${escapeHtml(prop.value)}</span>
  <span class="source" style="color:${propColor}">${escapeHtml(prop.source.file)}:${prop.source.startLine}</span>
</div>
`;
  }

  for (const child of node.children) {
    html += renderNode(child, depth + 1, isDeleted);
  }

  return html;
}

export function renderHtml(root: DtNode): string {
  const diagnostics = root.diagnostics?.map(diagnostic => `
<div class="diagnostic warning">
  <span class="diagnostic-severity">${escapeHtml(diagnostic.severity)}</span>
  <span>${escapeHtml(diagnostic.message)}</span>
  ${diagnostic.source ? `<span class="source">${escapeHtml(diagnostic.source.file)}:${diagnostic.source.startLine}</span>` : ""}
</div>
`).join("") ?? "";

  return `
<!DOCTYPE html>
<html>
<head>
<style>
body {
  font-family: var(--vscode-editor-font-family);
  font-size: var(--vscode-editor-font-size);
  background: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
}

.node, .prop {
  padding: 2px 8px;
  border-left: 6px solid transparent;
  white-space: nowrap;
}

.node-name {
  font-weight: bold;
}

.label {
  color: var(--vscode-symbolIcon-variableForeground);
}

.prop-name {
  color: var(--vscode-symbolIcon-propertyForeground);
}

.source {
  opacity: 0.65;
  margin-left: 12px;
  font-size: 0.85em;
}

.deleted {
  color: var(--vscode-disabledForeground);
  text-decoration: line-through;
}

.deleted .source {
  color: var(--vscode-disabledForeground);
}

.delete-comment {
  color: var(--vscode-disabledForeground);
  padding: 2px 8px;
  white-space: nowrap;
}

.diagnostic {
  padding: 6px 8px;
  border-left: 6px solid var(--vscode-editorWarning-foreground);
  background: var(--vscode-inputValidation-warningBackground);
  margin-bottom: 6px;
}

.diagnostic-severity {
  font-weight: bold;
  margin-right: 8px;
}
</style>
</head>
<body>
${diagnostics}
${renderNode(root)}
</body>
</html>
`;
}
