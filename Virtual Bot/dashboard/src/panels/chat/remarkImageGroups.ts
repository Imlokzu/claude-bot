/*
 * Склеювання сусідніх абзаців із картинок в один.
 *
 * Модель майже завжди ставить картинки через порожній рядок:
 *
 *     ![перша](…)
 *
 *     ![друга](…)
 *
 * Для markdown це ДВА абзаци, тож галерея бачила по одній картинці й
 * малювала два окремі кадри замість одного набору. Тут вони зводяться в
 * один абзац ще до рендера — далі перевизначення `p` (див. Markdown.tsx)
 * саме собою отримує повний список і показує гармошку.
 *
 * Абзац із текстом такий ланцюжок обриває: підпис між картинками означає,
 * що це різні речі, а не один набір.
 */

interface Node {
  type: string;
  value?: string;
  children?: Node[];
}

/** Абзац, у якому лише картинки (і пробіли з переносами між ними). */
function onlyImages(node: Node | undefined): node is Node & { children: Node[] } {
  if (!node || node.type !== 'paragraph' || !node.children?.length) return false;
  let images = 0;
  for (const child of node.children) {
    if (child.type === 'image') {
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
    const children = tree.children;
    if (!children?.length) return;
    const merged: Node[] = [];
    for (const node of children) {
      const previous = merged[merged.length - 1];
      if (onlyImages(node) && onlyImages(previous)) {
        // Порожній текстовий вузол між картинками лишаємо: у зібраному
        // абзаці він тримає ті самі переноси, що були в розмітці.
        previous.children.push({ type: 'text', value: '\n' }, ...node.children);
        continue;
      }
      merged.push(node);
    }
    tree.children = merged;
  };
}
