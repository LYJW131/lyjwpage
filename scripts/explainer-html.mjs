import { parse } from "parse5";

export function findUnpublishedReference(html) {
  const pending = [parse(html)];
  while (pending.length) {
    const node = pending.pop();
    for (const { name, value } of node.attrs ?? []) {
      if ((name === "src" || name === "href") && !/^(?:[a-z]+:|\/|#)/i.test(value)) return value;
    }
    if (node.content) pending.push(node.content);
    pending.push(...(node.childNodes ?? []));
  }
  return null;
}
