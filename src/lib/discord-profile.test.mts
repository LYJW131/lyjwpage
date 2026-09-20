import assert from "node:assert/strict";
import test from "node:test";
import { discordConnectionUrl, discordCreatedAt } from "./discord-profile.ts";

test("derives account creation from the Discord snowflake", () => {
  assert.equal(discordCreatedAt("1542551134319808633"), "2026-08-27T15:07:29.636Z");
  assert.equal(discordCreatedAt("invalid"), null);
});
test("connection links only use supported platform URLs", () => {
  assert.equal(discordConnectionUrl({ type: "domain", id: "x", name: "javascript:alert(1)" }), null);
  assert.equal(discordConnectionUrl({ type: "domain", id: "x", name: "evil.com/path" }), null);
  assert.equal(discordConnectionUrl({ type: "github", id: "1", name: "LYJW131" }), "https://github.com/LYJW131");
  assert.equal(discordConnectionUrl({ type: "playstation", id: "1", name: "BQDJS" }), null);
});
