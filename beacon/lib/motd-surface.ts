/**
 * Mapping between the painted MOTD surface and character offsets in the model behind it.
 *
 * The editor is a contenteditable whose DOM is rebuilt from the model after every edit, so the
 * caret has to be carried across as a character index and put back afterwards. That translation is
 * the fiddliest part of the editor and pure DOM work, so it lives here where jsdom can test it
 * rather than inside a dialog component.
 *
 * Newlines live as characters in text nodes. A `<br>` only appears as the browser's own insertion
 * before the next repaint, or as the pad that gives a trailing empty line its height.
 */

export function readAll(root: HTMLElement): string {
  let out = "";
  const visit = (n: Node) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === Node.TEXT_NODE) out += c.nodeValue ?? "";
      else if (c.nodeName === "BR") {
        if (!(c as HTMLElement).dataset.pad) out += "\n";
      } else {
        if (/^(DIV|P)$/.test(c.nodeName) && out && !out.endsWith("\n")) out += "\n";
        visit(c);
      }
    }
  };
  visit(root);
  return out;
}

export function offsetIn(root: HTMLElement, node: Node, off: number): number {
  let count = 0;
  let found = false;
  const visit = (n: Node) => {
    if (found) return;
    if (n.nodeType === Node.TEXT_NODE) {
      if (n === node) {
        count += off;
        found = true;
      } else count += (n.nodeValue ?? "").length;
      return;
    }
    if (n.nodeName === "BR") {
      if (!(n as HTMLElement).dataset.pad) count += 1;
      return;
    }
    const kids = Array.from(n.childNodes);
    for (let i = 0; i < kids.length; i++) {
      if (n === node && i === off) {
        found = true;
        return;
      }
      visit(kids[i]);
      if (found) return;
    }
    if (n === node && off >= kids.length) found = true;
  };
  visit(root);
  return count;
}

export function locate(root: HTMLElement, target: number): [Node, number] {
  let count = 0;
  let hit: [Node, number] | null = null;
  const visit = (n: Node) => {
    if (hit) return;
    if (n.nodeType === Node.TEXT_NODE) {
      const len = (n.nodeValue ?? "").length;
      if (count + len >= target) hit = [n, target - count];
      else count += len;
      return;
    }
    for (const c of Array.from(n.childNodes)) {
      visit(c);
      if (hit) return;
    }
  };
  visit(root);
  return hit ?? [root, 0];
}
