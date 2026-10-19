import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Heading, Ink } from "@/components/chat-visual/ink";
import type { DiagramVisual } from "@shared/god-chat";

const ARROW_PX = 4;
// 一层只有一两个节点时方框不撑满整栏，宽屏上整张图收在中间。
const DIAGRAM_NODE_MAX = "14rem";

// 连线标签单行截断在 max-w-28 以内；中点贴近图边时按标签实际宽度夹回图里，窄屏上不撑出聊天区。
function placeLabel(element: HTMLElement | null, x: number, frame: HTMLElement | null) {
  if (!element || !frame) return;
  const half = element.offsetWidth / 2;
  element.style.left = `${Math.min(Math.max(x, half), frame.clientWidth - half)}px`;
}

type Wire = { path: string; head: string; label?: string; x: number; y: number };

function wires(visual: DiagramVisual, frame: HTMLElement, boxes: Map<string, HTMLElement>): Wire[] {
  const origin = frame.getBoundingClientRect();
  const out: Wire[] = [];
  for (const edge of visual.edges) {
    const from = boxes.get(edge.from)?.getBoundingClientRect();
    const to = boxes.get(edge.to)?.getBoundingClientRect();
    if (!from || !to) continue;
    const down = to.top >= from.bottom;
    const sx = from.left + from.width / 2 - origin.left;
    const sy = (down ? from.bottom : from.top) - origin.top;
    const ex = to.left + to.width / 2 - origin.left;
    const ey = (down ? to.top : to.bottom) - origin.top;
    const tip = down ? ey - ARROW_PX : ey + ARROW_PX;
    const bend = (tip - sy) / 2;
    out.push({
      path: `M${sx},${sy} C${sx},${sy + bend} ${ex},${tip - bend} ${ex},${tip}`,
      head: `${ex - ARROW_PX},${tip} ${ex + ARROW_PX},${tip} ${ex},${ey}`,
      label: edge.label,
      x: (sx + ex) / 2,
      y: (sy + tip) / 2,
    });
  }
  return out;
}

// 连线按方框渲染后的实际位置画：节点文字换行、行高不一、窄屏挤压都会改位置，算不出来只能量。
export function Diagram({ visual }: { visual: DiagramVisual }) {
  const frame = useRef<HTMLDivElement>(null);
  const boxes = useRef(new Map<string, HTMLElement>());
  const [size, setSize] = useState("");
  const [lines, setLines] = useState<Wire[]>([]);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize(`${entry.contentRect.width}x${entry.contentRect.height}`));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (frame.current) setLines(wires(visual, frame.current, boxes.current));
  }, [visual, size]);

  const labels = new Map(visual.layers.flatMap((layer) => layer.nodes.map((node) => [node.id, node.label] as const)));
  return (
    <figure>
      <Heading title={visual.title} />
      <div ref={frame} className="relative flex flex-col gap-8">
        <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
          {lines.map((line, i) => (
            <g key={i}>
              <path d={line.path} fill="none" stroke="var(--muted-foreground)" strokeWidth={1} />
              <polygon points={line.head} fill="var(--muted-foreground)" />
            </g>
          ))}
        </svg>
        {visual.layers.map((layer, i) => (
          <div key={i} className="relative space-y-1">
            {layer.label && <div className="w-max max-w-full bg-surface pr-1 font-mono text-2xs text-muted-foreground">{layer.label}</div>}
            <div className="grid justify-center gap-2" style={{ gridTemplateColumns: `repeat(${layer.nodes.length}, minmax(0, ${DIAGRAM_NODE_MAX}))` }}>
              {layer.nodes.map((node) => (
                <div
                  key={node.id}
                  ref={(element) => {
                    if (element) boxes.current.set(node.id, element);
                    else boxes.current.delete(node.id);
                  }}
                  className="min-w-0 border border-line bg-surface px-2 py-1.5 text-center break-words"
                >
                  <div className="text-xs font-medium"><Ink>{node.label}</Ink></div>
                  {node.note && <div className="text-2xs text-muted-foreground"><Ink>{node.note}</Ink></div>}
                </div>
              ))}
            </div>
          </div>
        ))}
        {lines.map(
          (line, i) =>
            line.label && (
              <span
                key={i}
                aria-hidden
                ref={(element) => placeLabel(element, line.x, frame.current)}
                title={line.label}
                className="absolute max-w-28 -translate-1/2 truncate bg-surface px-1 text-2xs text-muted-foreground"
                style={{ left: line.x, top: line.y }}
              >
                {line.label}
              </span>
            ),
        )}
      </div>
      {visual.edges.length > 0 && (
        <ul className="sr-only">
          {visual.edges.map((edge, i) => (
            <li key={i}>
              {labels.get(edge.from)} → {labels.get(edge.to)}
              {edge.label && `: ${edge.label}`}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
