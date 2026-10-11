import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  HOME_CACHE_CONTROL,
  HOME_CACHE_TAG,
  IMMUTABLE_ASSET_CACHE_CONTROL,
  NO_STORE,
  STATUS_CACHE_CONTROL,
  classifyGatewayRequest,
  classifyRenderRequest,
  imageObjectHeaders,
  imageObjectRequest,
  isPublicStatusEnvelope,
  renderCacheHeaders,
  statusSnapshotHeaders,
} from "./site-policy.ts";
import { filterStatusTags } from "./status-views.ts";

test("网关按路径分流：渲染、代理、资产、非法", () => {
  assert.deepEqual(classifyGatewayRequest("GET", "/"), { kind: "render" });
  assert.deepEqual(classifyGatewayRequest("GET", "/github-callback"), { kind: "render" });
  assert.deepEqual(classifyGatewayRequest("GET", "/local/charging"), { kind: "render" });
  assert.deepEqual(classifyGatewayRequest("GET", "/api/version"), { kind: "render" });
  assert.deepEqual(classifyGatewayRequest("GET", "/no-such-page"), { kind: "render" });
  assert.deepEqual(classifyGatewayRequest("GET", "/_.data"), { kind: "render" });
  assert.deepEqual(classifyGatewayRequest("GET", "/github-callback.data"), { kind: "render" });
  assert.deepEqual(classifyGatewayRequest("GET", "/mcp"), { kind: "mcp" });
  assert.deepEqual(classifyGatewayRequest("POST", "/mcp/tools/call"), { kind: "mcp" });
  assert.deepEqual(classifyGatewayRequest("POST", "/relay/api/1/envelope/"), {
    kind: "sentry-relay",
  });
  assert.deepEqual(classifyGatewayRequest("GET", "/relay/api/1/envelope/"), { kind: "invalid" });
  assert.deepEqual(classifyGatewayRequest("POST", "/"), { kind: "invalid" });
  assert.deepEqual(classifyGatewayRequest("GET", "/image"), { kind: "image-proxy" });
  assert.deepEqual(classifyGatewayRequest("GET", "/explainer"), { kind: "explainer-index" });
  assert.deepEqual(classifyGatewayRequest("GET", "/sw.js"), { kind: "service-worker" });
  assert.deepEqual(classifyGatewayRequest("GET", "/assets/app-abc.js"), { kind: "asset" });
  assert.deepEqual(classifyGatewayRequest("GET", "/manifest.webmanifest"), { kind: "asset" });
  assert.deepEqual(classifyGatewayRequest("GET", "/icon"), { kind: "site-asset" });
  assert.deepEqual(classifyGatewayRequest("HEAD", "/pwa/icon-192.png"), { kind: "site-asset" });
  assert.deepEqual(classifyGatewayRequest("POST", "/opengraph-image"), { kind: "invalid" });
});

test("/img 只放行内容地址键", () => {
  const key = `${"a".repeat(64)}.webp`;
  assert.deepEqual(classifyGatewayRequest("GET", `/img/${key}`), { kind: "image-object" });
  assert.equal(classifyGatewayRequest("GET", "/img/short.webp").kind, "invalid");
  assert.equal(classifyGatewayRequest("GET", "/img/ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789.webp").kind, "invalid");
  assert.equal(classifyGatewayRequest("GET", `/img/${"a".repeat(64)}.exe`).kind, "invalid");
  assert.equal(classifyGatewayRequest("GET", `/img/${"a".repeat(63)}`).kind, "invalid");
});

test("原始 /img 回源请求剥掉查询串，只带条件头进缓存入口", () => {
  const key = `${"b".repeat(64)}.mp3`;
  const incoming = new Request(`https://lyjw.me/img/${key}?v=1&session=abc`, {
    headers: {
      Range: "bytes=0-1023",
      "If-None-Match": '"etag"',
      Cookie: "session=secret",
      Authorization: "Bearer token",
    },
  });
  const loopback = imageObjectRequest(incoming);
  assert.equal(loopback.url, `https://lyjw.me/img/${key}`);
  assert.equal(loopback.headers.get("range"), "bytes=0-1023");
  assert.equal(loopback.headers.get("if-none-match"), '"etag"');
  assert.equal(loopback.headers.get("cookie"), null);
  assert.equal(loopback.headers.get("authorization"), null);
});

test("原始 /img 对象头：只有命中对象才有 immutable，元数据完整", () => {
  const headers = imageObjectHeaders({
    httpEtag: '"etag-value"',
    size: 1234,
    writeHttpMetadata(h) {
      h.set("Content-Type", "audio/mpeg");
    },
  });
  assert.equal(headers.get("Cache-Control"), IMMUTABLE_ASSET_CACHE_CONTROL);
  assert.equal(headers.get("ETag"), '"etag-value"');
  assert.equal(headers.get("Content-Length"), "1234");
  assert.equal(headers.get("Content-Type"), "audio/mpeg");
  assert.equal(headers.get("Accept-Ranges"), "bytes");
});

