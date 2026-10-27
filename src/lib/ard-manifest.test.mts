import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MCP_PATH } from "@shared/ai-paths";
import { site } from "@shared/site";

import { SITE_ASSET_ROUTES } from "./site-policy.ts";

const manifest = JSON.parse(readFileSync(new URL("../../public/agents/ard.json", import.meta.url), "utf8"));

test("ard.json and its predecessor path serve the same manifest", () => {
  assert.equal(SITE_ASSET_ROUTES.get("/.well-known/ard.json")?.asset, "/agents/ard.json");
  assert.equal(SITE_ASSET_ROUTES.get("/.well-known/ai-catalog.json")?.asset, "/agents/ard.json");
});

test("every entry has the fields Lighthouse's ARD conformance check requires", () => {
  assert.equal(manifest.specVersion, "1.0");
  for (const entry of manifest.entries) {
    assert.match(entry.identifier, /^urn:air:([a-zA-Z0-9.-]+)(?::([a-zA-Z0-9._:-]+))?:([a-zA-Z0-9._-]+)$/);
    assert.ok(entry.displayName && entry.type);
    assert.notEqual("url" in entry, "data" in entry, "exactly one of url or data");
    assert.ok(entry.representativeQueries.length >= 2 && entry.representativeQueries.length <= 5);
  }
});

test("the MCP server card points at the public MCP endpoint", () => {
  const card = manifest.entries.find((entry: { type: string }) => entry.type === "application/mcp-server-card+json").data;
  assert.deepEqual(card.remotes, [{ type: "streamable-http", url: `${site.url}${MCP_PATH}` }]);
});
