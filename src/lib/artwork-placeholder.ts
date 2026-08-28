import { cacheLife } from "next/cache";
import sharp from "sharp";

import { appleArtwork } from "@/lib/apple-artwork";

/**
 * 首屏封面的低清占位图。
 *
 * 卡片上那几张封面是 Apple CDN 直连的，HTML 先到、图后到，首帧那几格是空的。
 * 这里在服务端按展示尺寸压一张**很小**的 webp 塞进 HTML，由消费方铺成一张
 * `decoding="sync"` 的垫底 `<Image>`，压在真图下层。
 *
 * **不要改回 `next/image` 的 `placeholder` 属性**：那条路把 data URI 变成 CSS
 * 背景图，而背景图没有 `decoding` 可控 —— 移动端水合期解码会滑过首帧一两拍，
 * 露出底下的 `bg-muted`。走过一轮又退回来了，见 hero-motion-artwork 的注释。
 * 真图的 `src` 和加载时序始终一个字节都没改，垫底图只是排在它前面的一层。
 *
 * 分辨率和质量按档分开定（见下面两个常量和 `QUALITY_BY_PX`）：hero 取 1×、
 * 列表行取 2×。列表那档撑得起字节，是因为它顶的时间最长 —— 真图是 lazy。
 */

/**
 * hero 取 1× —— 它的真图是 eager，占位露脸时间短，糊一点没人看得见。
 */
export const HERO_PLACEHOLDER_PX = 80;

/**
 * 列表行取 **2×**（44 CSS px × 2）。
 *
 * 曾经和 hero 一样取 1×，实测在 2~3 倍屏的手机上等效糊化，真图换上来时反差
 * 明显 —— 行的真图是 lazy，占位要顶很久，糊就藏不住。这一档是全站占位字节的
 * 大头（8 行），提到 2× 是**明确拿字节换观感**的决定，见下面的质量表。
 */
export const ROW_PLACEHOLDER_PX = 88;

/**
 * 每档的输出质量，键就是那一档的 px。
 *
 * **别再写成按大小比较派生**：列表档提到 88 之后比 hero 的 80 还大，从前那句
 * `px >= HERO_PLACEHOLDER_PX ? 50 : 45` 会把它判进 hero 档，悄没声地降质。
 * 显式列表，加档时一眼看得见。
 *
 * 列表档给到 60 是因为**这一档的字节几乎不由质量决定**：实测 88px 上
 * q50 → q65 合计只差 9%（12.3KB → 13.4KB），像素数才是大头。既然涨质量近乎
 * 免费，就别在这儿省 —— 糊正是要修的那个问题。
 */
const QUALITY_BY_PX: Record<number, number> = {
  [HERO_PLACEHOLDER_PX]: 50,
  [ROW_PLACEHOLDER_PX]: 60,
};

/**
 * 按模板 URL + 尺寸压一张，结果永久留用。
 *
 * 缓存键是（模板 URL, px）：Apple 目录里同一张封面的模板 URL 是稳定的，
 * 同样的键必然是同一张图，所以 `cacheLife("max")`，全站压一次。
 *
 * 只认 mzstatic：判主机名而不是找子串，理由和 `needsOptimizing` 那边一样。
 * 自建歌单封面（blobstore 预签名）**故意**挡在外面 —— 那种 URL 带
 * `X-Amz-*`，每次签出来都不一样，拿它当缓存键等于每次都重压一张。
 *
 * 失败一律返回 null，调用方那一格就不铺垫底图，等于内联之前的行为。
 * null 同样会被缓存住：与另外两处内联同一取舍，免得每次页面重新生成都再赌
 * 一次超时。
 */
async function encodePlaceholder(
  templateUrl: string,
  px: number,
): Promise<ArtworkDataUri | null> {
  "use cache";
  cacheLife("max");

  try {
    let host: string;
    try {
      host = new URL(templateUrl).hostname;
    } catch {
      return null;
    }
    if (!host.endsWith(".mzstatic.com")) return null;

    // 直接向 CDN 要展示尺寸那一档，别下 240px 的再自己缩
    const url = appleArtwork(templateUrl, px);
    if (!url) return null;

    const res = await fetch(url, {
      cache: "force-cache",
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: "image/*" },
    });
    if (!res.ok) throw new Error(`Apple 封面 HTTP ${res.status}`);

    // 查表而不是当参数传：缓存键因此仍只有 URL 和尺寸两项
    const quality = QUALITY_BY_PX[px] ?? 50;
    const webp = await sharp(new Uint8Array(await res.arrayBuffer()))
      .resize(px, px, { fit: "cover" })
      .webp({ quality })
      .toBuffer();

    return `data:image/webp;base64,${webp.toString("base64")}`;
  } catch (error) {
    console.error(
      "[artwork-placeholder] 压制失败，该格无占位",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

/**
 * 带形状的 data URI，别退回裸 `string`。
 *
 * 一是它能在类型上挡住「把远端 URL 误传进垫底图」这类接错线；二是万一哪天
 * 又要喂给 `next/image` 的 `placeholder`（那个 prop 只收
 * `'blur' | 'empty' | \`data:image/${string}\``），不必在中间几层加强转。
 */
export type ArtworkDataUri = `data:image/${string}`;

/** 组件按数据里那个原始模板 URL 查表，不必自己再算一遍 `appleArtwork`。 */
export type ArtworkPlaceholders = {
  /** hero 那一格，80px */
  hero: Record<string, ArtworkDataUri>;
  /** 列表行，88px（44 CSS px 的 2×） */
  rows: Record<string, ArtworkDataUri>;
};

/**
 * 把一批模板 URL 压成「URL → data URI」的表。
 *
 * 逐个 `encodePlaceholder` 都不会 reject（失败返回 null），所以 `Promise.all`
 * 不会被一张坏图拖垮；压不出来的那张干脆不进表，组件查不到就不铺垫底图。
 */
async function encodeAll(
  urls: Iterable<string>,
  px: number,
): Promise<Record<string, ArtworkDataUri>> {
  const unique = [...new Set([...urls].filter(Boolean))];
  const encoded = await Promise.all(unique.map((url) => encodePlaceholder(url, px)));

  const table: Record<string, ArtworkDataUri> = {};
  unique.forEach((url, i) => {
    const placeholder = encoded[i];
    if (placeholder) table[url] = placeholder;
  });
  return table;
}

/**
 * 首屏这一份 HTML 要覆盖的封面全集。
 *
 * **别按「移动端能看见 5 张」裁**：SSR 出的是设备无关的一份 HTML，断点靠 CSS，
 * 桌面端无充电卡时列表是 4×2 共 8 行。所以列表那批把信封里的条目全压上
 * （上游最多 10 条）。
 *
 * hero 只可能是两者之一 —— 本机在放的那首（nowListening），或者列表头一条
 * （见 listening-card 的 `hero`），所以 80px 那档只压这两张，不是每条都压。
 */
export async function artworkPlaceholders(
  itemArtworks: (string | null | undefined)[],
  nowListeningArtwork: string | null | undefined,
): Promise<ArtworkPlaceholders> {
  const rows = itemArtworks.filter((url): url is string => Boolean(url));
  const heroes = [nowListeningArtwork, rows[0]].filter((url): url is string => Boolean(url));

  const [hero, rowTable] = await Promise.all([
    encodeAll(heroes, HERO_PLACEHOLDER_PX),
    encodeAll(rows, ROW_PLACEHOLDER_PX),
  ]);
  return { hero, rows: rowTable };
}
