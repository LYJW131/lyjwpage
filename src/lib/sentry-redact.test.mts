import assert from "node:assert/strict";
import test from "node:test";
import type { Event } from "@sentry/react";
import { redactSentryEvent } from "./sentry-redact";
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

test("redactSentryEvent redacts span url data, navigation crumbs and METHOD descriptions", () => {
  const event = {
    spans: [
      {
        description: "GET https://a-cdn.example.com/covers/1.jpg?sig=signed",
        data: {
          "http.url": "https://a-cdn.example.com/x?sig=s",
          "url.full": "https://a-cdn.example.com/y?sig=s",
          url: "https://a-cdn.example.com/z?sig=s",
          "http.method": "GET",
        },
      },
      { description: "navigate /chat?next=/a#top", data: {} },
    ],
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
  const [span, plain] = out.spans!;
  assert.equal(span!.description, "GET https://a-cdn.example.com/covers/1.jpg");
  assert.equal(span!.data!["http.url"], "https://a-cdn.example.com/x");
  assert.equal(span!.data!["url.full"], "https://a-cdn.example.com/y");
  assert.equal(span!.data!.url, "https://a-cdn.example.com/z");
  assert.equal(span!.data!["http.method"], "GET");
  assert.equal(plain!.description, "navigate /chat?next=/a#top");
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

test("site worker sentryOptions wires beforeSend and beforeSendTransaction through redaction", () => {
  const options = sentryOptions({} as Env);
  const beforeSend = options.beforeSend as (event: Event, hint: unknown) => Event | null;
  const beforeSendTransaction = options.beforeSendTransaction as (
    event: Event,
    hint: unknown,
  ) => Event | null;
  assert.equal(typeof beforeSend, "function");
  assert.equal(typeof beforeSendTransaction, "function");
  const event = {
    request: { url: "https://lyjw.me/cb?code=secret" },
    spans: [{ description: "POST https://api.example.com/t?key=k" }],
  } as unknown as Event;
  const sent = beforeSend(event, {});
  assert.equal(sent!.request!.url, "https://lyjw.me/cb");
  const tx = beforeSendTransaction(event, {});
  assert.equal(tx!.spans![0]!.description, "POST https://api.example.com/t");
});
