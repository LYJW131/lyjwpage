import assert from "node:assert/strict";
import test from "node:test";

import type Anthropic from "@anthropic-ai/sdk";
import { GOD_CHAT_ANTHROPIC_CONSENT, GOD_CHAT_PASS_TTL_MS, GOD_CHAT_TURNSTILE_ACTION, type GodChatEvent } from "@shared/god-chat";
import { GOD_CHAT_TIERS, GOD_CHAT_TIER_INFO } from "@shared/god-chat-tiers";
import type { Env } from "./runtime.ts";
import type { ChatQuota } from "./chat/quota.ts";
import type { AnthropicEgress } from "./chat/egress.ts";
import type { ChatLog, Transcript } from "./chat/transcripts.ts";
import { binding, deepseekFetch, handleChat, issuePass, modelStream, PASS, unexpected } from "./chat/testing/handler-fixture.ts";

test("各档的 SDK 请求都启用消息级 effort，工具续跑继承强度并在签名 trace 中记录；DeepSeek 两档去掉它不支持的字段", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  for (const tier of GOD_CHAT_TIERS) {
    await t.test(tier, async () => {
      const info = GOD_CHAT_TIER_INFO[tier];
      const deepseek = info.provider === "deepseek";
      const requests: { body: Anthropic.Beta.MessageCreateParamsStreaming; headers: Headers; url: string }[] = [];
      const respond = async (request: Request) => {
        const body = await request.json() as Anthropic.Beta.MessageCreateParamsStreaming;
        requests.push({ body, headers: request.headers, url: request.url });
        return modelStream(body.model, requests.length === 1);
      };
      globalThis.fetch = deepseekFetch(respond);
      const transcripts: Transcript[] = [];
      const env: Env = {
        PUBLIC_STATUS: { readStatus: async () => new Response("unused") },
        AI_DEV: "true",
        CHAT_FORCE_TIER: tier,
        ANTHROPIC_API_KEY: "test-key",
        DEEPSEEK_API_KEY: "test-deepseek",
        TURNSTILE_SECRET_KEY: "test-turnstile",
        EXA_API_KEY: "test-exa",
        CHAT_HISTORY_SECRET: "test-seal",
        ALLOWED_ORIGINS: "https://lyjw.me",
        CHAT_QUOTA: binding<ChatQuota>({
          admitVisitor: async () => "ok" as const,
          admitTier: async () => tier,
        }),
        ANTHROPIC_EGRESS: binding<AnthropicEgress>({ colo: async () => "KIX", fetch: respond }),
        CHAT_LOG: binding<ChatLog>({ record: async (entry) => { transcripts.push(entry); } }),
      };
      const response = await handleChat(new Request("https://api.test/api/chat", {
        method: "POST", body: JSON.stringify({ humanPass: PASS, anthropic: "allow", messages: [{ role: "user", content: "What's the timezone?" }] }),
      }), env, {
        readStatus: async () => Response.json({ ok: true, data: { timezone: "Asia/Singapore" } }),
        readDoc: async () => new Response("unused"),
      });
      const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as GodChatEvent);
      assert.equal(requests.length, 2);
      for (const { body, headers, url } of requests) {
        assert.equal(body.model, info.model);
        assert.equal(new URL(url).hostname, deepseek ? "api.deepseek.com" : "api.anthropic.com");
        assert.ok(body.tools?.every((tool) => !("name" in tool) || !["draft_github_issue", "start_design", "propose_build"].includes(tool.name)));
        assert.equal(body.output_config, undefined);
        assert.equal(body.mcp_servers, undefined);
        assert.ok(body.tools?.some((tool) => "name" in tool && tool.name === "web_search" && !("type" in tool)));
        assert.ok(body.tools?.some((tool) => "name" in tool && tool.name === "web_fetch"));
        assert.ok(!headers.get("anthropic-beta")?.includes("mcp-client-2025-11-20"));
        assert.deepEqual(body.thinking, info.thinking ? { type: "adaptive" } : { type: "disabled" });
        assert.deepEqual(body.messages.filter((m) => m.role === "system"), [{ role: "system", content: [], output_config: { effort: info.effort } }]);
        const domain = body.tools?.filter((tool) => "name" in tool && ["anime_search", "game_search"].includes(tool.name)) ?? [];
        assert.equal(domain.length, 2);
        assert.equal(headers.get("anthropic-version"), "2026-10-21");
        assert.equal(headers.get("authorization"), `Bearer ${deepseek ? env.DEEPSEEK_API_KEY : env.ANTHROPIC_API_KEY}`);
        assert.equal(headers.get("x-api-key"), null);
        if (deepseek) {
          assert.ok(body.tools?.every((tool) => tool.type !== "tool_search_tool_bm25_20251119"));
          assert.ok(domain.every((tool) => "defer_loading" in tool && tool.defer_loading === false));
          assert.equal(headers.get("anthropic-beta"), null);
          assert.equal("fallbacks" in body, false);
        } else {
          assert.ok(body.tools?.some((tool) => tool.type === "tool_search_tool_bm25_20251119"));
          assert.ok(domain.every((tool) => "defer_loading" in tool && tool.defer_loading));
          assert.ok(headers.get("anthropic-beta")?.includes("mid-conversation-output-config-2026-07-01"));
          assert.equal(headers.get("anthropic-beta")?.includes("server-side-fallback-2026-07-01"), info.serverFallback);
        }
      }
      const replayed = requests[1].body.messages.slice(0, requests[0].body.messages.length);
      assert.deepEqual(replayed, requests[0].body.messages);
      assert.ok(events.some((e) => e.type === "text" && e.text === "Done."));
      const seal = events.find((e) => e.type === "seal");
      assert.ok(seal?.type === "seal");
      assert.equal(seal.trace?.effort, info.effort);
      assert.equal(transcripts.length, 1);
      assert.deepEqual(transcripts[0].messages.map((m) => m.content), ["What's the timezone?"]);
      assert.equal(transcripts[0].outcome, "complete");
      assert.equal(transcripts[0].tier, tier);
      assert.ok(transcripts[0].reply.includes("Done."));
      assert.equal(transcripts[0].trace?.effort, info.effort);
    });
  }
});

