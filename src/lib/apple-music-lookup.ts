
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
    hasLyrics?: boolean;
  };
};

export function normalizeForMatch(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\s　]/g, "")
    .replace(/[-–—_.,'"‘’“”!?()（）\[\]・:：]/g, "");
}

function artistNameMatches(found: string | null | undefined, wanted: string) {
  if (!wanted) return true;
  const have = normalizeForMatch(found);
  return have.includes(wanted) || wanted.includes(have);
}

// 空串是任何专辑名的子串；缺专辑名不能因此算命中。
function albumNameContains(outer: string, inner: string) {
  return inner.length > 0 && outer.includes(inner);
}

function albumRole(name: string | null | undefined): "single" | "ep" | null {
  const n = normalizeForMatch(name);
  if (n.endsWith("single")) return "single";
  if (n.endsWith("ep")) return "ep";
  return null;
}

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

// 搜索排序不能确认曲目身份；同名曲、翻唱和不同专辑版本都需要单独消歧。
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
  const titledByArtist = titleMatches.filter((song) =>
    artistNameMatches(song.attributes?.artistName, wantedArtist),
  );

  const hit = pickAlbum(
    titledByArtist.length > 0 ? titledByArtist : titleMatches,
    wantedAlbum,
    titledByArtist.length > 0,
  );
  if (hit) return hit;

  // 曲名对上的是别人的翻唱（Tower of Flower / Fried Rice），正主在目录里
  // 是另一个名字（花の塔）。艺人对得上再按专辑形态认一次。
  if (!wantedArtist) return undefined;
  const artistMatches = songs.filter((song) =>
    artistNameMatches(song.attributes?.artistName, wantedArtist),
  );
  return pickAlbum(artistMatches, wantedAlbum, true);
}

function pickAlbum(
  candidates: CatalogSong[],
  wantedAlbum: string,
  artistMatched: boolean,
): CatalogSong | undefined {
  if (candidates.length === 0) return undefined;

  if (wantedAlbum) {
    // 先要精确的。设备报的专辑名通常和目录一致（实测 Music.app 给的就是
    // 「HALO - EP」这种完整形式），退化到包含判断只是为了容忍上游把
    // 「- Single」这类后缀截掉的情况 —— 而且只在艺人也对得上时才肯退化
    const exact = candidates.find(
      (song) => normalizeForMatch(song.attributes?.albumName) === wantedAlbum,
    );
    if (exact) return exact;
    if (!artistMatched) return undefined;
    const contained = candidates.find((song) => {
      const found = normalizeForMatch(song.attributes?.albumName);
      return albumNameContains(found, wantedAlbum) || albumNameContains(wantedAlbum, found);
    });
    if (contained) return contained;
    const role = albumRole(wantedAlbum);
    if (!role) return undefined;
    const sameRole = candidates.filter(
      (song) => albumRole(song.attributes?.albumName) === role,
    );
    return sameRole.length === 1 ? sameRole[0] : undefined;
  }

  return artistMatched && candidates.length === 1 ? candidates[0] : undefined;
}
