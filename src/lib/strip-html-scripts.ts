import { parseFragment } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

// 按 HTML 解析树删 script：标签名不分大小写，结束标签可以带空白和属性。
export function stripHtmlScripts(html: string): string {
  const ranges: Array<[number, number]> = [];
  collect(parseFragment(html, { sourceCodeLocationInfo: true }), html.length, ranges);
  return cut(html, ranges);
}

function collect(node: Node, htmlLength: number, ranges: Array<[number, number]>): void {
  if (node.nodeName === "script") {
    ranges.push(scriptSpan(node, htmlLength));
    return;
  }
  if ("content" in node) collect(node.content, htmlLength, ranges);
  if ("childNodes" in node) {
    for (const child of node.childNodes) collect(child, htmlLength, ranges);
  }
}

function scriptSpan(element: Element, htmlLength: number): [number, number] {
  const location = element.sourceCodeLocation;
  if (!location) throw new Error("script element is missing a source location");
  const start = location.startOffset;
  // 没有结束标签时元素跨度是空的，正文记在文本子节点上，一直到片段末尾。
  let end = location.endTag ? location.endOffset : (location.startTag?.endOffset ?? start);
  if (!location.endTag) {
    for (const child of element.childNodes) {
      const childEnd = child.sourceCodeLocation?.endOffset;
      if (childEnd != null && childEnd > end) end = childEnd;
    }
    if (end <= start) end = htmlLength;
  }
  if (start < 0 || end < start || end > htmlLength) throw new Error("script element source location is out of range");
  return [start, end];
}

function cut(html: string, ranges: Array<[number, number]>): string {
  if (ranges.length === 0) return html;
  const ordered = [...ranges].sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const merged: Array<[number, number]> = [];
  for (const range of ordered) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  let out = html;
  for (let index = merged.length - 1; index >= 0; index -= 1) {
    const range = merged[index];
    if (!range) continue;
    out = out.slice(0, range[0]) + out.slice(range[1]);
  }
  return out;
}
