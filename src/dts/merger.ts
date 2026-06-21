import { DtDiagnostic, DtNode, DtProperty } from "./types";

export interface MergeContext {
  root: DtNode;
  labels: Map<string, DtNode>;
  paths: Map<string, DtNode>;
  warnings: DtDiagnostic[];
  fragments: DtNode[];
}

export function nodeKey(node: DtNode): string {
  return node.unitAddress ? `${node.name}@${node.unitAddress}` : node.name;
}

function cloneProperty(property: DtProperty): DtProperty {
  return {
    ...property,
    source: { ...property.source },
  };
}

function cloneNode(node: DtNode): DtNode {
  return {
    ...node,
    labels: [...node.labels],
    properties: node.properties.map(cloneProperty),
    children: node.children.map(cloneNode),
    source: { ...node.source },
    diagnostics: node.diagnostics ? [...node.diagnostics] : undefined,
  };
}

function addWarning(ctx: MergeContext, message: string, node?: DtNode) {
  ctx.warnings.push({
    severity: "warning",
    message,
    source: node?.source,
  });
}

function createContext(root: DtNode): MergeContext {
  const mergedRoot: DtNode = {
    ...root,
    kind: "root",
    labels: [...root.labels],
    properties: [],
    children: [],
    source: { ...root.source },
    diagnostics: [],
  };

  const ctx: MergeContext = {
    root: mergedRoot,
    labels: new Map(),
    paths: new Map(),
    warnings: [],
    fragments: [],
  };

  rebuildPathIndex(ctx);

  return ctx;
}

function addLabels(node: DtNode, ctx: MergeContext) {
  for (const label of node.labels) {
    ctx.labels.set(label, node);
  }
}

function rebuildIndexesForNode(node: DtNode, ctx: MergeContext, path: string) {
  ctx.paths.set(path, node);
  addLabels(node, ctx);

  for (const child of node.children) {
    const childPath = path === "/" ? `/${nodeKey(child)}` : `${path}/${nodeKey(child)}`;
    rebuildIndexesForNode(child, ctx, childPath);
  }
}

export function rebuildPathIndex(ctx: MergeContext) {
  ctx.labels.clear();
  ctx.paths.clear();
  rebuildIndexesForNode(ctx.root, ctx, "/");
}

function overwriteProperty(target: DtNode, property: DtProperty) {
  const cloned = cloneProperty(property);
  const existingIndex = target.properties.findIndex(item => item.name === property.name);

  if (existingIndex >= 0) {
    target.properties[existingIndex] = cloned;
  } else {
    target.properties.push(cloned);
  }
}

export function mergeNode(target: DtNode, patch: DtNode, ctx: MergeContext) {
  for (const label of patch.labels) {
    if (!target.labels.includes(label)) {
      target.labels.push(label);
    }
  }

  for (const property of patch.properties) {
    overwriteProperty(target, property);
  }

  for (const childPatch of patch.children) {
    const key = nodeKey(childPatch);
    const existing = target.children.find(child => nodeKey(child) === key);

    if (existing) {
      mergeNode(existing, childPatch, ctx);
    } else {
      target.children.push(cloneNode(childPatch));
    }
  }

  addLabels(target, ctx);
}

function mergeChildIntoRoot(child: DtNode, ctx: MergeContext) {
  const existing = ctx.root.children.find(item => nodeKey(item) === nodeKey(child));

  if (existing) {
    mergeNode(existing, child, ctx);
  } else {
    ctx.root.children.push(cloneNode(child));
  }
}

export function applyTopLevelItem(item: DtNode, ctx: MergeContext) {
  if (item.kind === "root" || item.name === "/") {
    mergeNode(ctx.root, item, ctx);
    rebuildPathIndex(ctx);
    return;
  }

  if (item.kind === "reference") {
    const label = item.referenceLabel ?? item.name.replace(/^&/, "");
    const target = ctx.labels.get(label);

    if (!target) {
      addWarning(ctx, `Unresolved label reference &${label}`, item);
      return;
    }

    mergeNode(target, item, ctx);
    rebuildPathIndex(ctx);
    return;
  }

  if (item.name === "fragment") {
    ctx.fragments.push(item);
    return;
  }

  mergeChildIntoRoot(item, ctx);
  rebuildPathIndex(ctx);
}

function stripQuotes(value: string): string {
  return value.replace(/^"\s*/, "").replace(/\s*"$/, "");
}

function labelFromTarget(value: string): string | undefined {
  return value.match(/<\s*&\s*([A-Za-z0-9_+.\-]+)\s*>/)?.[1];
}

function pathFromTargetPath(value: string): string {
  return stripQuotes(value.trim());
}

function findProperty(node: DtNode, name: string): DtProperty | undefined {
  return node.properties.find(property => property.name === name);
}

function findChild(node: DtNode, name: string): DtNode | undefined {
  return node.children.find(child => child.name === name);
}

function applyOverlayFragment(fragment: DtNode, ctx: MergeContext) {
  const overlay = findChild(fragment, "__overlay__");

  if (!overlay) {
    return;
  }

  const targetProperty = findProperty(fragment, "target");
  const targetPathProperty = findProperty(fragment, "target-path");
  let target: DtNode | undefined;

  if (targetProperty) {
    const label = labelFromTarget(targetProperty.value);

    if (!label) {
      addWarning(ctx, `Unresolved overlay target ${targetProperty.value}`, fragment);
      return;
    }

    target = ctx.labels.get(label);

    if (!target) {
      addWarning(ctx, `Unresolved overlay target &${label}`, fragment);
      return;
    }
  } else if (targetPathProperty) {
    const targetPath = pathFromTargetPath(targetPathProperty.value);
    target = ctx.paths.get(targetPath);

    if (!target) {
      addWarning(ctx, `Unresolved overlay target-path ${targetPath}`, fragment);
      return;
    }
  } else {
    addWarning(ctx, `Unresolved overlay target for ${nodeKey(fragment)}`, fragment);
    return;
  }

  mergeNode(target, overlay, ctx);
  rebuildPathIndex(ctx);
}

export function applyOverlayFragments(ctx: MergeContext) {
  for (const fragment of ctx.fragments) {
    applyOverlayFragment(fragment, ctx);
  }
}

export function mergeTrees(root: DtNode): DtNode {
  const ctx = createContext(root);

  for (const item of root.children) {
    applyTopLevelItem(item, ctx);
  }

  applyOverlayFragments(ctx);
  rebuildPathIndex(ctx);

  ctx.root.diagnostics = ctx.warnings;

  return ctx.root;
}
