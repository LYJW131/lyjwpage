import assert from "node:assert/strict";
import test from "node:test";

import { esaHomeConfig, purgeEsaHome, signAcs3 } from "./esa-home-purge";
import { expireStatusTags } from "./live-platform";
import { requestStore, type Env } from "./runtime";

const CONFIGURED = {
  ESA_SITE_ID: "1113300533463584",
  ESA_HOME_URL: "https://lyjw131.com/",
  ALIYUN_ESA_ACCESS_KEY_ID: "test-id",
  ALIYUN_ESA_ACCESS_KEY_SECRET: "test-secret",
};

test("ACS3 签名匹配阿里云官方固定向量（与 scripts/esa-purge.test.mjs 同一组）", async () => {
  const signed = await signAcs3({
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
    signed.headers.authorization!.endsWith(
      "Signature=06563a9e1b43f5dfe96b81484da74bceab24a1d853912eee15083a6f0f3283c0",
    ),
  );
});

test("缺任一配置就不刷 ESA", () => {
  assert.equal(esaHomeConfig({} as Env), null);
  assert.equal(esaHomeConfig({ ...CONFIGURED, ALIYUN_ESA_ACCESS_KEY_SECRET: " " } as unknown as Env), null);
  assert.ok(esaHomeConfig(CONFIGURED as unknown as Env));
});

test("按 cachekey 只刷首页，应答没有 TaskId 时抛错", async () => {
  const config = esaHomeConfig(CONFIGURED as unknown as Env)!;
  const urls: URL[] = [];
  const ok = (async (input: string | URL | Request) => {
    urls.push(new URL(String(input)));
    return Response.json({ TaskId: "task-1", RequestId: "req-1" });
  }) as typeof fetch;
  assert.equal(await purgeEsaHome(config, ok), "task-1");
  const url = urls[0]!;
  assert.equal(url.hostname, "esa.cn-hangzhou.aliyuncs.com");
  assert.equal(url.searchParams.get("Type"), "cachekey");
  assert.equal(url.searchParams.get("SiteId"), "1113300533463584");
  assert.deepEqual(JSON.parse(url.searchParams.get("Content")!), { CacheKeys: [{ Url: "https://lyjw131.com/", Headers: {} }] });

  const denied = (async () => Response.json({ Code: "Forbidden.RAM", Message: "no" }, { status: 403 })) as typeof fetch;
  await assert.rejects(purgeEsaHome(config, denied), /403: Forbidden\.RAM/);
});

async function expire(env: Partial<Env>, tags: string[]) {
  await requestStore.run({ env: env as Env, ctx: { waitUntil: () => {} } }, () => expireStatusTags(tags));
}

test("site 清完首页才刷 ESA；site 失败、没配密钥或标签无效都不刷", async (t) => {
  const order: string[] = [];
  t.mock.method(globalThis, "fetch", async () => {
    order.push("esa");
    return Response.json({ TaskId: "task-1" });
  });
  const site = { invalidate: async () => { order.push("site"); } };
  const broken = { invalidate: async () => { order.push("site-failed"); throw new Error("purge failed"); } };

  await expire({ ...CONFIGURED, SITE_CACHE: site }, ["charger"]);
  assert.deepEqual(order.splice(0), ["site", "esa"]);

  await expire({ ...CONFIGURED, SITE_CACHE: broken }, ["charger"]);
  assert.deepEqual(order.splice(0), ["site-failed"]);

  await expire({ SITE_CACHE: site }, ["charger"]);
  assert.deepEqual(order.splice(0), ["site"]);

  await expire({ ...CONFIGURED, SITE_CACHE: site }, ["not-a-tag"]);
  assert.deepEqual(order.splice(0), []);
});
