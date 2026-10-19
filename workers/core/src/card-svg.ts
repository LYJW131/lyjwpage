import { AwaitingReport } from "@shared/awaiting-report";

// GitHub README 的图片经 camo 代理，camo 按这个头缓存；数字按天变，十分钟足够新，又不让每次浏览都唤醒 StateHub。
export const CARD_CACHE_CONTROL = "public, max-age=600, stale-while-revalidate=3600";
const CARD_FAILED_CACHE_CONTROL = "public, max-age=60";

export const CARD_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
export const CARD_MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
// 周卡与 Voronoi 卡的统计列共用一套网格（x = 28、218、408、598），两张卡在 README 里上下对齐。
export const CARD_X0 = 28;
export const CARD_STAT_PITCH = 190;

export function cardStyle(light = "", dark = ""): string {
  return `<style>:root{--bg:#ffffff;--fg:#1f2328;--mute:#656d76${light}}` +
    `@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--mute:#8b949e${dark}}}</style>`;
}

export function cardStat(column: number, label: string, value: string): string {
  const x = CARD_X0 + column * CARD_STAT_PITCH;
  return `<text x="${x}" y="34" font-size="13" font-weight="600" letter-spacing="1.5" fill="var(--mute)">${label}</text>` +
    `<text x="${x}" y="76" font-size="34" font-weight="700" fill="var(--fg)">${value}</text>`;
}

export function formatTokens(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return String(Math.round(value));
}

export async function cardResponse(name: string, render: () => Promise<string>): Promise<Response> {
  try {
    const svg = await render();
    return new Response(svg, {
      headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": CARD_CACHE_CONTROL },
    });
  } catch (error) {
    if (error instanceof AwaitingReport) console.warn(`[${name}]`, error.message);
    else console.error(`[${name}]`, error instanceof Error ? (error.stack ?? error.message) : String(error));
    return new Response("Card unavailable", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": CARD_FAILED_CACHE_CONTROL },
    });
  }
}
