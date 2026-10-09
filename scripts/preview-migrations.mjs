const PREVIEW_BASELINE = { tag: "v2-split-online-counter", new_sqlite_classes: ["LivePushRoom", "StateHub"] };

// Preview-only migrations keep their place before later api migrations on already-created namespaces.
export const PREVIEW_MIGRATIONS = [
  { after: "v4-anthropic-egress", migration: { tag: "v5-build-coordinator", new_sqlite_classes: ["BuildCoordinator"] } },
];

export function previewMigrations(migrations) {
  const cut = migrations.findIndex((migration) => migration.tag === PREVIEW_BASELINE.tag);
  if (cut === -1) throw new Error(`wrangler.toml 里找不到迁移 ${PREVIEW_BASELINE.tag}`);
  const result = [structuredClone(PREVIEW_BASELINE), ...structuredClone(migrations.slice(cut + 1))];
  for (const { after, migration } of PREVIEW_MIGRATIONS) {
    const index = result.findIndex((entry) => entry.tag === after);
    if (index === -1) throw new Error(`wrangler.toml 里找不到迁移 ${after}`);
    result.splice(index + 1, 0, structuredClone(migration));
  }
  if (new Set(result.map(({ tag }) => tag)).size !== result.length) throw new Error("Preview migration tags must be unique.");
  return result;
}
