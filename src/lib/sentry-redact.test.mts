import assert from "node:assert/strict";
import test from "node:test";
import type { Event } from "@sentry/react";
import { redactSentryEvent, redactSentrySpan, SENTRY_SITE_DATA_COLLECTION } from "./sentry-redact";
import { sentryOptions } from "../../workers/site/src/sentry";

test("redactSentryEvent strips query, hash and credentials from request.url", () => {
  const event = {
    request: {
      url: "https://user:pass@lyjw.me/api/auth/callback?code=secret&state=abc#frag",
      headers: { "user-agent": "test" },
    },
  } as unknown as Event;
  const out = redactSentryEvent(event);
  assert.equal(out.request?.url, "https://lyjw.me/api/auth/callback");
  assert.deepEqual(out.request?.headers, { "user-agent": "test" });
});

test("redactSentryEvent strips query from breadcrumb urls", () => {
  const event = {
    breadcrumbs: [
      { category: "xhr", data: { url: "https://lyjw.me/image?url=signed%3A%2F%2F" } },
      {
        category: "navigation",
        data: {
          from: "/chat?token=t1",
          to: "https://lyjw.me/?code=oauthcode",
        },
      },
    ],
  } as unknown as Event;
  const out = redactSentryEvent(event);
  assert.equal(
    out.breadcrumbs![0]!.data!.url,
    "https://lyjw.me/image",
  );
  assert.equal(out.breadcrumbs![1]!.data!.from, "/chat");
  assert.equal(out.breadcrumbs![1]!.data!.to, "https://lyjw.me/");
});

test("redactSentryEvent leaves events without sensitive fields untouched", () => {
  const event = { message: "plain" } as Event;
  assert.equal(redactSentryEvent(event), event);
});

test("site worker sentryOptions wires beforeSend and beforeSendSpan through redaction", () => {
  const options = sentryOptions({} as Env);
  const beforeSend = options.beforeSend as (event: Event, hint: unknown) => Event | null;
  const event = { request: { url: "https://lyjw.me/cb?code=secret" } } as unknown as Event;
  assert.equal(beforeSend(event, {})!.request!.url, "https://lyjw.me/cb");
  assert.equal(options.beforeSendSpan, redactSentrySpan);
  assert.equal(options.dataCollection, SENTRY_SITE_DATA_COLLECTION);
});

test("redactSentrySpan strips query from url attributes and METHOD names", () => {
  const span = {
    name: "GET https://api.example.com/t?key=k#frag",
    attributes: {
      "url.full": "https://lyjw.me/api/auth/callback?code=secret#frag",
      "http.url": "https://lyjw.me/x?y=1",
      "url.query": "code=secret",
      "url.fragment": "frag",
      "url.path": "/api/auth/callback",
    },
  } as unknown as Parameters<typeof redactSentrySpan>[0];
  const out = redactSentrySpan(span);
  assert.equal(out.name, "GET https://api.example.com/t");
  assert.equal(out.attributes["url.full"], "https://lyjw.me/api/auth/callback");
  assert.equal(out.attributes["http.url"], "https://lyjw.me/x");
  assert.equal(out.attributes["url.query"], undefined);
  assert.equal(out.attributes["url.fragment"], undefined);
  assert.equal(out.attributes["url.path"], "/api/auth/callback");
});
