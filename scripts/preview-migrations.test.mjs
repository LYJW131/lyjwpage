import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PREVIEW_ONLY_CLASSES, previewMigrations } from "./preview-migrations.mjs";

const migrations = [
  {
    tag: "v1-transfer-from-api",
    transferred_classes: [
      { from: "LivePushRoom", from_script: "api", to: "LivePushRoom" },
      { from: "StateHub", from_script: "api", to: "StateHub" },
    ],
  },
];

test("Preview creates transferred classes directly because its namespaces start empty", () => {
  assert.deepEqual(previewMigrations(migrations), [
    { tag: "v1-transfer-from-api", new_sqlite_classes: ["LivePushRoom", "StateHub", ...PREVIEW_ONLY_CLASSES] },
  ]);
});

test("later core migrations keep their tags and order after the first one", () => {
  const next = { tag: "v2-core-next", new_sqlite_classes: ["NextCoreClass"] };
  const renamed = { tag: "v3-core-rename", renamed_classes: [{ from: "NextCoreClass", to: "NewCoreClass" }] };
  const deployed = previewMigrations(migrations);
  const updated = previewMigrations([...migrations, next, renamed]);
  assert.deepEqual(updated.slice(0, deployed.length), deployed);
  assert.deepEqual(updated.slice(deployed.length), [next, renamed]);
});

test("Preview rejects an empty chain and a class created twice", () => {
  assert.throws(() => previewMigrations([]), /没有迁移/);
  assert.throws(() => previewMigrations([...migrations, { tag: "v2-dup", new_sqlite_classes: ["ChatQuota"] }]), /each class once/);
});

test("Preview migration generation does not mutate input", () => {
  const expected = structuredClone(migrations);
  previewMigrations(migrations)[0].new_sqlite_classes.push("UnrelatedClass");
  assert.deepEqual(migrations, expected);
  assert.equal(previewMigrations(migrations)[0].new_sqlite_classes.includes("UnrelatedClass"), false);
});

test("the repository core migration chain keeps every tag in Preview", () => {
  const config = readFileSync(new URL("../workers/core/wrangler.toml", import.meta.url), "utf8");
  const productionTags = [...config.matchAll(/^\[\[migrations\]\]\s*\ntag = "([^"]+)"/gm)].map((match) => match[1]);
  assert.deepEqual(previewMigrations(productionTags.map((tag) => ({ tag }))).map(({ tag }) => tag), productionTags);
});
