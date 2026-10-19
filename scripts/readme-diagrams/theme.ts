import { readFileSync } from "node:fs";

const TOKENS = new URL("../../src/app/styles/theme.css", import.meta.url);

export type Theme = "light" | "dark";

// GitHub 把图当 <img> 显示，图里不加载网络字体：Geist Mono 只在装了它的机器上生效，其余落到系统等宽字体。
const FONT = "'Geist Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif";
export const LABEL = 11;
export const TRACK = 0.88;

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
  if (start < 0) throw new Error(`theme.css 里找不到 ${selector}`);
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
  return {
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
  };
}

export function style(theme: Theme): string {
  const p = palette(theme);
  return [
    `text{font-family:${FONT};font-variant-numeric:tabular-nums slashed-zero}`,
    `.card{fill:${p.surface};stroke:${p.lineStrong}}.shadow{fill:${p.shadow}}`,
    `.head{fill:${p.muted}}.rule{stroke:${p.line}}.chip{fill:${p.muted};stroke:${p.line}}`,
    `.region{fill:none;stroke:${p.mutedFg};stroke-dasharray:4 4}`,
    `.edge{fill:none;stroke:${p.mutedFg};stroke-width:1.5}.edge.dash{stroke-dasharray:5 4}.tip{fill:${p.mutedFg}}`,
    `.label{font-size:${LABEL}px;letter-spacing:${TRACK}px;fill:${p.mutedFg}}`,
    `.title{font-size:14px;font-weight:500;fill:${p.fg}}.body{font-size:13px;fill:${p.fg}}`,
    `.cap{font-size:12px;fill:${p.mutedFg}}.small{font-size:11px;fill:${p.mutedFg}}`,
    `.m-worker{fill:${p.worker}}.m-do{fill:${p.do}}.m-store{fill:${p.store}}.m-lyjw{fill:${p.lyjw}}`,
    `.m-claude{fill:${p.claude}}.m-flow{fill:${p.fg}}.m-outside{fill:none;stroke:${p.lineStrong}}`,
  ].join("");
}
