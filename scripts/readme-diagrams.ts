#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs", "diagrams");
const TOKENS = path.join(ROOT, "src", "app", "globals.css");

type Lang = "zh" | "en";
type Theme = "light" | "dark";
type Copy = string | readonly [zh: string, en: string];
type Mark = "worker" | "do" | "store" | "outside" | "lyjw" | "claude" | "devin" | "flow";
type Point = readonly [number, number];
type Box = { x: number; y: number; w: number; h: number };

// GitHub 把图当 <img> 显示，图里不加载网络字体：Geist Mono 只在装了它的机器上生效，其余落到系统等宽字体。
const FONT = "'Geist Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif";
const GRID = 24;
const HEAD = 32;
const PAD = 16;
const LABEL = 11;
const TRACK = 0.88;

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

type Rgba = [number, number, number, number];

function oklchToRgb(l: number, c: number, h: number): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const lms = [
    (l + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    (l - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    (l - 0.0894841775 * a - 1.291485548 * b) ** 3,
  ];
  const linear = [
    4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2],
    -1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2],
    -0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2],
  ];
  return linear.map((v) => {
    const clamped = Math.min(1, Math.max(0, v));
    return 255 * (clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055);
  }) as [number, number, number];
}

function tokenBlock(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`globals.css 里找不到 ${selector}`);
  const body = css.slice(start, css.indexOf("\n}", start));
  return new Map([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

function parseColor(value: string, vars: Map<string, string>): Rgba {
  const ref = /^var\(--([\w-]+)\)$/.exec(value);
  if (ref) return parseColor(vars.get(ref[1]) ?? "", vars);
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as Rgba;
  const oklch = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+)%)?\)$/.exec(value);
  if (oklch) return [...oklchToRgb(+oklch[1], +oklch[2], +oklch[3]), oklch[4] === undefined ? 1 : +oklch[4] / 100];
  throw new Error(`认不出的颜色：${value}`);
}

function hex([r, g, b, a]: Rgba): string {
  const parts = [r, g, b, ...(a < 1 ? [a * 255] : [])];
  return `#${parts.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

function palette(theme: Theme) {
  const css = readFileSync(TOKENS, "utf8");
  const vars = tokenBlock(css, ":root");
  if (theme === "dark") for (const [k, v] of tokenBlock(css, ".dark")) vars.set(k, v);
  const color = (name: string) => hex(parseColor(vars.get(name) ?? "", vars));
  const [r, g, b] = parseColor(vars.get("foreground") ?? "", vars);
  return {
    bg: color("background"),
    grid: hex([r, g, b, 0.05]),
    surface: color("surface"),
    muted: color("muted"),
    fg: color("foreground"),
    mutedFg: color("muted-foreground"),
    line: color("line"),
    lineStrong: color("line-strong"),
    shadow: color("paper-shadow"),
    worker: color("signal-blue"),
    do: color("live"),
    store: color("signal-violet"),
    lyjw: color("avatar-lyjw131"),
    claude: color("claude"),
    devin: color("signal-green"),
  };
}

function style(theme: Theme): string {
  const p = palette(theme);
  return [
    `text{font-family:${FONT};font-variant-numeric:tabular-nums slashed-zero}`,
    `.bg{fill:${p.bg}}.grid{fill:none;stroke:${p.grid}}`,
    `.card{fill:${p.surface};stroke:${p.lineStrong}}.shadow{fill:${p.shadow}}`,
    `.head{fill:${p.muted}}.rule{stroke:${p.line}}.chip{fill:${p.muted};stroke:${p.line}}`,
    `.region{fill:none;stroke:${p.mutedFg};stroke-dasharray:4 4}`,
    `.edge{fill:none;stroke:${p.mutedFg};stroke-width:1.5}.edge.dash{stroke-dasharray:5 4}.tip{fill:${p.mutedFg}}`,
    `.knock{fill:${p.bg}}`,
    `.label{font-size:${LABEL}px;letter-spacing:${TRACK}px;fill:${p.mutedFg}}`,
    `.title{font-size:14px;font-weight:500;fill:${p.fg}}.body{font-size:13px;fill:${p.fg}}`,
    `.cap{font-size:12px;fill:${p.mutedFg}}.small{font-size:11px;fill:${p.mutedFg}}`,
    `.m-worker{fill:${p.worker}}.m-do{fill:${p.do}}.m-store{fill:${p.store}}.m-lyjw{fill:${p.lyjw}}`,
    `.m-claude{fill:${p.claude}}.m-devin{fill:${p.devin}}.m-flow{fill:${p.fg}}.m-outside{fill:none;stroke:${p.lineStrong}}`,
  ].join("");
}

class Canvas {
  private readonly layers = { back: [] as string[], cards: [] as string[], edges: [] as string[], top: [] as string[] };
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
    this.layers.top.push(
      `<rect class="knock" x="${round(left - 4)}" y="${y - 8}" width="${round(width + 8)}" height="16"/>`,
      this.text(x, y + 4, copy, "small", max, anchor),
    );
  }

  region(box: Box, label: Copy, mark: Mark): void {
    const { x, y, w, h } = box;
    this.layers.back.push(`<rect class="region" x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}"/>`);
    const width = textWidth(this.t(label).toUpperCase(), LABEL, TRACK);
    this.layers.top.push(
      `<rect class="knock" x="${x + 8}" y="${y - 8}" width="${round(width + 30)}" height="16"/>`,
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
      `<defs><pattern id="paper" width="${GRID}" height="${GRID}" patternUnits="userSpaceOnUse"><path class="grid" d="M${GRID} 0.5H0.5V${GRID}"/></pattern></defs>`,
      `<rect class="bg" width="${w}" height="${h}"/><rect width="${w}" height="${h}" fill="url(#paper)"/>`,
      ...this.layers.back,
      ...this.layers.cards,
      ...this.layers.edges,
      ...this.layers.top,
      `</svg>`,
      "",
    ].join("\n");
  }
}

