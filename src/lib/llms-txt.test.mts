import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { MCP_PATH } from "@shared/ai-paths";
import { STATUS_VIEWS } from "@shared/status-views";

import { SITE_ASSET_ROUTES } from "./site-policy.ts";

const text = readFileSync(new URL("../../public/llms.txt", import.meta.url), "utf8");
const links = [...text.matchAll(/\]\((https:\/\/[^)\s]+)\)/g)].map((match) => new URL(match[1]));

test("llms.txt follows the llmstxt.org layout: H1 first, then a blockquote summary", () => {
  const lines = text.split("\n");
  assert.match(lines[0], /^# \S/);
  assert.match(lines.find((line, index) => index > 0 && line.trim()) ?? "", /^> \S/);
  assert.equal(text.match(/^# /gm)?.length, 1);
});

test("every site path llms.txt links to still exists", () => {
  const statusPaths = new Set<string>(Object.values(STATUS_VIEWS).map((view) => view.path));
  for (const url of links.filter((link) => link.hostname === "lyjw.me")) {
    if (url.pathname.startsWith("/api/")) assert.ok(statusPaths.has(url.pathname), url.pathname);
    else if (url.pathname === MCP_PATH) continue;
    else if (SITE_ASSET_ROUTES.has(url.pathname)) continue;
    else assert.ok(["/", "/explainer/"].includes(url.pathname), url.pathname);
  }
});

test("every repository file llms.txt links to still exists", () => {
  const prefix = "/LYJW131/lyjwpage/main/";
  for (const url of links.filter((link) => link.hostname === "raw.githubusercontent.com")) {
    assert.ok(url.pathname.startsWith(prefix), url.href);
    assert.ok(existsSync(new URL(`../../${url.pathname.slice(prefix.length)}`, import.meta.url)), url.href);
  }
});
