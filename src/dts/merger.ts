import { DtNode } from "./types";

function nodeKey(node: DtNode): string {
  return `${node.name}@${node.unitAddress ?? ""}`;
}

export function mergeTrees(root: DtNode): DtNode {
  const merged: DtNode = {
    ...root,
    properties: [...root.properties],
    children: [],
  };

  const childMap = new Map<string, DtNode>();

  for (const child of root.children) {
    const key = nodeKey(child);

    if (!childMap.has(key)) {
      childMap.set(key, {
        ...child,
        properties: [...child.properties],
        children: [...child.children],
      });
    } else {
      const existing = childMap.get(key)!;
      existing.properties.push(...child.properties);
      existing.children.push(...child.children);
    }
  }

  merged.children = [...childMap.values()].map(mergeTrees);

  return merged;
}