test("关闭限流和强制模型只有显式 AI 开发或预览开关才生效", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });

  for (const flags of [{}, { AI_DEV: "false", PREVIEW_WORKER: "false" }, { AI_DEV: "true" }, { PREVIEW_WORKER: "true" }]) {
    const dev = flags.AI_DEV === "true" || flags.PREVIEW_WORKER === "true";
    const enforced: boolean[] = [];
    const tiers: string[] = [];
    const response = await handleChat(new Request("https://ai.test/api/chat", {
      method: "POST", body: JSON.stringify({ humanPass: PASS, anthropic: "allow", messages: [{ role: "user", content: "hello" }] }),
    }), {
      ...flags,
      PUBLIC_STATUS: { readStatus: async () => new Response("unused") },
      ANTHROPIC_API_KEY: "test-key",
      DEEPSEEK_API_KEY: "test-deepseek",
      TURNSTILE_SECRET_KEY: "test-turnstile",
      CHAT_HISTORY_SECRET: "test-seal",
      ALLOWED_ORIGINS: "https://lyjw.me",
      CHAT_RATE_LIMIT: "off",
      CHAT_FORCE_TIER: "fable",
      CHAT_QUOTA: binding<ChatQuota>({
        admitVisitor: async (_ip, enforce) => { enforced.push(enforce ?? true); return "ok" as const; },
        admitTier: async (_ip, tier) => { tiers.push(tier); return null; },
      }),
    }, {
      readStatus: async () => new Response("unused"),
      readDoc: async () => new Response("unused"),
    });
    assert.equal(response.status, 429);
    await response.text();
    assert.deepEqual(enforced, [!dev]);
    assert.deepEqual(tiers, dev ? ["fable"] : ["flash"]);
  }
});

test("选 Claude 阵容时 Clef 判的杂鱼档由 Haiku 出场，额度按 claude 阵容扣", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const seen: { visitor?: string; tier?: [string, string | undefined] } = {};
  const response = await handleChat(new Request("https://ai.test/api/chat", {
    method: "POST", body: JSON.stringify({ humanPass: PASS, anthropic: "allow", lineup: "claude", messages: [{ role: "user", content: "hello" }] }),
  }), {
    PUBLIC_STATUS: { readStatus: async () => new Response("unused") },
    ANTHROPIC_API_KEY: "test-key",
    DEEPSEEK_API_KEY: "test-deepseek",
    TURNSTILE_SECRET_KEY: "test-turnstile",
    CHAT_HISTORY_SECRET: "test-seal",
    ALLOWED_ORIGINS: "https://lyjw.me",
    AI_DEV: "true",
    CHAT_FORCE_TIER: "flash",
    CHAT_QUOTA: binding<ChatQuota>({
      admitVisitor: async (_ip, _enforce, lineup) => { seen.visitor = lineup; return "ok" as const; },
      admitTier: async (_ip, wanted, _enforce, _allow, lineup) => { seen.tier = [wanted, lineup]; return null; },
    }),
  }, { readStatus: async () => new Response("unused"), readDoc: async () => new Response("unused") });
  assert.equal(response.status, 429);
  await response.text();
  assert.equal(seen.visitor, "claude");
  assert.deepEqual(seen.tier, ["haiku", "claude"]);
});

test("开发环境强制 haiku 时额度预检按 claude 阵容算，不被请求里的 DeepSeek 阵容挡住", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const seen: (string | undefined)[] = [];
  const response = await handleChat(new Request("https://ai.test/api/chat", {
    method: "POST", body: JSON.stringify({ humanPass: PASS, anthropic: "allow", lineup: "deepseek", messages: [{ role: "user", content: "hello" }] }),
  }), {
    PUBLIC_STATUS: { readStatus: async () => new Response("unused") },
    ANTHROPIC_API_KEY: "test-key",
    DEEPSEEK_API_KEY: "test-deepseek",
    TURNSTILE_SECRET_KEY: "test-turnstile",
    CHAT_HISTORY_SECRET: "test-seal",
    ALLOWED_ORIGINS: "https://lyjw.me",
    AI_DEV: "true",
    CHAT_FORCE_TIER: "haiku",
    CHAT_QUOTA: binding<ChatQuota>({
      admitVisitor: async (_ip, _enforce, lineup) => { seen.push(lineup); return "ok" as const; },
      admitTier: async (_ip, _wanted, _enforce, _allow, lineup) => { seen.push(lineup); return null; },
    }),
  }, { readStatus: async () => new Response("unused"), readDoc: async () => new Response("unused") });
  await response.text();
  assert.deepEqual(seen, ["claude", "claude"]);
});

