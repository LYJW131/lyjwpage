export type LiveCardView = {
  kind: "watching" | "gaming" | "coding" | "listening" | "idle";
  title: string | null;
  subtitle: string | null;
  // 已经内联好的封面 data URI（image/webp 或 image/jpeg），没有就 null
  artwork: string | null;
  alsoListening: { title: string; artist: string | null } | null;
  // idle 时显示「多久前活跃」用；epoch ms，可空
  lastActiveAt: number | null;
};

// 宽度与 /api/cards/week.svg、/api/cards/voronoi.svg 一致：width 724、viewBox 左缘 28，内容落在 x=28..752。
const X0 = 28;
const RIGHT = 752;
const WIDTH = RIGHT - X0;
const LABEL_Y = 34;
const ART_Y = 44;
const ART = 78;
const TEXT_X = X0 + ART + 18;
const TITLE_Y = 88;
const SUBTITLE_Y = 110;
const ALSO_Y = 138;
const SHORT_H = 134;
const TALL_H = 150;

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const STYLE =
  "<style>:root{--bg:#ffffff;--fg:#1f2328;--mute:#656d76}" +
  "@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--mute:#8b949e}}</style>";

const LABELS: Record<LiveCardView["kind"], string> = {
  watching: "NOW · WATCHING",
  gaming: "NOW · PLAYING",
  coding: "NOW · CODING",
  listening: "NOW · LISTENING",
  idle: "NOW · OFFLINE",
};
const ARIA: Record<LiveCardView["kind"], string> = {
  watching: "Now watching",
  gaming: "Now playing",
  coding: "Now coding",
  listening: "Now listening",
  idle: "Now offline",
};

// 0x20 以下（除 \t\n\r）与 0x7f 是非法 XML 字符，会让整张图打不开。
const xml = (s: string) =>
  s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "") // eslint-disable-line no-control-regex
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

// 卡片在看的人浏览器里用系统字体渲染，宽度一律往宽估：估小了会画出右缘，估大只是早截断。
function charEm(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (
    (cp >= 0x1100 && cp <= 0x11ff) || // Hangul Jamo
    (cp >= 0x2190 && cp <= 0x27bf) || // 箭头、杂项符号（♪ 也在这里）
    (cp >= 0x2e80 && cp <= 0xa4cf) || // 假名与中日韩诸区
    (cp >= 0xac00 && cp <= 0xd7af) || // Hangul 音节
    (cp >= 0xf900 && cp <= 0xfaff) || // 兼容表意文字
    (cp >= 0xfe30 && cp <= 0xfe6b) || // CJK 兼容形式与小字变体
    (cp >= 0xff00 && cp <= 0xff60) || // 全角
    (cp >= 0x1f000 && cp <= 0x1faff) || // emoji
    cp >= 0x20000 // CJK 扩 B 及以后，一律全宽
  ) return 1;
  if ("MWmw@%".includes(ch)) return 0.95;
  if (" '\"`ijltfrI.,:;|!()[]{}-/\\".includes(ch)) return 0.35;
  if (cp >= 0x41 && cp <= 0x5a) return 0.72;
  if (cp >= 0x30 && cp <= 0x39) return 0.58;
  if (cp >= 0x61 && cp <= 0x7a) return 0.56;
  return 0.7;
}

export function liveCardTextWidth(text: string, px: number): number {
  let ems = 0;
  for (const ch of text) ems += charEm(ch);
  return ems * px;
}

function fitText(text: string, px: number, maxWidth: number): string {
  if (liveCardTextWidth(text, px) <= maxWidth) return text;
  const budget = maxWidth - liveCardTextWidth("…", px);
  const chars = [...text];
  let ems = 0, keep = 0;
  while (keep < chars.length && ems + charEm(chars[keep]) * px <= budget) {
    ems += charEm(chars[keep]) * px;
    keep += 1;
  }
  return `${chars.slice(0, keep).join("").trimEnd()}…`;
}

const HOUR_MS = 3_600_000;
function idleAgo(lastActiveAt: number, now: number): string {
  const ms = Math.max(0, now - lastActiveAt);
  if (ms < 60_000) return "just now";
  if (ms < HOUR_MS) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms <= 48 * HOUR_MS) return `${Math.floor(ms / HOUR_MS)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export function renderLiveCard(view: LiveCardView, now: number): string {
  const tx = view.artwork === null ? X0 : TEXT_X;
  const maxText = RIGHT - tx;
  const title = view.kind === "idle" ? "Offline" : view.title ?? "—";
  const subtitle = view.kind === "idle"
    ? view.lastActiveAt === null ? null : `Last active ${idleAgo(view.lastActiveAt, now)}`
    : view.subtitle;
  const height = view.alsoListening === null ? SHORT_H : TALL_H;
  const titleText = fitText(title, 28, maxText);
  const subtitleText = subtitle === null ? null : fitText(subtitle, 14, maxText);
  const alsoText = view.alsoListening === null ? null
    : fitText(`♪ ${view.alsoListening.title}${view.alsoListening.artist === null ? "" : ` — ${view.alsoListening.artist}`}`, 13, maxText);
  const art = view.artwork === null ? "" :
    `<clipPath id="live-art"><rect x="${X0}" y="${ART_Y}" width="${ART}" height="${ART}" rx="8"/></clipPath>` +
    `<image href="${xml(view.artwork)}" x="${X0}" y="${ART_Y}" width="${ART}" height="${ART}" preserveAspectRatio="xMidYMid slice" clip-path="url(#live-art)"/>` +
    `<rect x="${X0}" y="${ART_Y}" width="${ART}" height="${ART}" rx="8" fill="none" stroke="var(--mute)" stroke-opacity=".3"/>`;
  const deco = view.kind === "coding" ?
    `<text x="${RIGHT}" y="${LABEL_Y}" text-anchor="end" font-family="${MONO}" font-size="13" fill="var(--mute)">&gt;_</text>` : "";
  const aria = view.kind === "idle"
    ? `Offline${subtitleText === null ? "" : ` — ${subtitleText}`}`
    : `${ARIA[view.kind]}: ${titleText}${subtitleText === null ? "" : ` — ${subtitleText}`}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="${X0} 0 ${WIDTH} ${height}" font-family="${FONT}" role="img" aria-label="${xml(aria)}">` +
    STYLE +
    `<text x="${X0}" y="${LABEL_Y}" font-size="13" font-weight="600" letter-spacing="1.5" fill="var(--mute)">${LABELS[view.kind]}</text>` +
    deco + art +
    `<text x="${tx}" y="${TITLE_Y}" font-size="28" font-weight="700" fill="var(--fg)">${xml(titleText)}</text>` +
    (subtitleText === null ? "" : `<text x="${tx}" y="${SUBTITLE_Y}" font-size="14" fill="var(--mute)">${xml(subtitleText)}</text>`) +
    (alsoText === null ? "" : `<text x="${tx}" y="${ALSO_Y}" font-size="13" fill="var(--mute)">${xml(alsoText)}</text>`) +
    "</svg>"
  );
}