const C1 = 24;
const C2 = 312;
const C3 = 600;
const COL = 240;

function architecture(lang: Lang): Canvas {
  const c = new Canvas(864, 864, lang);

  const sources = c.card({ x: C1, y: 24, w: C2 + COL - C1, h: 120 }, ["采集端", "Sources"], ["设备与上报器", "Devices · reporters"], "outside");
  c.tags(sources, ["Mac", "iPhone", "HomePod", "Emby", "PlayStation", "Quest", ["Linux 节点", "Linux node"], ["Coding agent", "Coding agents"]], 4);
  const visitors = c.card({ x: C3, y: 24, w: COL, h: 120 }, ["访客", "Visitors"], null, "outside");
  c.rows(visitors, [["lyjw.me", ["直连", "direct"]], ["lyjw131.com", ["经阿里云 ESA", "via Alibaba ESA"]], ["/mcp", ["MCP 客户端", "MCP clients"]]]);

  c.region({ x: 12, y: 192, w: 840, h: 504 }, "Cloudflare", "worker");

  const ingress = c.card({ x: C1, y: 216, w: COL, h: 96 }, "Ingress", "Worker", "worker");
  c.lines(ingress, [[["验身份 · 校验 · 拆分", "Auth · validate · split"], "title"], [["Access 之后，按来源限权", "behind Access, per source"], "cap"]]);
  const collector = c.card({ x: C1, y: 456, w: COL, h: 96 }, "Collector", "Worker", "worker");
  c.lines(collector, [[["定时拉取外部服务", "Polls outside services"], "title"], [["Apple Music 查询与补全", "Apple Music lookups"], "cap"]]);

  const core = c.card({ x: C2, y: 216, w: COL, h: 168 }, "Core", "Worker", "worker");
  c.lines(core, [[["实时状态的唯一权威", "Owns all live state"], "title"]], 44);
  c.chip({ x: core.x, y: core.y + 40, w: core.w, h: 40 }, "StateHub", "DO", ["快照 · Pulse · 用量账本", "snapshots · Pulse · ledgers"], "do");
  c.chip({ x: core.x, y: core.y + 88, w: core.w, h: 40 }, "LivePushRoom", "DO", ["WebSocket 推送 · 在线人数", "WebSocket push · presence"], "do");
  c.lines(c.card({ x: C2, y: 408, w: COL, h: 72 }, "KV", "Lag", "store"), [[["可滞后快照", "Lag-tolerant snapshots"], "title"]]);
  c.lines(c.card({ x: C2, y: 504, w: COL, h: 72 }, "D1", "History", "store"), [[["长期归档 · 不对外读", "Archive · never served"], "title"]]);
  c.lines(c.card({ x: C2, y: 600, w: COL, h: 72 }, "R2", "Images", "store"), [[["图片 · 上报端直传", "Images · direct uploads"], "title"]]);

  const site = c.card({ x: C3, y: 216, w: COL, h: 120 }, "Site", "Worker", "worker");
  c.lines(site, [["React Router SSR", "title"], [["首屏按卡读状态", "first screen, card by card"], "cap"], [["Workers 缓存 · /img/*", "Workers cache · /img/*"], "cap"]]);
  const ai = c.card({ x: C3, y: 432, w: COL, h: 96 }, "AI", "Worker", "worker");
  c.lines(ai, [[["对话 · MCP · 访客构建", "Chat · MCP · builds"], "title"], [["Clef 选档 · 经 core 读状态", "Clef tiers · reads via core"], "cap"]]);

  const external = c.card({ x: C1, y: 720, w: COL, h: 120 }, ["外部服务", "Outside services"], null, "outside");
  c.rows(external, [["Apple Music", null], ["GitHub · Cloudflare", null], [["PageSpeed · 状态页", "PageSpeed · status pages"], null]]);
  const models = c.card({ x: C3, y: 720, w: COL, h: 120 }, ["模型与 GitHub", "Models · GitHub"], null, "outside");
  c.rows(models, [["Anthropic · DeepSeek", null], ["Exa · Managed Agents", null], ["GitHub App · Actions", null]]);

  c.edge([[144, 144], [144, 216]]);
  c.note(156, 168, "Access token · /api/ingest/*");
  c.edge([[660, 144], [660, 216]], { start: true });
  c.note(672, 168, "HTML · /api · /ws");

  c.edge([[144, 312], [144, 456]], { dash: true });
  c.note(156, 384, ["补全正在听", "enrich now playing"]);
  c.edge([[144, 720], [144, 552]]);
  c.note(156, 636, ["每分钟拉取", "polled every minute"]);

  c.edge([[264, 264], [312, 264]]);
  c.edge([[288, 264], [288, 540], [312, 540]]);
  c.edge([[288, 444], [312, 444]]);
  c.edge([[264, 504], [288, 504]], { end: false });
  for (const y of [264, 444, 504]) c.dot(288, y);

  c.edge([[552, 264], [600, 264]]);
  c.edge([[552, 636], [576, 636], [576, 264]], { end: false });
  c.edge([[552, 444], [576, 444]], { end: false });
  c.edge([[576, 480], [600, 480]]);
  for (const y of [264, 444, 480]) c.dot(576, y);

  c.edge([[660, 336], [660, 432]]);
  c.note(672, 384, ["对话 · /mcp · 构建", "chat · /mcp · builds"]);
  c.edge([[660, 528], [660, 720]], { start: true });
  c.note(672, 624, ["模型 · 搜索 · PR", "models · search · PRs"]);
  c.note(432, 696, ["Worker 之间走 Service Binding", "Workers talk over Service Bindings"], "middle");

  c.legend(C2 + 12, 756, [
    ["worker", "Worker"],
    ["do", "Durable Object"],
    ["store", ["存储", "Storage"]],
    ["outside", ["Cloudflare 之外", "Outside Cloudflare"]],
  ], true);
  return c;
}