test("DeepSeek 阵容里 Clef 选了神：没表态回 409 不扣神档名额，这一条拒绝就改由先知答，同意了照常给神", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const ask = async (anthropic?: string) => {
    const wanted: string[] = [];
    const response = await handleChat(new Request("https://ai.test/api/chat", {
      method: "POST", body: JSON.stringify({ humanPass: PASS, ...(anthropic && { anthropic }), messages: [{ role: "user", content: "What is consciousness?" }] }),
    }), {
      PUBLIC_STATUS: { readStatus: async () => new Response("unused") },
      ANTHROPIC_API_KEY: "test-key",
      DEEPSEEK_API_KEY: "test-deepseek",
      TURNSTILE_SECRET_KEY: "test-turnstile",
      CHAT_HISTORY_SECRET: "test-seal",
      ALLOWED_ORIGINS: "https://lyjw.me",
      AI_DEV: "true",
      CHAT_FORCE_TIER: "fable",
      CHAT_QUOTA: binding<ChatQuota>({ admitVisitor: async () => "ok" as const, admitTier: async (_ip, tier) => { wanted.push(tier); return null; } }),
    }, { readStatus: async () => new Response("unused"), readDoc: async () => new Response("unused") });
    const body = await response.json() as { code?: string };
    return { status: response.status, code: body.code, wanted };
  };
  assert.deepEqual(await ask(), { status: 409, code: GOD_CHAT_ANTHROPIC_CONSENT, wanted: [] });
  assert.deepEqual((await ask("deny")).wanted, ["think"]);
  assert.deepEqual((await ask("allow")).wanted, ["fable"]);
});

test("没有有效通行证就要 Turnstile：验过后下发通行证，通行证用掉一半才换新，过期或伪造回 403", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const verified: string[] = [];
  globalThis.fetch = deepseekFetch(
    async (request) => modelStream((await request.json() as { model: string }).model, false),
    async (_input, init) => {
      const token = new URLSearchParams(String(init?.body)).get("response") ?? "";
      verified.push(token);
      return Response.json({ success: token === "good", hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
    },
  );
  const env: Env = {
    PUBLIC_STATUS: { readStatus: async () => new Response("unused") },
    ANTHROPIC_API_KEY: "test-key",
    DEEPSEEK_API_KEY: "test-deepseek",
    TURNSTILE_SECRET_KEY: "test-turnstile",
    CHAT_HISTORY_SECRET: "test-seal",
    ALLOWED_ORIGINS: "https://lyjw.me",
    AI_DEV: "true",
    CHAT_FORCE_TIER: "flash",
    CHAT_QUOTA: binding<ChatQuota>({ admitVisitor: async () => "ok" as const, admitTier: async () => "flash" as const }),
  };
  const io = { readStatus: async () => new Response("unused"), readDoc: async () => new Response("unused") };
  const ask = async (proof: Record<string, string>) => {
    const response = await handleChat(new Request("https://ai.test/api/chat", {
      method: "POST", body: JSON.stringify({ ...proof, messages: [{ role: "user", content: "hello" }] }),
    }), env, io);
    const text = await response.text();
    return { status: response.status, events: response.ok ? text.trim().split("\n").map((line) => JSON.parse(line) as GodChatEvent) : [], body: response.ok ? undefined : JSON.parse(text) as { code?: string } };
  };
  const passOf = (events: GodChatEvent[]) => events.find((event) => event.type === "pass");

  const fresh = await ask({ turnstileToken: "good" });
  assert.equal(fresh.status, 200);
  const issued = passOf(fresh.events);
  assert.ok(issued?.type === "pass");
  assert.equal(fresh.events[0].type, "pass");

  assert.equal((await ask({ turnstileToken: "bad" })).status, 403);
  verified.length = 0;
  const reused = await ask({ humanPass: issued.pass });
  assert.equal(reused.status, 200);
  assert.equal(passOf(reused.events), undefined);
  assert.deepEqual(verified, []);

  const halfUsed = (await issuePass("test-seal", Date.now() - GOD_CHAT_PASS_TTL_MS / 2 - 1000)).pass;
  assert.ok(passOf((await ask({ humanPass: halfUsed })).events));

  const expired = (await issuePass("test-seal", Date.now() - GOD_CHAT_PASS_TTL_MS - 1000)).pass;
  const stale = await ask({ humanPass: expired });
  assert.equal(stale.status, 403);
  assert.equal(stale.body?.code, "human_pass_expired");
  assert.equal((await ask({ humanPass: (await issuePass("other-secret")).pass })).status, 403);
});
