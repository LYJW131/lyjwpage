/**
 * 生成对「重排」稳定、但仍然唯一的 key。
 *
 * 直接用下标做 key，列表顶部插入新条目时所有 key 都会变，React 会认为
 * 整批换了新元素 —— 动画就只剩「全体闪一下」，看不出谁进来、谁下移。
 * 直接用 id 又挡不住偶发的重复项（重复的 key 会让 AnimatePresence 错乱）。
 *
 * 这里用 id + 该 id 在列表中的第几次出现：同一批数据重排时 key 不变，
 * 重复项之间也不会撞。
 */
export function stableKeys(ids: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return ids.map((id) => {
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    return n === 0 ? id : `${id}#${n}`;
  });
}
