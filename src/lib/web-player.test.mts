import assert from "node:assert/strict";
import test from "node:test";

import {
  catalogTracksPathFor,
  clearPlaylistCache,
  computePlaylistHeight,
  filterUserQueueItems,
  formatClock,
  getCachedPlaylist,
  getMusicAuthServerSnapshot,
  getMusicAuthSnapshot,
  hasPersistedMusicUserToken,
  PLAYLIST_EXTRA_HEIGHT_PX,
  PLAYLIST_MAX_HEIGHT_PX,
  PLAYLIST_PADDING_Y_PX,
  PLAYLIST_MAX_VISIBLE_ROWS,
  PLAYLIST_ROW_HEIGHT_PX,
  playlistScrollportHeight,
  queueOptionsFor,
  resetMusicAuthStateForTesting,
  resolveVisibleQueue,
  setCachedPlaylist,
  setMusicAuthSnapshot,
  subscribeMusicAuth,
} from "./web-player.ts";

test("queueOptionsFor: 专辑链接且提供 id", () => {
  assert.deepEqual(
    queueOptionsFor({
      id: "1783644603",
      link: "https://music.apple.com/cn/album/%E8%BF%B7%E8%B7%A1%E6%B3%A2/1783644603",
    }),
    { album: "1783644603" },
  );
});

test("queueOptionsFor: 歌单链接且提供 id", () => {
  assert.deepEqual(
    queueOptionsFor({
      id: "pl.u-11zBXDbf8kVGdjb",
      link: "https://music.apple.com/cn/playlist/pl.u-11zBXDbf8kVGdjb",
    }),
    { playlist: "pl.u-11zBXDbf8kVGdjb" },
  );
});

test("queueOptionsFor: 电台链接且 id 为空串，退回链接末段", () => {
  assert.deepEqual(
    queueOptionsFor({
      id: "",
      link: "https://music.apple.com/cn/station/ra.123",
    }),
    { station: "ra.123" },
  );
});

test("queueOptionsFor: 认不出种类的链接，退回原始 url", () => {
  const link = "https://music.apple.com/cn/artist/foo/1";
  assert.deepEqual(queueOptionsFor({ id: "1", link }), { url: link });
});

test("queueOptionsFor: link 为 null 或非法 URL 时返回 null", () => {
  assert.equal(queueOptionsFor({ id: "123", link: null }), null);
  assert.equal(queueOptionsFor({ id: "123", link: "not a url" }), null);
});

test("formatClock: 包含零、负数以及时分秒各档位", () => {
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(-1_000), "0:00");
  assert.equal(formatClock(83_000), "1:23");
  assert.equal(formatClock(3_723_000), "1:02:03");
});

test("resolveVisibleQueue: 仅当已装载专辑与当前专辑 ID 一致时保留列表", () => {
  const songs = [{ id: "song-1" }, { id: "song-2" }];
  assert.deepEqual(resolveVisibleQueue("album-1", "album-1", songs), songs);

  assert.deepEqual(resolveVisibleQueue("album-1", "album-2", songs), []);

  assert.deepEqual(resolveVisibleQueue(null, "album-1", songs), []);
  assert.deepEqual(resolveVisibleQueue(undefined, "album-1", songs), []);

  assert.deepEqual(resolveVisibleQueue("album-1", null, songs), []);
});

test("computePlaylistHeight: 曲目高度按每行 32px 加上内边距与边框，且不超过 237px", () => {
  assert.equal(PLAYLIST_EXTRA_HEIGHT_PX, PLAYLIST_PADDING_Y_PX + 1);
  assert.equal(computePlaylistHeight(0), 0);
  assert.equal(computePlaylistHeight(-5), 0);
  assert.equal(computePlaylistHeight(1), 1 * PLAYLIST_ROW_HEIGHT_PX + PLAYLIST_EXTRA_HEIGHT_PX);
  assert.equal(computePlaylistHeight(3), 3 * PLAYLIST_ROW_HEIGHT_PX + PLAYLIST_EXTRA_HEIGHT_PX);
  assert.equal(computePlaylistHeight(6), 6 * PLAYLIST_ROW_HEIGHT_PX + PLAYLIST_EXTRA_HEIGHT_PX);
  assert.equal(computePlaylistHeight(7), PLAYLIST_MAX_HEIGHT_PX);
  assert.equal(computePlaylistHeight(15), PLAYLIST_MAX_HEIGHT_PX);
  assert.equal(computePlaylistHeight(30), PLAYLIST_MAX_HEIGHT_PX);
});

