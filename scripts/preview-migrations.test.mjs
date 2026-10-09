import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { previewMigrations } from "./preview-migrations.mjs";

const migrations = [
  { tag: "v1-transfer-from-ingest", new_sqlite_classes: ["OnlineCounterRoom"], transferred_classes: [{ from: "StateHub", from_script: "ingest", to: "StateHub" }] },
  { tag: "v2-split-online-counter", deleted_classes: ["OnlineCounterRoom"] },
  { tag: "v3-chat-quota", new_sqlite_classes: ["ChatQuota"] },
  { tag: "v4-anthropic-egress", new_sqlite_classes: ["AnthropicEgress"] },
];

test("Preview initializes current classes without replaying production transfers or deletes", () => {
  assert.deepEqual(previewMigrations(migrations), [
    { tag: "v2-split-online-counter", new_sqlite_classes: ["LivePushRoom", "StateHub"] },
    ...migrations.slice(2),
    { tag: "v5-build-coordinator", new_sqlite_classes: ["BuildCoordinator"] },
  ]);
});

test("new api migrations remain after the deployed Preview tag and are not skipped", () => {
  const next = { tag: "v5-api-next", new_sqlite_classes: ["NextApiClass"] };
  const renamed = { tag: "v6-api-rename", renamed_classes: [{ from: "NextApiClass", to: "NewApiClass" }] };
  const deployed = previewMigrations(migrations);
  const updated = previewMigrations([...migrations, next, renamed]);
  assert.deepEqual(updated.slice(0, deployed.length), deployed);
  assert.deepEqual(updated.slice(updated.findIndex(({ tag }) => tag === "v5-build-coordinator") + 1), [next, renamed]);
});

test("Preview requires the production baseline and insertion anchor, and rejects duplicate tags", () => {
  assert.throws(() => previewMigrations([]), /v2-split-online-counter/);
  assert.throws(() => previewMigrations(migrations.slice(0, -1)), /v4-anthropic-egress/);
  assert.throws(() => previewMigrations([...migrations, { tag: "v5-build-coordinator" }]), /tags must be unique/);
});

test("Preview migration generation does not mutate input or share mutable histories", () => {
  const expected = structuredClone(migrations);
  const first = previewMigrations(migrations);
  first[0].new_sqlite_classes.push("UnrelatedClass");
  first[1].new_sqlite_classes.push("UnrelatedClass");
  first.at(-1).new_sqlite_classes.push("UnrelatedClass");
  assert.deepEqual(migrations, expected);
  assert.equal(previewMigrations(migrations).some(({ new_sqlite_classes }) => new_sqlite_classes?.includes("UnrelatedClass")), false);
});

test("the repository api migration chain retains every post-baseline tag in Preview", () => {
  const config = readFileSync(new URL("../workers/api/wrangler.toml", import.meta.url), "utf8");
  const productionTags = [...config.matchAll(/^\[\[migrations\]\]\s*\ntag = "([^"]+)"/gm)].map((match) => match[1]);
  const result = previewMigrations(productionTags.map((tag) => ({ tag })));
  const baseline = productionTags.indexOf("v2-split-online-counter");
  assert.deepEqual(result.filter(({ tag }) => tag !== "v5-build-coordinator").map(({ tag }) => tag), productionTags.slice(baseline));
});
