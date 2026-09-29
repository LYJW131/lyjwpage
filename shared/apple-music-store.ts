import { mirrorKey } from "@/lib/storage";
import type { ListeningItem } from "@/lib/types";

/**
 * 「最近在听」的落库。
 *
 * **一个键装整份**：读一次就拿到整份列表，不按 item 拆键。读写规则见 lib/storage 的 mirrorKey。
 */

/**
 * `fetchedAt` 单独放在外面，它是代数不是新鲜度 —— 这张卡没有陈旧判定
 * （一份冻住的「最近在听」本身没有错），用处见 ListeningPayload。
 *
 * **键里带格式版本。** mirrorKey 只 JSON.parse、不校验形状：值的形状变了而键不换，
 * 旧条目会被当成新格式读出来，`items` 是 undefined，首屏读它时整页预渲染就挂了，
 * 而信封仍是 `ok: true`，没有任何一层兜得住。所以改这个值的形状要一起升键里的版本号，
 * 和 lib/apple-music 里 track-lookup 缓存键是同一条规矩。
 */
export const mirror = mirrorKey<{ items: ListeningItem[]; fetchedAt: number }>(
  ["apple-music", "recent", "v2"],
  (state) => state.fetchedAt,
);
