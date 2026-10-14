// 组合入口里 ai 的类在生产属于 ai Worker，Preview 随第一条迁移一起新建。
export const PREVIEW_ONLY_CLASSES = ["ChatQuota", "AnthropicEgress", "BuildCoordinator"];

export function previewMigrations(migrations) {
  if (!migrations.length) throw new Error("wrangler.toml 里没有迁移");
  const result = migrations.map((migration, index) => {
    const { transferred_classes: transferred = [], ...rest } = structuredClone(migration);
    const created = [
      ...(rest.new_sqlite_classes ?? []),
      ...transferred.map(({ to }) => to),
      ...(index === 0 ? PREVIEW_ONLY_CLASSES : []),
    ];
    return created.length ? { ...rest, new_sqlite_classes: created } : rest;
  });
  const created = result.flatMap(({ new_sqlite_classes }) => new_sqlite_classes ?? []);
  if (new Set(created).size !== created.length) throw new Error("Preview migrations must create each class once.");
  return result;
}
