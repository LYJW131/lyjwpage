import cardsCss from "./readme-cards.css?inline";

// 首页在 1280 视口下的内容宽（max-w-5xl）；宽度断点按内容宽定死成桌面布局。
export const FULL_WIDTH = 1024;
// 硬阴影向右下偏移，画布留出这一圈。
const SHADOW_PAD = 4;

export type Theme = "light" | "dark";
export type CardFrame = {
  label: string;
  width: number;
  height: number;
  // 并排的半卡：README 里两张图各占一半、中间不留空，左卡右侧补卡间距，右卡左侧补，右缘与整卡对齐。
  pair?: "left" | "right";
};

// 图片里的媒体查询按图片显示宽度算，README 把卡缩到正文宽就会掉进窄屏布局、超出写死的高度；按 FULL_WIDTH 定死断点。
const freezeWidthQueries = (css: string) =>
  css.replace(/@media\s*(not all and\s*)?\(width\s*>=\s*([\d.]+)(px|rem)\)\s*{/g, (_, not, size, unit) => {
    const matches = Number(size) * (unit === "rem" ? 16 : 1) <= FULL_WIDTH;
    return `@media ${matches === !not ? "all" : "not all"}{`;
  });

// 不内嵌字体：camo 回图带 CSP `default-src 'none'`，data: 字体照样被拦，经 GitHub 看到的总是系统等宽字体。
const CSS = freezeWidthQueries(cardsCss.replace(/@font-face\s*{[^}]*}/g, "")) +
  // 奖杯展开面板的高度在浏览器里量出来再动画过去，SSR 时是 0。
  "#playstation-trophies{height:auto!important}" +
  // 勿扰图标在浏览器里挂载后才上色，静态图直接画上色后的样子。
  ".focus-icon .tint{opacity:1}" +
  // 热力图切换挂在 <html data-heatmap> 上，图片里没有 <html>，按首页默认画 Tokens 那一面。
  '.heatmap-panel[data-heatmap-panel="tokens"]{display:block!important}' +
  '.heatmap-tab[data-heatmap-tab="tokens"]{background-color:var(--muted)!important;color:var(--foreground)!important}';

// NumberFlow 的数字在声明式 Shadow DOM 里，XML 文档不解析 <template shadowrootmode>；去掉模板，留下它给的纯文本读数与配套样式。
export const flattenNumberFlow = (html: string) => html.replace(/<template\b[^>]*\sshadowrootmode="open"[^>]*>[\s\S]*?<\/template\s*>/g, "");

// HTML 解析器自己认 <svg>，XML 里不写 xmlns 的 <svg> 落进 XHTML 命名空间，图标与图表就整个不画。
export const svgNamespaces = (html: string) => html.replace(/<svg\b(?![^>]*\sxmlns=)/g, '<svg xmlns="http://www.w3.org/2000/svg"');

const canvasSize = (card: CardFrame) => ({
  width: card.pair ? (FULL_WIDTH + SHADOW_PAD) / 2 : card.width + SHADOW_PAD,
  fullHeight: card.height + SHADOW_PAD,
});

// 没有卡头的卡（每日摘要）把说明放在右上角，分两行避开表盘。
export function svgDocument(body: string, card: CardFrame, theme: Theme, cornerNote: string | null): string {
  const { label, height } = card;
  const { width, fullHeight } = canvasSize(card);
  const offset = card.pair === "right" ? width - card.width - SHADOW_PAD : 0;
  return (
    // 暗色类挂在 <svg> 上：它是图片里的 :root，`--color-*: var(--*)` 这类别名在 :root 上求值，挂在内层就仍取亮色。
    `<svg xmlns="http://www.w3.org/2000/svg"${theme === "dark" ? ' class="dark"' : ""} width="${width}" height="${fullHeight}" viewBox="0 0 ${width} ${fullHeight}" role="img" aria-label="${label}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${fullHeight}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" class="font-mono text-foreground antialiased" style="position:relative;left:${offset}px;width:${card.width}px;height:${height}px;display:flex;flex-direction:column">` +
    `<style><![CDATA[${CSS}]]></style>` +
    `<div style="position:relative;flex:1;display:flex;flex-direction:column">${body}${cornerNote ? `<div class="label-mono text-muted-foreground" style="position:absolute;right:1.25rem;top:1rem;text-align:right">${cornerNote}</div>` : ""}</div>` +
    `</div></foreignObject></svg>`
  );
}

// WebKit（iOS 的 GitHub App 与 Safari）缩小显示含 foreignObject 的 SVG 时，HTML 仍按原尺寸画、超出部分裁掉；
// 整张卡作为 <image> 套一层，内层按原尺寸渲染，缩放只落在外层图片上。
// WebKit 把显示高度取整后按 meet 等比放进去，矮卡（勿扰）的取整误差占比大，左右就缩进一截；preserveAspectRatio="none" 让它铺满盒子。
export function scalableSvg(inner: string, card: CardFrame): string {
  const { width, fullHeight } = canvasSize(card);
  const href = `data:image/svg+xml;base64,${Buffer.from(inner).toString("base64")}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${fullHeight}" viewBox="0 0 ${width} ${fullHeight}" preserveAspectRatio="none" role="img" aria-label="${card.label}">` +
    `<image width="${width}" height="${fullHeight}" href="${href}"/></svg>`
  );
}
