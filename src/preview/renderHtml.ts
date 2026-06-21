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

function renderNode(node: DtNode, depth = 0): string {
  const indent = "&nbsp;".repeat(depth * 4);
  const file = node.source.file;
  const color = colorForFile(file);

  const name =
    node.name === "/"
      ? "/"
      : `${node.name}${node.unitAddress ? `@${node.unitAddress}` : ""}`;

  let html = `
<div class="node" style="border-left-color:${color}">
  ${indent}<span class="node-name">${escapeHtml(name)}</span>
  <span class="source">${escapeHtml(file)}:${node.source.startLine}</span>
</div>
`;

  for (const prop of node.properties) {
    html += `
<div class="prop" style="border-left-color:${colorForFile(prop.source.file)}">
  ${indent}&nbsp;&nbsp;<span class="prop-name">${escapeHtml(prop.name)}</span>
  <span>= ${escapeHtml(prop.value)}</span>
  <span class="source">${escapeHtml(prop.source.file)}:${prop.source.startLine}</span>
</div>
`;
  }

  for (const child of node.children) {
    html += renderNode(child, depth + 1);
  }

  return html;
}

export function renderHtml(root: DtNode): string {
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

.prop-name {
  color: var(--vscode-symbolIcon-propertyForeground);
}

.source {
  opacity: 0.65;
  margin-left: 12px;
  font-size: 0.85em;
}
</style>
</head>
<body>
${renderNode(root)}
</body>
</html>
`;
}