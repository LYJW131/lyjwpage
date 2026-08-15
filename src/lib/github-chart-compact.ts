/**
 * 把 ghchart 那份 SVG 压到能安心内联进首屏的体积。
 *
 * 原样是 371 个 `<rect>`，每个都自带一份
 * `style="fill:#EEEEEE;shape-rendering:crispedges;"` 和一个没人读的 data-date，
 * 加起来 54 KB。而它是内联在首屏 HTML 里的，RSC 又会把渲染出来的树再序列化一遍
 * 塞进 flight payload —— 实测 275 KB 的首屏文档里有 98 KB 是这一张图，还带来
 * 371 个要过样式和布局的 DOM 节点（主线程 Style & Layout 移动端 1.3s）。
 *
 * 同色的格子合并成一条 `<path>`：5 条路径 + 19 个标签，7 KB，DOM 节点 390 → 24。
 *
 * **不改成 `<img src="/xxx.svg">` 单独请求**：空格子（371 个里占 273 个）的颜色
 * 来自页面 CSS 的 `var(--muted)`，标签颜色和字体同理（见 globals.css 那三条
 * `.github-chart` 规则）。`<img>` 里的 SVG 是独立文档，取不到页面的 CSS 变量，
 * 深色模式下那片空格子会是 ghchart 写死的 #EEEEEE —— 一整片死白。这跟
 * AGENTS.md 里 `fill="currentColor"` 那条坑是同一个道理，只是换了个变量。
 */

/** 一天一个格子。ghchart 的 score 是 0–4 五档，颜色由请求 URL 里的基色推出来。 */
interface Cell {
  score: string;
  fill: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 星期与月份标签。ghchart 只显示 Mon/Wed/Fri，其余几行带 display:none。 */
interface Label {
  x: string;
  y: string;
  fontSize: string;
  hidden: boolean;
  text: string;
}

const SVG_TAG = /<svg\b[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"[^>]*>/i;
const RECT = /<rect\b([^>]*)\/?>/gi;
const TEXT = /<text\b([^>]*)>([^<]*)<\/text>/gi;

function attr(source: string, name: string): string | null {
  const found = new RegExp(`\\b${name}="([^"]*)"`).exec(source);
  return found ? found[1] : null;
}

function styleValue(source: string, property: string): string | null {
  const found = new RegExp(`(?:^|[;"\\s])${property}\\s*:\\s*([^;"]+)`).exec(source);
  return found ? found[1].trim() : null;
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 一格画成一段子路径。矩形都是轴对齐的，`M x y h w v h h-w z` 比 `<rect>` 的
 * 六个属性短得多，四条边按顺时针走完再闭合，填充规则用不上。
 */
function toSubPath({ x, y, w, h }: Cell): string {
  return `M${x} ${y}h${w}v${h}h-${w}z`;
}

/**
 * 压缩后的 SVG；认不出 ghchart 的形状时返回 null，由调用方决定怎么退。
 *
 * 只保留 `data-score`：globals.css 靠它把空格子刷成主题色。`data-date` 全站没人
 * 读，扔掉。`fill` 留着 —— 空格子那条会被 CSS 的 !important 盖掉，其余四档要靠它。
 */
export function compactGithubChartSvg(raw: string): string | null {
  const tag = SVG_TAG.exec(raw);
  if (!tag) return null;
  const [, width, height] = tag;

  const cells: Cell[] = [];
  for (const [, attrs] of raw.matchAll(RECT)) {
    const fill = styleValue(attrs, "fill") ?? attr(attrs, "fill");
    const score = attr(attrs, "data-score");
    const x = attr(attrs, "x");
    const y = attr(attrs, "y");
    const w = attr(attrs, "width");
    const h = attr(attrs, "height");
    if (!fill || !score || !x || !y || !w || !h) return null;
    cells.push({ score, fill, x: Number(x), y: Number(y), w: Number(w), h: Number(h) });
  }
  if (!cells.length) return null;

  const labels: Label[] = [];
  for (const [, attrs, text] of raw.matchAll(TEXT)) {
    const x = attr(attrs, "x");
    const y = attr(attrs, "y");
    if (!x || !y) return null;
    labels.push({
      x,
      y,
      // 星期标签 9px、月份标签 10px，两种字号都得留着
      fontSize: styleValue(attrs, "font-size") ?? "10px",
      hidden: styleValue(attrs, "display") === "none",
      text,
    });
  }

  /**
   * 按「档位 + 颜色」分组。同一档正常只有一种颜色，拿颜色一起做键是为了
   * ghchart 哪天改了调色板也不会把两种颜色合进一条路径里。
   */
  const groups = new Map<string, { score: string; fill: string; cells: Cell[] }>();
  for (const cell of cells) {
    const key = `${cell.score} ${cell.fill}`;
    const group = groups.get(key) ?? { score: cell.score, fill: cell.fill, cells: [] };
    group.cells.push(cell);
    groups.set(key, group);
  }

  const paths = [...groups.values()].map(
    (group) =>
      `<path data-score="${group.score}" fill="${group.fill}" d="${group.cells
        .map(toSubPath)
        .join("")}"/>`,
  );

  /**
   * 标签只留 CSS 盖不掉的那部分：`fill` 和 `font-family` 在 globals.css 里是
   * !important，内联写了也是死的；`text-anchor:start` 是初始值；`white-space`
   * 对 SVG 文本无意义。剩下字号和 display 得逐个保留。
   */
  const texts = labels.map(
    (label) =>
      `<text x="${label.x}" y="${label.y}" font-size="${label.fontSize}"${
        label.hidden ? ' display="none"' : ""
      }>${escapeText(label.text)}</text>`,
  );

  /**
   * 不写 width / height：卡片宽度由 globals.css 的 `.github-chart svg` 给，
   * 有 viewBox 就能自己按比例定高。原来那份是靠改写补 `height="auto"` ——
   * SVG 的 height 属性只收长度值，浏览器控制台会报
   * `<svg> attribute height: Expected length, "auto"`。
   */
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">${paths.join(
    "",
  )}${texts.join("")}</svg>`;
}

/**
 * 压不动时的退路：原样用，只把缺的 viewBox 补上，让它还能跟着卡片缩放。
 * 宁可多几十 KB，也好过整张图不显示。
 */
export function withViewBox(raw: string): string {
  if (raw.includes("viewBox")) return raw;
  return raw.replace(
    /<svg\s+([^>]*?)width="(\d+)"\s+height="(\d+)"([^>]*)>/i,
    (_, before, w, h, after) => `<svg ${before}viewBox="0 0 ${w} ${h}"${after}>`,
  );
}
