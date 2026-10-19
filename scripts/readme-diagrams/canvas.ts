import { LABEL, style, TRACK, type Theme } from "./theme.ts";

export type Lang = "zh" | "en";
type Copy = string | readonly [zh: string, en: string];
type Mark = "worker" | "do" | "store" | "outside" | "lyjw" | "claude" | "flow";
type Point = readonly [number, number];
type Box = { x: number; y: number; w: number; h: number };

const GRID = 24;
const HEAD = 32;
const PAD = 16;
export const C1 = 24;
export const C2 = 312;
export const C3 = 600;
export const COL = 240;

const CJK = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/;

function textWidth(text: string, size: number, track = 0): number {
  let width = 0;
  for (const ch of text) width += (CJK.test(ch) ? 1 : 0.6) * size + track;
  return width;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function escape(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export class Canvas {
  private readonly layers = { back: [] as string[], cards: [] as string[], edges: [] as string[], top: [] as string[] };
  private readonly gaps: string[] = [];
  readonly w: number;
  readonly h: number;
  private readonly lang: Lang;

  constructor(w: number, h: number, lang: Lang) {
    this.w = w;
    this.h = h;
    this.lang = lang;
  }

  private t(copy: Copy): string {
    return typeof copy === "string" ? copy : copy[this.lang === "zh" ? 0 : 1];
  }

  private text(x: number, y: number, copy: Copy, cls: string, max: number, anchor: "start" | "middle" | "end" = "start"): string {
    const raw = this.t(copy);
    const value = cls === "label" ? raw.toUpperCase() : raw;
    const size = { label: LABEL, title: 14, body: 13, cap: 12, small: 11 }[cls] ?? 12;
    const width = textWidth(value, size, cls === "label" ? TRACK : 0);
    if (width > max) throw new Error(`「${value}」宽 ${width.toFixed(0)}px，只留了 ${max}px`);
    const at = anchor === "start" ? "" : ` text-anchor="${anchor}"`;
    return `<text class="${cls}" x="${round(x)}" y="${round(y)}"${at}>${escape(value)}</text>`;
  }

  private mark(x: number, y: number, mark: Mark): string {
    return mark === "outside"
      ? `<rect class="m-outside" x="${x + 0.5}" y="${y + 0.5}" width="7" height="7"/>`
      : `<rect class="m-${mark}" x="${x}" y="${y}" width="8" height="8"/>`;
  }

  card(box: Box, label: Copy, meta: Copy | null, mark: Mark): Box {
    const { x, y, w, h } = box;
    this.layers.cards.push(
      `<rect class="shadow" x="${x + 3}" y="${y + 3}" width="${w}" height="${h}"/>`,
      `<rect class="card" x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}"/>`,
      `<rect class="head" x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${HEAD - 1}"/>`,
      `<path class="rule" d="M${x + 1} ${y + HEAD + 0.5}H${x + w - 1}"/>`,
      this.mark(x + PAD, y + 12, mark),
    );
    const metaWidth = meta === null ? 0 : textWidth(this.t(meta).toUpperCase(), LABEL, TRACK) + 12;
    this.layers.cards.push(this.text(x + PAD + 16, y + 20, label, "label", w - 2 * PAD - 16 - metaWidth));
    if (meta !== null) this.layers.cards.push(this.text(x + w - PAD, y + 20, meta, "label", metaWidth, "end"));
    return { x: x + PAD, y: y + HEAD, w: w - 2 * PAD, h: h - HEAD };
  }

  lines(body: Box, entries: [Copy, "title" | "cap"][], height = body.h): void {
    const size = (cls: "title" | "cap") => (cls === "title" ? 14 : 12);
    const advance = entries.slice(1).reduce((sum, [, cls]) => sum + (cls === "title" ? 20 : 18), 0);
    const block = 0.8 * size(entries[0][1]) + advance + 0.25 * size(entries[entries.length - 1][1]);
    let y = body.y + (height - block) / 2 + 0.8 * size(entries[0][1]);
    for (const [copy, cls] of entries) {
      this.layers.cards.push(this.text(body.x, Math.round(y), copy, cls, body.w));
      y += cls === "title" ? 20 : 18;
    }
  }

  chip(box: Box, title: Copy, meta: Copy | null, caption: Copy, mark: Mark): void {
    const { x, y, w, h } = box;
    this.layers.cards.push(
      `<rect class="chip" x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}"/>`,
      this.mark(x + 10, y + 9, mark),
    );
    const metaWidth = meta === null ? 0 : textWidth(this.t(meta).toUpperCase(), LABEL, TRACK) + 8;
    this.layers.cards.push(this.text(x + 26, y + 17, title, "body", w - 36 - metaWidth));
    if (meta !== null) this.layers.cards.push(this.text(x + w - 10, y + 17, meta, "label", metaWidth, "end"));
    this.layers.cards.push(this.text(x + 10, y + h - 9, caption, "small", w - 20));
  }

  tags(body: Box, names: Copy[], columns: number, top = 12, height = 26, gap = 8): void {
    const width = (body.w - gap * (columns - 1)) / columns;
    names.forEach((name, i) => {
      const x = body.x + (i % columns) * (width + gap);
      const y = body.y + top + Math.floor(i / columns) * (height + gap);
      this.layers.cards.push(
        `<rect class="chip" x="${round(x + 0.5)}" y="${y + 0.5}" width="${round(width - 1)}" height="${height - 1}"/>`,
        this.text(x + width / 2, y + height / 2 + 4.5, name, "body", width - 12, "middle"),
      );
    });
  }

  rows(body: Box, entries: [Copy, Copy | null][], top = 4, height = 24): void {
    entries.forEach(([left, right], i) => {
      const y = body.y + top + i * height;
      if (i > 0) this.layers.cards.push(`<path class="rule" d="M${body.x} ${y + 0.5}H${body.x + body.w}"/>`);
      const rightWidth = right === null ? 0 : textWidth(this.t(right), 11) + 12;
      this.layers.cards.push(this.text(body.x, y + 16.5, left, "body", body.w - rightWidth));
      if (right !== null) this.layers.cards.push(this.text(body.x + body.w, y + 16.5, right, "small", rightWidth, "end"));
    });
  }

  edge(points: Point[], { end = true, start = false, dash = false } = {}): void {
    const tip = (to: Point, from: Point) => {
      const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
      const [ux, uy] = [(to[0] - from[0]) / len, (to[1] - from[1]) / len];
      const back: Point = [to[0] - ux * 8, to[1] - uy * 8];
      const wing = (side: number) => `${round(back[0] - side * uy * 4.5)} ${round(back[1] + side * ux * 4.5)}`;
      this.layers.edges.push(`<path class="tip" d="M${to[0]} ${to[1]}L${wing(1)}L${wing(-1)}Z"/>`);
      return [to[0] - ux * 6, to[1] - uy * 6] as Point;
    };
    const path = [...points];
    if (end) path[path.length - 1] = tip(points[points.length - 1], points[points.length - 2]);
    if (start) path[0] = tip(points[0], points[1]);
    const d = path.map(([x, y], i) => `${i === 0 ? "M" : "L"}${round(x)} ${round(y)}`).join("");
    this.layers.edges.push(`<path class="edge${dash ? " dash" : ""}" d="${d}"/>`);
  }

  dot(x: number, y: number): void {
    this.layers.edges.push(`<circle class="tip" cx="${x}" cy="${y}" r="3.5"/>`);
  }

  note(x: number, y: number, copy: Copy, anchor: "start" | "middle" | "end" = "start", max = 260): void {
    const width = textWidth(this.t(copy), 11);
    const left = anchor === "start" ? x : anchor === "middle" ? x - width / 2 : x - width;
    this.gaps.push(`<rect x="${round(left - 4)}" y="${y - 8}" width="${round(width + 8)}" height="16"/>`);
    this.layers.top.push(this.text(x, y + 4, copy, "small", max, anchor));
  }

  region(box: Box, label: Copy, mark: Mark): void {
    const { x, y, w, h } = box;
    this.layers.back.push(`<rect class="region" x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}"/>`);
    const width = textWidth(this.t(label).toUpperCase(), LABEL, TRACK);
    this.gaps.push(`<rect x="${x + 8}" y="${y - 8}" width="${round(width + 30)}" height="16"/>`);
    this.layers.top.push(
      this.mark(x + 14, y - 4, mark),
      this.text(x + 28, y + 4, label, "label", width),
    );
  }

  legend(x: number, y: number, entries: [Mark, Copy][], vertical: boolean): void {
    let [ex, ey] = [x, y];
    for (const [mark, copy] of entries) {
      const width = textWidth(this.t(copy), 12);
      if (ex + 16 + width > this.w - GRID) throw new Error(`图例「${this.t(copy)}」超出画布`);
      this.layers.top.push(this.mark(round(ex), ey - 8, mark), this.text(ex + 16, ey, copy, "cap", width));
      if (vertical) ey += GRID;
      else ex += 16 + width + 32;
    }
  }

  render(theme: Theme, title: Copy, description: Copy): string {
    const { w, h } = this;
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="title desc">`,
      `<title id="title">${escape(this.t(title))}</title><desc id="desc">${escape(this.t(description))}</desc>`,
      `<style>${style(theme)}</style>`,
      `<defs><mask id="gaps" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#fff"/>${this.gaps.join("")}</mask></defs>`,
      `<g mask="url(#gaps)">`,
      ...this.layers.back,
      `</g>`,
      ...this.layers.cards,
      `<g mask="url(#gaps)">`,
      ...this.layers.edges,
      `</g>`,
      ...this.layers.top,
      `</svg>`,
      "",
    ].join("\n");
  }
}
