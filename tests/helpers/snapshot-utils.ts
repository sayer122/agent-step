type SnapshotNode = {
  role?: string;
  name?: string;
  ref?: string;
  children?: SnapshotNode[];
};

export function findRefByName(
  snapshot: SnapshotNode[],
  name: string,
): string | undefined {
  for (const node of snapshot) {
    if (node.name === name && node.ref) {
      return node.ref;
    }
    if (node.children) {
      const found = findRefByName(node.children, name);
      if (found) return found;
    }
  }
  return undefined;
}
