import assert from "node:assert/strict";
import test from "node:test";

import { ERROR_RELAY_MAX_BYTES, parseClientErrorReport, relayClientError } from "./error-relay.ts";

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
