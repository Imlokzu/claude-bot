/**
 * Render standalone images as one accordion, including older replies with
 * prose captions between photographs. Preserve all prose and image metadata;
 * move only image-only paragraphs to the first image's position. Code, tables,
 * links and inline illustrations retain their original Markdown semantics.
 */

interface Node {
  type: string;
  value?: string;
  children?: Node[];
}

function onlyImages(node: Node): node is Node & { children: Node[] } {
  if (node.type !== 'paragraph' || !node.children?.length) return false;
  let images = 0;
  for (const child of node.children) {
    if (child.type === 'image' || child.type === 'imageReference') {
      images += 1;
      continue;
    }
    if (child.type === 'text' && !child.value?.trim()) continue;
    return false;
  }
  return images > 0;
}

export function remarkImageGroups() {
  return (tree: Node) => {
    if (!tree.children?.length) return;
    const paragraphs = tree.children.filter(onlyImages);
    if (paragraphs.length < 2) return;
    const first = paragraphs[0];
    const images = paragraphs.flatMap((paragraph) => paragraph.children.filter((node) => node.type !== 'text'));
    const grouped: Node = { ...first, children: images };
    const originals = new Set<Node>(paragraphs);
    tree.children = tree.children.flatMap((node) =>
      node === first ? [grouped] : originals.has(node) ? [] : [node]);
  };
}