function workflow(lang: Lang): Canvas {
  const c = new Canvas(864, 744, lang);

  const lyjw = c.card({ x: C1, y: 24, w: COL, h: 96 }, "lyjw", ["定方向", "Direction"], "lyjw");
  c.lines(lyjw, [[["一句话需求", "One-line asks"], "title"], [["拍板 · 看图 · 说「合」", "decides · reviews · merges"], "cap"]]);
  const cron = c.card({ x: C2, y: 24, w: COL, h: 96 }, ["定时触发", "Schedules"], "Cron", "outside");
  c.lines(cron, [[["云端 routine", "Cloud routines"], "title"], [["从上次的书签接着跑", "resume from a bookmark"], "cap"]]);
  const visitors = c.card({ x: C3, y: 24, w: COL, h: 96 }, ["访客", "Visitors"], "lyjw.me", "outside");
  c.lines(visitors, [[["在首页对话里提改动", "Ask in homepage chat"], "title"], [["授权 GitHub 后开构建", "authorize GitHub to build"], "cap"]]);

  c.region({ x: 12, y: 144, w: 840, h: 384 }, "Claude", "claude");

  const chat = c.card({ x: C1, y: 168, w: COL, h: 96 }, ["项目聊天", "Project chat"], ["协调", "Coordinator"], "claude");
  c.lines(chat, [[["接每句话，分派线程", "Takes every message"], "title"], [["晨报 · 转贴决策卡", "brief · decision cards"], "cap"]]);
  const thread = c.card({ x: C1, y: 312, w: COL, h: 192 }, ["线程", "Thread"], "Claude", "claude");
  c.lines(thread, [[["一件事一个线程", "One thread per task"], "title"], [["一个分支，做到上线", "own branch, through deploy"], "cap"]], 64);
  c.chip({ x: thread.x, y: thread.y + 64, w: thread.w, h: 40 }, "Devin CLI", "Mac", ["并行实现 · 一件事一个 worktree", "parallel work · worktrees"], "devin");
  c.chip({ x: thread.x, y: thread.y + 112, w: thread.w, h: 40 }, ["Haiku 验证员", "Haiku verifier"], null, ["按提交签分级回执", "graded receipt per commit"], "claude");

  const routines = c.card({ x: C2, y: 168, w: COL, h: 168 }, ["定时任务", "Routines"], null, "claude");
  c.rows(routines, [
    [["代码审查", "Code review"], "PR"],
    [["提炼 skill", "Skill mining"], "PR"],
    [["记忆镜像", "Memory mirror"], "PR"],
    [["collector 盯防", "Collector watch"], ["修复草稿", "fix draft"]],
    [["Anthropic 动态", "Anthropic digest"], ["报告", "report"]],
  ], 8);

  const planner = c.card({ x: C3, y: 168, w: COL, h: 96 }, ["设计会话", "Design session"], "Opus", "claude");
  c.lines(planner, [[["只读沙盒里出计划", "Plans in a read-only box"], "title"], ["Managed Agents", "cap"]]);
  const build = c.card({ x: C3, y: 312, w: COL, h: 96 }, ["访客构建", "Visitor build"], "Actions", "claude");
  c.lines(build, [[["先审计划，再实现", "Review plan, then build"], "title"], [["build.yml · 无写凭据", "build.yml · no write token"], "cap"]]);

  const pr = c.card({ x: C1, y: 576, w: COL, h: 120 }, "PR", null, "flow");
  c.lines(pr, [[["分支预览", "Branch preview"], "title"], ["*.preview.lyjw.dev", "cap"], [["UI 在预览上验", "UI checked here"], "cap"]]);
  const gate = c.card({ x: C2, y: 576, w: COL, h: 120 }, ["合并门槛", "Merge gate"], null, "flow");
  c.rows(gate, [
    [["CI 门禁", "CI"], ["lint · 测试 · 检查", "lint · tests · rules"]],
    [["机器评审", "Bot review"], ["大改逻辑才等", "logic changes"]],
    [["lyjw 点头", "lyjw's OK"], ["UI 变化看图", "UI changes"]],
  ], 8);
  const main = c.card({ x: C3, y: 576, w: COL, h: 120 }, "main", "Workers Builds", "flow");
  c.lines(main, [[["合并提交，自动部署", "Merged, auto-deployed"], "title"], [["ESA 首页随之刷新", "ESA home refreshed"], "cap"], [["核对 /api/version", "check /api/version"], "cap"]]);

  c.edge([[144, 120], [144, 168]], { start: true });
  c.edge([[432, 120], [432, 168]]);
  c.edge([[720, 120], [720, 168]]);
  c.edge([[312, 216], [264, 216]]);
  c.edge([[144, 264], [144, 312]]);
  c.note(156, 288, ["开线程", "opens a thread"]);
  c.edge([[720, 264], [720, 312]]);
  c.note(732, 288, ["访客确认计划", "visitor confirms"]);

  c.edge([[144, 504], [144, 576]]);
  c.edge([[432, 336], [432, 552], [144, 552]], { end: false });
  c.edge([[720, 408], [720, 552], [432, 552]], { end: false });
  for (const x of [144, 432]) c.dot(x, 552);
  c.note(576, 552, ["都以 PR 进 main", "everything lands as a PR"], "middle");

  c.edge([[264, 636], [312, 636]]);
  c.edge([[552, 636], [600, 636]]);
  c.note(576, 144, ["共享一份项目记忆", "one shared project memory"], "middle");

  c.legend(C1, 728, [
    ["lyjw", "lyjw"],
    ["claude", "Claude"],
    ["devin", "Devin"],
    ["flow", ["GitHub · Cloudflare", "GitHub · Cloudflare"]],
    ["outside", ["外部触发", "Outside triggers"]],
  ], false);
  return c;
}