test("带哈希的 /assets 由静态资源层直出，_headers 与 Worker 用同一个 immutable 策略", () => {
  const rules = readFileSync(new URL("../../public/_headers", import.meta.url), "utf8");
  assert.ok(rules.includes(`/assets/*\n  Cache-Control: ${IMMUTABLE_ASSET_CACHE_CONTROL}\n`));
});

test("渲染分类区分首页文档、根数据与其他路由", () => {
  assert.equal(classifyRenderRequest("/"), "home-document");
  assert.equal(classifyRenderRequest("/_.data"), "home-data");
  assert.equal(classifyRenderRequest("/.data"), "home-data");
  assert.equal(classifyRenderRequest("/api/version"), "other");
  assert.equal(classifyRenderRequest("/github-callback"), "other");
  assert.equal(classifyRenderRequest("/local/charging"), "other");
  assert.equal(classifyRenderRequest("/other.data"), "other");
});

test("首页 HTML 与根数据才可缓存，SSR 错误一律 no-store", () => {
  assert.deepEqual(renderCacheHeaders("home-document", 200, "text/html; charset=utf-8", null, false), {
    "Cache-Control": HOME_CACHE_CONTROL,
    "Cache-Tag": HOME_CACHE_TAG,
  });
  assert.deepEqual(renderCacheHeaders("home-data", 200, "text/x-script; charset=utf-8", null, false), {
    "Cache-Control": HOME_CACHE_CONTROL,
    "Cache-Tag": HOME_CACHE_TAG,
  });
  assert.deepEqual(renderCacheHeaders("home-data", 200, "text/html", null, false), {
    "Cache-Control": NO_STORE,
  });
  assert.deepEqual(renderCacheHeaders("home-data", 200, "text/x-turbo", null, false), {
    "Cache-Control": NO_STORE,
  });
  assert.deepEqual(renderCacheHeaders("home-document", 200, "text/x-script", null, false), {
    "Cache-Control": NO_STORE,
  });
  assert.deepEqual(renderCacheHeaders("home-document", 500, "text/html", null, false), {
    "Cache-Control": NO_STORE,
  });
  assert.deepEqual(renderCacheHeaders("home-document", 500, "text/html", "public, max-age=3600", false), {
    "Cache-Control": NO_STORE,
  });
  assert.deepEqual(renderCacheHeaders("home-document", 200, "text/html", "public, max-age=3600", true), {
    "Cache-Control": NO_STORE,
  });
  assert.equal(
    renderCacheHeaders("home-document", 200, "text/html", "private, max-age=60", false),
    null,
  );
  assert.equal(
    renderCacheHeaders("home-document", 200, "text/html", "no-store", false),
    null,
  );
  assert.deepEqual(renderCacheHeaders("home-document", 200, "application/json", null, false), {
    "Cache-Control": NO_STORE,
  });
  assert.deepEqual(renderCacheHeaders("home-data", 404, "text/x-script", null, false), {
    "Cache-Control": NO_STORE,
  });
  assert.equal(
    renderCacheHeaders("other", 200, "application/json", "public, max-age=0, must-revalidate", false),
    null,
  );
  assert.deepEqual(renderCacheHeaders("other", 200, "text/html", null, false), {
    "Cache-Control": NO_STORE,
  });
});

test("状态快照可缓存并带白名单标签", () => {
  assert.deepEqual(statusSnapshotHeaders("listening"), {
    "Cache-Control": STATUS_CACHE_CONTROL,
    "Cache-Tag": "page:listening",
  });
  assert.deepEqual(statusSnapshotHeaders(undefined), {
    "Cache-Control": STATUS_CACHE_CONTROL,
  });
});

test("失效标签白名单过滤、去重、空输入", () => {
  assert.deepEqual(filterStatusTags(["listening", "nonsense", "listening", "server"]), [
    "listening",
    "server",
  ]);
  assert.deepEqual(filterStatusTags([]), []);
  assert.deepEqual(filterStatusTags(["home", "api/lyrics", "*"]), []);
});

test("状态信封校验：200 的坏 JSON/坏信封不能当成功快照", () => {
  assert.equal(isPublicStatusEnvelope({ ok: true, data: {} }), true);
  assert.equal(isPublicStatusEnvelope({ ok: true, data: null }), true);
  assert.equal(isPublicStatusEnvelope({ ok: false, error: "Status unavailable" }), true);
  assert.equal(isPublicStatusEnvelope({ ok: true }), false);
  assert.equal(isPublicStatusEnvelope({ ok: false }), false);
  assert.equal(isPublicStatusEnvelope({ ok: "true", data: {} }), false);
  assert.equal(isPublicStatusEnvelope(null), false);
  assert.equal(isPublicStatusEnvelope([]), false);
  assert.equal(isPublicStatusEnvelope("ok"), false);
});
