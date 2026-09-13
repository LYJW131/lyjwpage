import assert from "node:assert/strict";
import test from "node:test";
import { purgeEsaHomepage, signAliyunRequest } from "./esa-purge.mjs";

const config = {
  siteId: "1113300533463584",
  cacheUrl: "https://lyjw131.com/",
  accessKeyId: "test-id",
  accessKeySecret: "test-secret",
};

test("ACS3 签名匹配阿里云官方固定向量", () => {
  const signed = signAliyunRequest({
    endpoint: "ecs.cn-shanghai.aliyuncs.com",
    action: "RunInstances",
    version: "2014-05-26",
    query: {
      ImageId: "win2019_1809_x64_dtc_zh-cn_40G_alibase_20230811.vhd",
      RegionId: "cn-shanghai",
    },
    accessKeyId: "YourAccessKeyId",
    accessKeySecret: "YourAccessKeySecret",
    date: "2023-10-26T10:22:32Z",
    nonce: "3156853299f313e23d1673dc12e1703d",
  });
  assert.ok(
    signed.headers.authorization.endsWith(
      "Signature=06563a9e1b43f5dfe96b81484da74bceab24a1d853912eee15083a6f0f3283c0",
    ),
  );
});

test("ESA 按控制台元数据以 POST query 刷新唯一首页 cachekey", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    calls.push(url);
    assert.equal(url.hostname, "esa.cn-hangzhou.aliyuncs.com");
    assert.equal(init.method, "POST");
    assert.equal(init.body, undefined);
    assert.equal(init.redirect, "manual");
    assert.equal(url.searchParams.get("SiteId"), config.siteId);
    assert.equal(url.searchParams.get("Type"), "cachekey");
    assert.deepEqual(JSON.parse(url.searchParams.get("Content")), {
      CacheKeys: [{ Url: config.cacheUrl, Headers: {} }],
    });
    assert.equal(new Headers(init.headers).get("x-acs-action"), "PurgeCaches");
    return Response.json({ TaskId: "task-12345", RequestId: "request-12345" });
  });

  const result = await purgeEsaHomepage(config);
  assert.equal(calls.length, 1);
  assert.equal(result.ok, true);
  assert.equal(result.taskId, "task-12345");
  assert.equal(result.requestId, "request-12345");
});

test("ESA 配置缺失返回错误并不发送请求", async (t) => {
  const calls = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("should not be called");
  });

  const r1 = await purgeEsaHomepage({});
  assert.equal(r1.ok, false);
  assert.equal(calls.mock.callCount(), 0);

  const r2 = await purgeEsaHomepage({ ...config, accessKeySecret: undefined });
  assert.equal(r2.ok, false);
  assert.equal(calls.mock.callCount(), 0);
});

test("ESA 拒绝错误应答与缺少 TaskId 的假成功", async (t) => {
  for (const response of [
    Response.json({ Code: "QuotaExceeded", Message: "Quota exceeded" }, { status: 400 }),
    Response.json({}),
    new Response("invalid json response"),
  ]) {
    t.mock.method(globalThis, "fetch", async () => response);
    const result = await purgeEsaHomepage(config);
    assert.equal(result.ok, false);
  }
});
