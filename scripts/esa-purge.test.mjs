import assert from "node:assert/strict";
import test from "node:test";
import { purgeEsaHomepage, signAliyunRequest, warmupEsaCache } from "./esa-purge.mjs";

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

test("ESA 瞬时网络失败会按 1s、2s 退避重试，成功后停止", async (t) => {
  const delays = [];
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    if (calls < 3) {
      const error = new TypeError("fetch failed");
      error.cause = Object.assign(new Error("connect ECONNRESET"), { code: "ECONNRESET" });
      throw error;
    }
    return Response.json({ TaskId: "task-retry", RequestId: "request-retry" });
  });

  const result = await purgeEsaHomepage(config, {
    sleep: async (ms) => {
      delays.push(ms);
    },
  });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [1_000, 2_000]);
  assert.equal(result.ok, true);
  assert.equal(result.taskId, "task-retry");
});

test("ESA 瞬时网络失败耗尽 3 次后停止", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    const error = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    throw error;
  });

  const result = await purgeEsaHomepage(config, { sleep: async () => {} });
  assert.equal(calls, 3);
  assert.equal(result.ok, false);
  assert.match(result.error, /aborted due to timeout/);
});

test("ESA 非瞬时异常不重试", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    throw new TypeError("Invalid URL");
  });

  const result = await purgeEsaHomepage(config, {
    sleep: async () => {
      throw new Error("should not retry");
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  assert.match(result.error, /Invalid URL/);
});

test("ESA 4xx 鉴权或参数错误不重试", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return Response.json(
      { Code: "InvalidAccessKeyId.NotFound", Message: "not found", RequestId: "request-404" },
      { status: 404 },
    );
  });

  const result = await purgeEsaHomepage(config, {
    sleep: async () => {
      throw new Error("should not retry");
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  assert.match(result.error, /HTTP 404/);
  assert.equal(result.requestId, "request-404");
});

test("ESA 5xx 会重试，成功后停止", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    if (calls === 1) {
      return Response.json({ Code: "InternalError", Message: "busy" }, { status: 503 });
    }
    return Response.json({ TaskId: "task-503", RequestId: "request-503" });
  });

  const result = await purgeEsaHomepage(config, { sleep: async () => {} });
  assert.equal(calls, 2);
  assert.equal(result.ok, true);
  assert.equal(result.taskId, "task-503");
});

function captureWarn(t) {
  const lines = [];
  t.mock.method(console, "warn", (line) => {
    lines.push(String(line));
  });
  return lines;
}

test("失败日志写出尝试次数、重试决定和 cause 的安全字段", async (t) => {
  const lines = captureWarn(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    if (calls === 1) {
      const inner = Object.assign(new Error("connect ECONNRESET"), {
        code: "ECONNRESET",
        errno: -104,
        syscall: "read",
        hostname: "esa.cn-hangzhou.aliyuncs.com",
        address: "203.119.128.1",
        port: 443,
        authorization: "ACS3 Credential=test-id Signature=deadbeef",
      });
      const error = new TypeError("fetch failed");
      error.cause = new AggregateError([inner], "fetch failed");
      throw error;
    }
    const error = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    throw error;
  });

  const result = await purgeEsaHomepage(config, { attempts: 2, sleep: async () => {} });
  assert.equal(result.ok, false);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /第 1\/2 次失败，还会重试（1000ms 后）/);
  assert.match(lines[0], /name=TypeError/);
  assert.match(lines[0], /message=fetch failed/);
  assert.match(lines[0], /cause\.code=ECONNRESET/);
  assert.match(lines[0], /cause\.errno=-104/);
  assert.match(lines[0], /cause\.syscall=read/);
  assert.match(lines[0], /cause\.hostname=esa\.cn-hangzhou\.aliyuncs\.com/);
  assert.match(lines[0], /cause\.address=203\.119\.128\.1/);
  assert.match(lines[0], /cause\.port=443/);
  assert.doesNotMatch(lines[0], /deadbeef|Credential=|authorization=/);
  assert.match(lines[1], /第 2\/2 次失败，不再重试/);
  assert.match(lines[1], /name=TimeoutError/);
  assert.match(lines[1], /message=The operation was aborted due to timeout/);
});

test("失败日志只留 HTTP status 和业务 Code，不留密钥与响应体", async (t) => {
  const lines = captureWarn(t);
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      {
        Code: "InvalidAccessKeyId.NotFound",
        Message: "leak test-secret Signature=deadbeef https://esa.cn-hangzhou.aliyuncs.com/?AccessKeyId=test-id&Signature=deadbeef",
        RequestId: "request-404",
        AccessKeySecret: "test-secret",
      },
      { status: 404 },
    ),
  );

  const result = await purgeEsaHomepage(config, { sleep: async () => { throw new Error("should not retry"); } });
  assert.equal(result.ok, false);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /第 1\/3 次失败，不再重试/);
  assert.match(lines[0], /status=404/);
  assert.match(lines[0], /code=InvalidAccessKeyId\.NotFound/);
  assert.match(lines[0], /requestId=request-404/);
  assert.doesNotMatch(lines[0], /test-secret|deadbeef|Signature=|AccessKeySecret|leak /);
  assert.doesNotMatch(result.error, /test-secret|deadbeef/);
  assert.match(result.error, /HTTP 404/);
});

test("网络错误摘要去掉密钥和带 query 的 URL", async (t) => {
  const lines = captureWarn(t);
  t.mock.method(globalThis, "fetch", async () => {
    const error = new TypeError(
      "fetch failed test-secret https://esa.cn-hangzhou.aliyuncs.com/?Signature=deadbeef&AccessKeyId=test-id",
    );
    error.cause = Object.assign(new Error("Authorization: Bearer test-secret"), { code: "ECONNRESET" });
    throw error;
  });

  const result = await purgeEsaHomepage(config, {
    attempts: 1,
    sleep: async () => {
      throw new Error("should not retry");
    },
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /不再重试/);
  assert.match(lines[0], /cause\.code=ECONNRESET/);
  assert.match(lines[0], /https:\/\/esa\.cn-hangzhou\.aliyuncs\.com\//);
  assert.doesNotMatch(lines[0], /test-secret|deadbeef|Signature=|AccessKeyId=/);
  assert.doesNotMatch(result.error, /test-secret|deadbeef|Signature=/);
});

test("warmupEsaCache 发送带标准请求头的 GET 请求预热边缘缓存", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    calls.push({ input, init });
    return new Response("<!DOCTYPE html><html>ok</html>", { status: 200 });
  });

  const res = await warmupEsaCache("https://lyjw131.com/");
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, "https://lyjw131.com/");
  assert.equal(calls[0].init.method, "GET");
  assert.ok(calls[0].init.headers["User-Agent"].includes("EsaWarmupBot"));
});

test("warmupEsaCache 妥善处理超时或网络失败", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("connection timeout");
  });

  const res = await warmupEsaCache("https://lyjw131.com/");
  assert.equal(res.ok, false);
  assert.match(res.error, /connection timeout/);
});
