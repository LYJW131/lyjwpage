import assert from "node:assert/strict";
import test from "node:test";

import { catalogSearchTerms, pickCatalogHit } from "./apple-music-lookup.ts";

function song(name: string, artistName: string, albumName: string, id = name) {
  return { id, attributes: { name, artistName, albumName, url: `https://music.apple.com/${id}` } };
}

test("第一枪带艺人，搜空了才去掉艺人", () => {
  const album = 'Song from Tv Series "【Oshi No Ko】 " Vol.5';
  const artist =
    "B KOMACHI RUBY(CV: YURIE IGOMA), ARIMA KANA(CV: MEGUMI HAN), MEMCHO (CV: RUMI OKUBO)";
  const terms = catalogSearchTerms("Revenge of B", artist, album);
  assert.deepEqual(terms, [
    `Revenge of B ${artist} ${album}`,
    `Revenge of B ${album}`,
    "Revenge of B",
  ]);
});

test("没有艺人时不叠出空档，专辑和曲名一样只留曲名", () => {
  assert.deepEqual(catalogSearchTerms("One Last Kiss", null, "One Last Kiss"), [
    "One Last Kiss",
  ]);
  assert.deepEqual(
    catalogSearchTerms("One Last Kiss", "宇多田ヒカル", "One Last Kiss"),
    ["One Last Kiss 宇多田ヒカル One Last Kiss", "One Last Kiss"],
  );
});

test("艺人对不上就退回曲名 + 专辑：宇多田ヒカル vs Utada", () => {
  const hit = pickCatalogHit(
    [
      song("One Last Kiss", "Utada", "One Last Kiss", "utada"),
      song("One Last Kiss", "Kylie Minogue", "Golden", "kylie"),
    ],
    { title: "One Last Kiss", artist: "宇多田ヒカル", album: "One Last Kiss" },
  );
  assert.equal(hit?.id, "utada");
});

test("角色歌艺人署名再长，曲名专辑对得上就能认", () => {
  const hit = pickCatalogHit(
    [
      song(
        "Revenge of B",
        "B KOMACHI RUBY(CV: YURIE IGOMA), ARIMA KANA(CV: MEGUMI HAN), MEMCHO (CV: RUMI OKUBO)",
        'Song from Tv Series "【Oshi No Ko】 " Vol.5',
        "revenge",
      ),
      song(
        "Revenge of B (Instrumental)",
        "B KOMACHI RUBY(CV: YURIE IGOMA), ARIMA KANA(CV: MEGUMI HAN), MEMCHO (CV: RUMI OKUBO)",
        'Song from Tv Series "【Oshi No Ko】 " Vol.5',
        "inst",
      ),
    ],
    {
      title: "Revenge of B",
      artist:
        "B KOMACHI RUBY(CV: YURIE IGOMA), ARIMA KANA(CV: MEGUMI HAN), MEMCHO (CV: RUMI OKUBO)",
      album: 'Song from Tv Series "【Oshi No Ko】 " Vol.5',
    },
  );
  assert.equal(hit?.id, "revenge");
});

test("同名曲靠专辑消歧，不取排序第一", () => {
  const hit = pickCatalogHit(
    [
      song("ミッドナイト・リフレクション", "NOMELON NOLEMON", "ミッドナイト・リフレクション - Single", "single"),
      song("ミッドナイト・リフレクション", "NOMELON NOLEMON", "HALO - EP", "halo"),
      song("ミッドナイト・リフレクション", "NOMELON NOLEMON", "EYE", "eye"),
    ],
    {
      title: "ミッドナイト・リフレクション",
      artist: "NOMELON NOLEMON",
      album: "HALO - EP",
    },
  );
  assert.equal(hit?.id, "halo");
});

test("艺人对不上且专辑也对不上，不因为只剩一条就认", () => {
  const hit = pickCatalogHit(
    [song("One Last Kiss", "Utada", "SCIENCE FICTION", "sf")],
    { title: "One Last Kiss", artist: "宇多田ヒカル", album: "One Last Kiss - Single" },
  );
  assert.equal(hit, undefined);
});