test("playlistScrollportHeight: 滚动口是整行的整数倍，内边距和边框留在外面", () => {
  assert.equal(playlistScrollportHeight(0), 0);
  assert.equal(playlistScrollportHeight(-5), 0);
  assert.equal(playlistScrollportHeight(1), PLAYLIST_ROW_HEIGHT_PX);
  assert.equal(playlistScrollportHeight(6), 6 * PLAYLIST_ROW_HEIGHT_PX);
  assert.equal(playlistScrollportHeight(6) % PLAYLIST_ROW_HEIGHT_PX, 0);
  assert.equal(playlistScrollportHeight(15), PLAYLIST_MAX_VISIBLE_ROWS * PLAYLIST_ROW_HEIGHT_PX);
  assert.equal(computePlaylistHeight(6), playlistScrollportHeight(6) + PLAYLIST_EXTRA_HEIGHT_PX);
  assert.equal(PLAYLIST_MAX_HEIGHT_PX, playlistScrollportHeight(7) + PLAYLIST_EXTRA_HEIGHT_PX);
});

test("playlistCache: 设置与获取缓存，清空后恢复未命中", () => {
  clearPlaylistCache();
  assert.equal(getCachedPlaylist("album-x"), undefined);

  const mockQueue = [{ id: "song-a" }, { id: "song-b" }] as never;
  setCachedPlaylist("album-x", mockQueue);
  assert.deepEqual(getCachedPlaylist("album-x"), mockQueue);

  setCachedPlaylist("", mockQueue);
  assert.equal(getCachedPlaylist(""), undefined);
  setCachedPlaylist("album-y", []);
  assert.equal(getCachedPlaylist("album-y"), undefined);

  clearPlaylistCache();
  assert.equal(getCachedPlaylist("album-x"), undefined);
});

test("catalogTracksPathFor: 专辑与歌单链接解析正确，电台与未知链接返回 null", () => {
  assert.equal(
    catalogTracksPathFor({
      id: "1783644603",
      link: "https://music.apple.com/cn/album/%E8%BF%B7%E8%B7%A1%E6%B3%A2/1783644603",
    }),
    "/v1/catalog/cn/albums/1783644603/tracks",
  );

  assert.equal(
    catalogTracksPathFor({
      id: "pl.u-11zBXDbf8kVGdjb",
      link: "https://music.apple.com/cn/playlist/pl.u-11zBXDbf8kVGdjb",
    }),
    "/v1/catalog/cn/playlists/pl.u-11zBXDbf8kVGdjb/tracks",
  );

  assert.equal(
    catalogTracksPathFor({
      id: "pl.u-11zBXDbf8kVGdjb",
      link: "https://music.apple.com/cn/playlist/my-cool-list/pl.u-11zBXDbf8kVGdjb",
    }),
    "/v1/catalog/cn/playlists/pl.u-11zBXDbf8kVGdjb/tracks",
  );

  assert.equal(
    catalogTracksPathFor({
      id: "12345",
      link: "https://music.apple.com/us/album/foo/12345",
    }),
    "/v1/catalog/us/albums/12345/tracks",
  );

  assert.equal(
    catalogTracksPathFor({
      id: "ra.123",
      link: "https://music.apple.com/cn/station/ra.123",
    }),
    null,
  );

  assert.equal(catalogTracksPathFor({ id: "123", link: null }), null);
  assert.equal(catalogTracksPathFor({ id: "123", link: "not a url" }), null);
});

