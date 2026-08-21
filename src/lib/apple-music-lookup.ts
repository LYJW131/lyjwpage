/**
 * 目录搜索词和结果校验。纯函数，不碰网络。
 *
 * 搜和认是两步：第一枪仍带艺人，对不上（0 条、或校验挑不中）才去掉艺人再搜。
 * 校验自己也有艺人回退 —— One Last Kiss 那种「宇多田ヒカル vs Utada」。
 */

export type CatalogSong = {
  id?: string;
  relationships?: {
    albums?: { data?: Array<{ id?: string }> };
  };
  attributes?: {
    name?: string;
    artistName?: string;
    albumName?: string;
    url?: string;
    artwork?: { url?: string };
  };
};

/** 归一化后再比：大小写、空格、常见标点、全角半角差异都不该影响判定 */
export function normalizeForMatch(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\s　]/g, "")
    .replace(/[-–—_.,'"‘’“”!?()（）\[\]・:：]/g, "");
}

/**
 * 目录搜索词，按从带到不带艺人排。
 *
 * 第一枪仍是「曲名 + 艺人 + 专辑」：Moonshot 这种短曲名靠艺人把对的那首
 * 送进 25 条。这一枪标题一对不上（角色歌那串 `(CV: …)` 署名会让中国区
 * 目录 0 条，实测 Revenge of B）才去掉艺人，改搜「曲名 + 专辑」、再不行
 * 只搜曲名。校验阶段本来就会在艺人对不上时退回专辑；搜索这边同一条路，
 * 只是失败才走，不是一开始就不带艺人。
 */
export function catalogSearchTerms(
  title: string,
  artist: string | null | undefined,
  album: string | null | undefined,
): string[] {
  const name = title.trim();
  if (!name) return [];
  const artistName = artist?.trim() ?? "";
  const albumName = album?.trim() ?? "";
  const terms: string[] = [];
  const seen = new Set<string>();
  const push = (parts: Array<string | null | undefined>) => {
    const term = parts.filter((part): part is string => Boolean(part?.trim())).join(" ");
    if (!term || seen.has(term)) return;
    seen.add(term);
    terms.push(term);
  };

  if (artistName) push([name, artistName, albumName || null]);
  if (albumName && normalizeForMatch(albumName) !== normalizeForMatch(name)) {
    push([name, albumName]);
  }
  push([name]);
  return terms;
}

/**
 * 从搜索结果里挑那一首。排序不算数，必须过「曲名 + 艺人 + 专辑」校验：
 *
 * - 只看排序不行：即使限定了 types=songs，相关度最高的也可能不是同名曲。
 *   实测搜「Moonshot / Hoshimachi Suisei」，排第一的是同一歌手的另一首
 *   《Suisei (Nor ver.)》—— 艺人名和歌名撞了。
 * - 只看曲名 + 艺人也不行：同一首歌常同时收录在单曲、EP 和精选里。实测
 *   《ミッドナイト・リフレクション / NOMELON NOLEMON》在「- Single」「HALO - EP」
 *   「EYE」三张专辑下各有一条，链接完全不同。
 *
 * 艺人名对不上时退回「曲名 + 专辑」。目录里的艺人名和设备报的常常不是一种
 * 写法：实测 Music.app 报「宇多田ヒカル」，目录里写的是「Utada」，两边毫无
 * 字面交集。少了艺人这层身份，专辑那层就卡严：只认完全相等，不再退化到包含
 * 判断，也不接受「只有一个候选就认」。
 */
export function pickCatalogHit(
  songs: CatalogSong[],
  track: { title: string; artist: string | null; album: string | null },
): CatalogSong | undefined {
  const wantedTitle = normalizeForMatch(track.title);
  const wantedArtist = normalizeForMatch(track.artist);
  const wantedAlbum = normalizeForMatch(track.album);

  const titleMatches = songs.filter(
    (song) => normalizeForMatch(song.attributes?.name) === wantedTitle,
  );
  const byArtist = titleMatches.filter((song) => {
    if (!wantedArtist) return true;
    const found = normalizeForMatch(song.attributes?.artistName);
    // 「艺人 A feat. B」这类两边互为子串，双向包含都算对得上
    return found.includes(wantedArtist) || wantedArtist.includes(found);
  });

  const artistMatched = byArtist.length > 0;
  const candidates = artistMatched ? byArtist : titleMatches;

  if (wantedAlbum) {
    // 先要精确的。设备报的专辑名通常和目录一致（实测 Music.app 给的就是
    // 「HALO - EP」这种完整形式），退化到包含判断只是为了容忍上游把
    // 「- Single」这类后缀截掉的情况 —— 而且只在艺人也对得上时才肯退化
    return (
      candidates.find(
        (song) => normalizeForMatch(song.attributes?.albumName) === wantedAlbum,
      ) ??
      (artistMatched
        ? candidates.find((song) => {
            const found = normalizeForMatch(song.attributes?.albumName);
            return found.includes(wantedAlbum) || wantedAlbum.includes(found);
          })
        : undefined)
    );
  }

  // 没有专辑名就没法消歧：只有候选唯一、且艺人也对得上时才敢认
  return artistMatched && candidates.length === 1 ? candidates[0] : undefined;
}
