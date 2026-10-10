import assert from "node:assert/strict";
import test from "node:test";

import { FIRST_SCREEN_CACHE_LIFE } from "./first-screen-cache.ts";
import {
  HOMEPAGE_STALE_IF_ERROR_SECONDS,
  homepageCacheControl,
  homepageCacheHeaderRules,
  homepageDocumentCacheControl,
  homepageFlightCacheControl,
} from "./homepage-cache-policy.ts";

function directive(header: string, name: string): number {
  const match = header.match(new RegExp(`(?:^|,)\\s*${name}=(\\d+)\\b`));
  assert.ok(match, `${name} missing from ${header}`);
  return Number(match[1]);
}

test("document cache stays fresh only for the first-screen stale window and revalidates on that cadence", () => {
  const header = homepageDocumentCacheControl();
  assert.equal(directive(header, "max-age"), FIRST_SCREEN_CACHE_LIFE.stale);
  assert.equal(directive(header, "stale-while-revalidate"), FIRST_SCREEN_CACHE_LIFE.revalidate);
  assert.equal(directive(header, "stale-if-error"), HOMEPAGE_STALE_IF_ERROR_SECONDS);
  assert.ok(directive(header, "stale-while-revalidate") < directive(header, "stale-if-error"));
  assert.ok(directive(header, "stale-while-revalidate") < FIRST_SCREEN_CACHE_LIFE.expire);
  assert.equal(header.includes("must-revalidate"), false);
  assert.equal(header.startsWith("public,"), true);
});

test("flight responses are not given a public fresh lifetime", () => {
  const header = homepageFlightCacheControl();
  assert.equal(header.includes("public"), false);
  assert.equal(directive(header, "max-age"), 0);
  assert.equal(header.includes("stale-while-revalidate"), false);
});

test("a document request and a flight request never share a cache policy", () => {
  assert.deepEqual(homepageCacheControl(new Headers()), [homepageDocumentCacheControl()]);
  for (const name of ["rsc", "RSC", "next-router-state-tree", "next-router-prefetch", "next-router-segment-prefetch"]) {
    const matched = homepageCacheControl(new Headers({ [name]: "1" }));
    assert.ok(matched.length >= 1, name);
    assert.deepEqual(matched, Array(matched.length).fill(homepageFlightCacheControl()), name);
  }
  const both = homepageCacheControl(new Headers({ rsc: "1", "next-router-prefetch": "1" }));
  assert.deepEqual(both, Array(both.length).fill(homepageFlightCacheControl()));
});

test("header rules sent to Next keep document and flight mutually exclusive", () => {
  const rules = homepageCacheHeaderRules().filter((rule) => rule.source === "/");
  const document = rules.filter((rule) => rule.missing);
  const flight = rules.filter((rule) => rule.has);
  assert.equal(document.length, 1);
  assert.equal(document[0]?.headers[0]?.value, homepageDocumentCacheControl());
  assert.ok((document[0]?.missing ?? []).length >= 4);
  assert.ok(flight.length >= 4);
  assert.ok(flight.every((rule) => rule.headers[0]?.value === homepageFlightCacheControl()));
});