test("hasPersistedMusicUserToken: 检查 localStorage 中是否存在 MusicKit 用户令牌", () => {
  assert.equal(hasPersistedMusicUserToken(), false);

  const store = new Map<string, string>();
  const mockStorage = {
    get length() {
      return store.size;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    clear() {
      store.clear();
    },
  };

  // @ts-expect-error mock global window
  globalThis.window = { localStorage: mockStorage };

  try {
    assert.equal(hasPersistedMusicUserToken(), false);

    mockStorage.setItem("theme", "dark");
    mockStorage.setItem("local-charging-armed", "1");
    assert.equal(hasPersistedMusicUserToken(), false);

    mockStorage.setItem("music.s", "cn");
    mockStorage.setItem("music.c", "true");
    assert.equal(hasPersistedMusicUserToken(), false);

    mockStorage.setItem("music.u", "r.AwAAtestLongMusicUserToken1234567890abcdef");
    assert.equal(hasPersistedMusicUserToken(), true);

    mockStorage.clear();
    assert.equal(hasPersistedMusicUserToken(), false);

    mockStorage.setItem(
      "music.eyJhbGci.musicUserToken",
      "r.AwAAtestLongMusicUserToken1234567890abcdef",
    );
    assert.equal(hasPersistedMusicUserToken(), true);
  } finally {
    // @ts-expect-error clean up global window
    delete globalThis.window;
  }
});

test("getMusicAuthSnapshot & setMusicAuthSnapshot: 快照获取、覆盖更新与订阅派发", () => {
  resetMusicAuthStateForTesting();
  assert.equal(getMusicAuthServerSnapshot(), false);

  assert.equal(getMusicAuthSnapshot(), false);

  let notifiedCount = 0;
  const unsubscribe = subscribeMusicAuth(() => {
    notifiedCount++;
  });

  setMusicAuthSnapshot(true);
  assert.equal(getMusicAuthSnapshot(), true);
  assert.equal(notifiedCount, 1);

  setMusicAuthSnapshot(true);
  assert.equal(notifiedCount, 1);

  setMusicAuthSnapshot(false);
  assert.equal(getMusicAuthSnapshot(), false);
  assert.equal(notifiedCount, 2);

  unsubscribe();
  setMusicAuthSnapshot(true);
  assert.equal(notifiedCount, 2);

  resetMusicAuthStateForTesting();
});

test("filterUserQueueItems: 过滤 MusicKit 实例中的 Autoplay 自动推荐曲目，只保留用户专辑真实曲目", () => {
  assert.deepEqual(filterUserQueueItems(null), []);
  assert.deepEqual(filterUserQueueItems(undefined), []);
  assert.deepEqual(filterUserQueueItems({} as never), []);
  assert.deepEqual(filterUserQueueItems({ queue: {} } as never), []);

  const albumSong = { id: "song-1", attributes: { name: "Yoru No Pierrot" } };
  const autoplaySong1 = {
    id: "auto-1",
    attributes: { name: "Flashbacker" },
    isAutoplay: true,
  };
  const autoplaySong2 = {
    id: "auto-2",
    attributes: { name: "Kamisama Baka" },
    isAutoplay: true,
  };

  const instWithUserAdded = {
    queue: {
      userAddedItems: [albumSong],
      items: [albumSong, autoplaySong1, autoplaySong2],
    },
  } as never;
  assert.deepEqual(filterUserQueueItems(instWithUserAdded), [albumSong]);

  const instWithMixedItems = {
    queue: {
      items: [albumSong, autoplaySong1, autoplaySong2],
    },
  } as never;
  assert.deepEqual(filterUserQueueItems(instWithMixedItems), [albumSong]);

  const instWithAllAutoplay = {
    queue: {
      items: [autoplaySong1, autoplaySong2],
    },
  } as never;
  assert.deepEqual(filterUserQueueItems(instWithAllAutoplay), []);
});
