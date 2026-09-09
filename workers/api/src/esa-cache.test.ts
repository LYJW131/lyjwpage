import assert from "node:assert/strict";
import test from "node:test";
import { signAliyunRequest } from "@api/aliyun-signature";
import { purgeEsaHomepage } from "@api/esa-cache";
import { expireStatusTags } from "@api/live-platform";
import { requestStore, type Env } from "@api/runtime";

const config = {
  ESA_SITE_ID: "1113300533463584", ESA_CACHE_URL: "https://lyjw131.com/",
  ALIYUN_ACCESS_KEY_ID: "test-id", ALIYUN_ACCESS_KEY_SECRET: "test-secret",
};

test("ACS3 签名匹配阿里云官方固定向量", () => {
  const signed = signAliyunRequest({
    endpoint: "ecs.cn-shanghai.aliyuncs.com", action: "RunInstances", version: "2014-05-26",
    query: { ImageId: "win2019_1809_x64_dtc_zh-cn_40G_alibase_20230811.vhd", RegionId: "cn-shanghai" },
    accessKeyId: "YourAccessKeyId", accessKeySecret: "YourAccessKeySecret",
    date: "2023-10-26T10:22:32Z", nonce: "3156853299f313e23d1673dc12e1703d",
  });
  assert.ok(signed.headers.authorization.endsWith("Signature=06563a9e1b43f5dfe96b81484da74bceab24a1d853912eee15083a6f0f3283c0"));
});

test("ESA 按控制台元数据以 POST query 刷新唯一首页 cachekey", async (t) => {
  const calls: URL[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input); calls.push(url);
    assert.equal(url.hostname, "esa.cn-hangzhou.aliyuncs.com");
    assert.equal(init.method, "POST");
    assert.equal(init.body, undefined);
    assert.equal(url.searchParams.get("SiteId"), config.ESA_SITE_ID);
    assert.equal(url.searchParams.get("Type"), "cachekey");
    assert.deepEqual(JSON.parse(url.searchParams.get("Content")!), {
      CacheKeys: [{ Url: config.ESA_CACHE_URL, Headers: {} }],
    });
    assert.equal(new Headers(init.headers).get("x-acs-action"), "PurgeCaches");
    return Response.json({ TaskId: "task-1", RequestId: "request-1" });
  });
  await purgeEsaHomepage(config);
  assert.equal(calls.length, 1);
});

test("ESA 配置缺失不发送签名请求，失败不泄漏密钥", async (t) => {
  const calls = t.mock.method(globalThis, "fetch", async () => { throw new Error(config.ALIYUN_ACCESS_KEY_SECRET); });
  const logs: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => logs.push(args));
  await purgeEsaHomepage({});
  await purgeEsaHomepage({ ...config, ALIYUN_ACCESS_KEY_SECRET: undefined });
  assert.equal(calls.mock.callCount(), 0);
  await purgeEsaHomepage(config);
  assert.equal(calls.mock.callCount(), 1);
  assert.ok(!JSON.stringify(logs).includes(config.ALIYUN_ACCESS_KEY_SECRET));
});

test("ESA 拒绝错误应答与缺少 TaskId 的假成功", async (t) => {
  const logs = t.mock.method(console, "error", () => {});
  for (const response of [Response.json({ Code: "QuotaExceeded" }, { status: 400 }), Response.json({}), new Response("invalid")]) {
    t.mock.method(globalThis, "fetch", async () => response);
    await purgeEsaHomepage(config);
  }
  assert.equal(logs.mock.callCount(), 3);
});

test("无标签不刷新；Vercel 等待或失败都不阻断 ESA", async (t) => {
  const calls: string[] = [];
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async (input: string) => {
    calls.push(input);
    if (input.includes("/api/revalidate")) {
      await waiting;
      return Response.json({ error: "test failure" }, { status: 503 });
    }
    return Response.json({ TaskId: "task-2" });
  });
  const env = { ...config, SITE_URL: "https://lyjw.me", TELEMETRY_INGEST_SECRET: "test" } as Env;
  await requestStore.run({ env, ctx: { waitUntil() {} }, requestEsaPurge: () => purgeEsaHomepage(env) }, async () => {
    await expireStatusTags([]);
    assert.equal(calls.length, 0);
    const work = expireStatusTags(["server"]);
    assert.equal(calls.length, 2);
    release();
    await work;
  });
});