const DIAGRAMS = {
  architecture: {
    draw: architecture,
    title: ["lyjwpage 系统架构", "lyjwpage architecture"],
    description: [
      "采集端经 Cloudflare Access 上报到 ingress Worker，collector Worker 每分钟拉取外部服务；两者写入 core Worker 的 Durable Object 实时层、KV 可滞后快照与 D1 归档，图片进 R2。site Worker 直读 KV、经 Service Binding 读 core 的实时状态与推送，渲染 lyjw.me，中国大陆经阿里云 ESA；对话、MCP 与访客构建交给 AI Worker，它调用模型与 GitHub。",
      "Reporters post through Cloudflare Access to the ingress Worker, and the collector Worker polls outside services every minute. Both write the core Worker's Durable Objects for live state, KV for lag-tolerant snapshots and D1 for the archive; images go to R2. The site Worker reads KV directly and reads live state and pushes from core over Service Bindings to render lyjw.me, fronted by Alibaba ESA in mainland China. Chat, MCP and visitor builds go to the AI Worker, which calls the models and GitHub.",
    ],
  },
  workflow: {
    draw: workflow,
    title: ["lyjwpage 开发工作流", "lyjwpage development workflow"],
    description: [
      "lyjw 在项目聊天里说一句需求，协调 Claude 开线程，线程 Claude 借 Mac 上的 Devin CLI 并行实现、交 Haiku 验证员签回执；定时任务与访客构建也各自产出 PR。所有改动以 PR 进 main：分支预览、CI 门禁、按需的机器评审与 lyjw 点头之后合并，Workers Builds 自动部署。",
      "lyjw asks in the project chat, a coordinator Claude opens a thread, and the thread's Claude works with Devin CLI on lyjw's Mac and a Haiku verifier that signs receipts. Routines and visitor builds open PRs as well. Every change reaches main as a PR: branch preview, CI gates, bot review when needed and lyjw's OK, then Workers Builds deploys it.",
    ],
  },
} as const;

export function renderAll(): Map<string, string> {
  const files = new Map<string, string>();
  for (const [name, spec] of Object.entries(DIAGRAMS)) {
    for (const lang of ["zh", "en"] as const) {
      const canvas = spec.draw(lang);
      for (const theme of ["light", "dark"] as const) {
        files.set(`${name}-${lang}-${theme}.svg`, canvas.render(theme, spec.title, spec.description));
      }
    }
  }
  return files;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  mkdirSync(OUT, { recursive: true });
  for (const [name, svg] of renderAll()) writeFileSync(path.join(OUT, name), svg);
  console.log(`写出 ${path.relative(ROOT, OUT)}/ 下的 ${renderAll().size} 张图`);
}
