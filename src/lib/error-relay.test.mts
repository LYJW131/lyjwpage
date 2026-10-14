import assert from "node:assert/strict";
import test from "node:test";

import { ERROR_RELAY_MAX_BYTES, isSiteOrigin, parseClientErrorReport, relayClientError } from "./error-relay.ts";

const report = {
  source: "boundary",
  name: "TypeError",
  message: "x is undefined",
  stack: "TypeError: x is undefined\n    at Card (https://lyjw.me/assets/card.js:1:2)",
  url: "https://lyjw.me/?q=secret#frag",
  release: "abc123",
  tags: { card: "Site", "bad key": "dropped", empty: "" },
};

const post = (body: BodyInit) => new Request("https://lyjw.me/relay", { method: "POST", body });

test("a client report is trimmed to the contract and loses query strings and odd tags", () => {
  assert.deepEqual(parseClientErrorReport(report), {
    ...report,
    url: "https://lyjw.me/",
    tags: { card: "Site" },
  });
  assert.equal(parseClientErrorReport({ ...report, source: "console" }), null);
  assert.equal(parseClientErrorReport({ ...report, message: "  " }), null);
  assert.equal(parseClientErrorReport([report]), null);
  assert.equal(parseClientErrorReport({ ...report, message: "m".repeat(5_000) })?.message.length, 1_000);
});

test("URLs inside the message and stack lose credentials, query strings and fragments but keep line and column", () => {
  const parsed = parseClientErrorReport({
    ...report,
    message: "Failed to fetch https://user:pw@api.example.com/x?token=secret#frag",
    stack: "Error\n    at f (https://lyjw.me/assets/a.js?token=abc:10:20)\n    at https://lyjw.me/assets/b.js:3:4",
  });
  assert.equal(parsed?.message, "Failed to fetch https://api.example.com/x");
  assert.equal(parsed?.stack, "Error\n    at f (https://lyjw.me/assets/a.js:10:20)\n    at https://lyjw.me/assets/b.js:3:4");
});

test("the relay logs a valid report as an Error with the browser stack and rejects the rest", async () => {
  const logged: unknown[][] = [];
  const log = (...args: unknown[]) => { logged.push(args); };
  assert.equal(await relayClientError(post(JSON.stringify(report)), log), 204);
  const [label, error, detail] = logged[0];
  assert.equal(label, "[browser-error]");
  assert.ok(error instanceof Error);
  assert.equal(error.name, "TypeError");
  assert.equal(error.stack, report.stack);
  assert.deepEqual(detail, { source: "boundary", url: "https://lyjw.me/", release: "abc123", tags: { card: "Site" } });

  assert.equal(await relayClientError(post("not json"), log), 400);
  assert.equal(await relayClientError(post(JSON.stringify({ source: "window" })), log), 400);
  assert.equal(await relayClientError(post("x".repeat(ERROR_RELAY_MAX_BYTES + 1)), log), 413);
  assert.equal(logged.length, 1);
});

test("the relay only accepts reports from the site's own origins", () => {
  const from = (url: string, origin?: string) =>
    isSiteOrigin(new Request(url, { method: "POST", headers: origin === undefined ? {} : { Origin: origin } }));
  assert.equal(from("https://lyjw.me/relay", "https://lyjw.me"), true);
  assert.equal(from("https://lyjw.me/relay", "https://lyjw131.com"), true);
  assert.equal(from("https://abc-site.lyjw.workers.dev/relay", "https://abc-site.lyjw.workers.dev"), true);
  assert.equal(from("http://localhost:3211/relay", "http://localhost:3211"), true);
  assert.equal(from("https://lyjw.me/relay"), true);
  assert.equal(from("https://lyjw.me/relay", "https://evil.example"), false);
  assert.equal(from("https://lyjw.me/relay", "http://lyjw131.com"), false);
  assert.equal(from("https://lyjw.me/relay", "https://abc-site.lyjw.workers.dev"), false);
  assert.equal(from("https://lyjw.me/relay", "null"), false);
});
