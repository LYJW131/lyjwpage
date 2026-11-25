import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { childEnv, filterGrepOutput, forbiddenRead, inside, prepareInside, readAllowed, realInside, sandboxed, writeInside } from "./verify-agent/guard.ts";
import { createOidcAuthFetch, fetchGitHubOidcToken, installOidcAnthropicProvider, OAUTH_API_BETA_HEADER, parseOidcRequest, resolveVerifyAuth, type AnthropicOidcSdk } from "./verify-agent/oidc.ts";
import { compareBaseTool, docsSyncTool, prDiffTool, removedIdentifiers } from "./verify-agent/tools.ts";

test("childEnv：凭据、ANTHROPIC_* 与 GitHub 的输出文件都不给子进程，TMPDIR 换成 runner 的临时目录", () => {
  const env = childEnv(
    {
      ANTHROPIC_API_KEY: "a",
      ANTHROPIC_FEDERATION_RULE_ID: "fdrl_1",
      ANTHROPIC_ORGANIZATION_ID: "org_1",
      GITHUB_TOKEN: "b",
      GH_TOKEN: "c",
      ACTIONS_RUNTIME_URL: "d",
      ACTIONS_ID_TOKEN_REQUEST_URL: "e",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "t",
      GITHUB_OUTPUT: "/out",
      GITHUB_ENV: "/env",
      GITHUB_STEP_SUMMARY: "/sum",
      CLAUDE_CODE_OAUTH_TOKEN: "f",
      PATH: "/bin",
      HOME: "/home/runner",
      TMPDIR: "/elsewhere",
    },
    "/tmp/x",
  );
  assert.deepEqual(env, { TMPDIR: "/tmp/x", PATH: "/bin", HOME: "/home/runner" });
});

test("inside：只认目录本身与它下面的路径，../ 与同前缀的兄弟目录都不算", () => {
  assert.equal(inside("/r/out", "/r/out"), true);
  assert.equal(inside("/r/out", "/r/out/work/a.txt"), true);
  assert.equal(inside("/r/out", "/r/out-evil/a.txt"), false);
  assert.equal(inside("/r/out", "/r/out/../a.txt"), false);
  assert.equal(inside("/r/out", "/etc/passwd"), false);
});

test("forbiddenRead：拦 /proc、/sys、gh 凭据与本地密钥文件，不误拦普通源码", () => {
  for (const target of ["/proc/self/environ", "/proc", "/sys/kernel", "/home/u/.config/gh/hosts.yml", "/home/u/.git-credentials", "/r/.env", "/r/.env.local", "/r/workers/core/.dev.vars"])
    assert.equal(forbiddenRead(target), true, target);
  for (const target of ["/r/src/env.ts", "/r/.envrc-notes/readme.md", "/r/scripts/verify-agent.ts", "/r/processes/a.ts"]) assert.equal(forbiddenRead(target), false, target);
});

test("sandboxed：有 bwrap 时整条命令进 PID 命名空间，只绑可写目录；单引号转义后命令原样", () => {
  assert.equal(sandboxed("echo hi", ["/w"], false), "echo hi");
  const wrapped = sandboxed("echo 'a b'", ["/w", "/t"], true);
  assert.match(wrapped, /^exec bwrap --ro-bind \/ \/ --bind '\/w' '\/w' --bind '\/t' '\/t' .*--unshare-pid --die-with-parent bash -c /);
  assert.ok(wrapped.endsWith(`bash -c 'echo '\\''a b'\\'''`));
});

test("符号链接：指向 /proc/self/environ 的链接照样拦，写守卫按真实路径判、链接指出产物目录就拒", (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "verify-agent-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const out = path.join(root, "out");
  fs.mkdirSync(path.join(out, "work"), { recursive: true });
  fs.writeFileSync(path.join(root, "victim.txt"), "x");
  fs.symlinkSync("/proc/self/environ", path.join(root, "env-link"));
  fs.symlinkSync(path.join(root, "victim.txt"), path.join(out, "work", "file-link"));
  fs.symlinkSync(root, path.join(out, "work", "dir-link"));

  assert.equal(forbiddenRead(path.join(root, "env-link")), true);
  assert.equal(realInside(out, path.join(out, "work", "a.txt")), true);
  assert.equal(realInside(out, path.join(out, "work", "new", "b.txt")), true);
  assert.equal(realInside(out, path.join(out, "work", "file-link")), false);
  assert.equal(realInside(out, path.join(out, "work", "dir-link", "victim.txt")), false);
  assert.equal(realInside(out, path.join(out, "work", "dir-link", "new.txt")), false);
});

test("readAllowed：只许读点名的根目录；从 / 或 /proc 递归、根目录里的 .env 与指出根目录的链接都拒", (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "verify-agent-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.symlinkSync(os.homedir(), path.join(repo, "home-link"));
  const roots = [repo];

  assert.equal(readAllowed(roots, repo), true);
  assert.equal(readAllowed(roots, path.join(repo, "src", "a.ts")), true);
  for (const target of ["/", "/proc", "/proc/1/environ", root, path.join(repo, ".env.local"), path.join(repo, "home-link"), path.join(repo, "home-link", ".ssh")])
    assert.equal(readAllowed(roots, target), false, target);
});

test("removedIdentifiers：只收 diff 里删掉、新代码里又没出现的标识符", () => {
  const patch = ["--- a/x.ts", "+++ b/x.ts", "-const OLD_LIMIT = 5;", "-useOldThing(verify-ab.yml)", "+const NEW_LIMIT = 5;", "+useOldThing()"].join("\n");
  assert.deepEqual(removedIdentifiers(patch).sort(), ["OLD_LIMIT", "verify-ab.yml"]);
});

test("filterGrepOutput：递归搜到 .env*、.dev.vars 里的行去掉（路径里带「-数字-」也认得出），普通文件的命中与上下文行保留", () => {
  const out = ["src/a.ts:3: MARK", "envprobe/.env.local:1: MARK=1", "workers/core/.dev.vars-2- MARK", "x-1-y/.env.local:1: MARK", "x-1-y/.env.local-2- MARK", "README.md-4- context", "无法解析的一行"].join("\n");
  const { text, dropped } = filterGrepOutput(out, "/repo");
  assert.equal(dropped, 4);
  assert.equal(text, ["src/a.ts:3: MARK", "README.md-4- context", "无法解析的一行"].join("\n"));
});

test("docs_sync：搜 HEAD 里的文字，工作区的 .claude/ 被换回目标分支的版本也不影响", async (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "docs-sync-"));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: repo });
  git("init", "-q");
  fs.mkdirSync(path.join(repo, ".claude"));
  fs.writeFileSync(path.join(repo, ".claude/skill.md"), "用 OLD_LIMIT 判断\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  fs.writeFileSync(path.join(repo, ".claude/skill.md"), "用 NEW_LIMIT 判断\n");
  git("commit", "-qam", "head");
  fs.writeFileSync(path.join(repo, ".claude/skill.md"), "用 OLD_LIMIT 判断\n");
  const tool = docsSyncTool({ cwd: repo, base: "HEAD~1", tmpDir: repo, run: async () => ({ code: 0, output: "" }), git: (args, dir = repo) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }), workLog: () => null });
  const out = (await tool.execute("1", { keywords: ["OLD_LIMIT", "NEW_LIMIT"], auto: false })).content[0].text;
  assert.match(out, /「OLD_LIMIT」：文档里 0 处/);
  assert.match(out, /「NEW_LIMIT」：1 处\n {2}\.claude\/skill\.md（这次改了）：1:用 NEW_LIMIT 判断/);
});

test("工具里的 git 一律经 ctx.git（runner 把它放进和 bash 同一个沙箱），不自己起 git：cwd 不是仓库也不报错", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "no-repo-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls: string[][] = [];
  const ctx = {
    cwd: dir,
    base: "origin/main",
    tmpDir: dir,
    run: async () => ({ code: 0, output: "" }),
    git: (args: string[]) => (calls.push(args), args[0] === "grep" ? "HEAD:README.md:1:OLD_LIMIT\n" : ""),
    workLog: () => null,
  };
  await prDiffTool(ctx).execute("1", { stat: true });
  await docsSyncTool(ctx).execute("2", { keywords: ["OLD_LIMIT"], auto: false });
  await compareBaseTool(ctx).execute("3", { command: "true" });
  assert.deepEqual(
    calls.map((args) => args[0] === "-C" ? args[2] : args[0]),
    ["diff", "diff", "grep", "rev-parse", "clone", "checkout"],
  );
});

test("writeInside / prepareInside：根目录或其下目录被换成指出去的链接（含悬空的）就拒，预先放好的同名链接删掉重建，不写穿到链接目标", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "write-inside-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const out = path.join(base, "out");
  const outside = path.join(base, "outside");
  fs.mkdirSync(out);
  fs.mkdirSync(outside);
  writeInside(out, path.join(out, "work", "a.log"), "a");
  assert.equal(fs.readFileSync(path.join(out, "work", "a.log"), "utf8"), "a");
  fs.writeFileSync(path.join(outside, "victim"), "keep");
  fs.symlinkSync(path.join(outside, "victim"), path.join(out, "work", "b.log"));
  writeInside(out, path.join(out, "work", "b.log"), "b");
  assert.equal(fs.readFileSync(path.join(outside, "victim"), "utf8"), "keep");
  assert.equal(fs.lstatSync(path.join(out, "work", "b.log")).isSymbolicLink(), false);
  fs.rmSync(path.join(out, "work"), { recursive: true });
  fs.symlinkSync(outside, path.join(out, "work"));
  assert.throws(() => writeInside(out, path.join(out, "work", "c.log"), "c"), /指出了/);
  assert.throws(() => prepareInside(out, path.join(out, "work", "agent-transcript.jsonl")), /指出了/);
  fs.rmSync(path.join(out, "work"));
  fs.symlinkSync(path.join(outside, "made-later"), path.join(out, "work"));
  assert.throws(() => writeInside(out, path.join(out, "work", "d.log"), "d"), /指出了/);
  assert.deepEqual(fs.readdirSync(outside), ["victim"]);
  const linkedRoot = path.join(base, "linked-out");
  fs.symlinkSync(outside, linkedRoot);
  assert.throws(() => writeInside(linkedRoot, path.join(linkedRoot, "work", "e.log"), "e"), /是符号链接/);
  assert.deepEqual(fs.readdirSync(outside), ["victim"]);
});

test("docs_sync：git grep 没命中（退出 1）记 0 处，别的失败记搜索失败、不写成 0 处", async () => {
  const fail = (status: number) => (args: string[]) => {
    if (args[0] !== "grep") return "";
    throw Object.assign(new Error(`git grep 退出 ${status}`), { status });
  };
  const ctx = (git: (args: string[]) => string) => ({ cwd: "/repo", base: "origin/main", tmpDir: "/tmp", run: async () => ({ code: 0, output: "" }), git, workLog: () => null });
  const none = (await docsSyncTool(ctx(fail(1))).execute("1", { keywords: ["OLD_LIMIT"], auto: false })).content[0].text;
  assert.match(none, /「OLD_LIMIT」：文档里 0 处/);
  const broken = (await docsSyncTool(ctx(fail(128))).execute("2", { keywords: ["OLD_LIMIT"], auto: false })).content[0].text;
  assert.match(broken, /「OLD_LIMIT」：搜索失败/);
  assert.doesNotMatch(broken, /0 处/);
});

test("parseOidcRequest 与 fetchGitHubOidcToken：校验 JSON 结构，按已有查询串正确拼 audience 且不重编码原参数", async () => {
  assert.deepEqual(parseOidcRequest('{"url":"https://oidc.example/tok?sig=a+b/c=","token":"t1"}'), {
    url: "https://oidc.example/tok?sig=a+b/c=",
    token: "t1",
  });
  assert.throws(() => parseOidcRequest("not-json"), /合法 JSON/);
  assert.throws(() => parseOidcRequest('{"url":"","token":"t1"}'), /缺少非空/);

  const urls: string[] = [];
  const auths: string[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(String(input));
    auths.push(new Headers(init?.headers).get("authorization") ?? "");
    return new Response(JSON.stringify({ value: "gh-jwt" }), { status: 200 });
  }) as typeof fetch;

  assert.equal(await fetchGitHubOidcToken({ url: "https://oidc.example/tok?sig=a+b/c=", token: "req-1" }, "https://api.anthropic.com", fakeFetch), "gh-jwt");
  assert.equal(await fetchGitHubOidcToken({ url: "https://oidc.example/tok", token: "req-2" }, "https://api.anthropic.com", fakeFetch), "gh-jwt");
  assert.deepEqual(urls, [
    "https://oidc.example/tok?sig=a+b/c=&audience=https%3A%2F%2Fapi.anthropic.com",
    "https://oidc.example/tok?audience=https%3A%2F%2Fapi.anthropic.com",
  ]);
  assert.deepEqual(auths, ["Bearer req-1", "Bearer req-2"]);
});

test("createOidcAuthFetch：注入 Bearer、追加 oauth beta 不覆盖原 beta，401 时失效缓存重新换票并重试一次", async () => {
  let issued = 0;
  let invalidations = 0;
  const sdk: AnthropicOidcSdk = {
    oidcFederationProvider: ({ identityTokenProvider, federationRuleId, organizationId, serviceAccountId, workspaceId, fetch: exchangeFetch }) => async () => {
      const jwt = await identityTokenProvider();
      assert.equal(jwt, "gh-jwt");
      assert.equal(federationRuleId, "fdrl_1");
      assert.equal(organizationId, "org_1");
      assert.equal(serviceAccountId, "svac_1");
      assert.equal(workspaceId, "wrkspc_1");
      const tokenRes = await exchangeFetch("https://api.anthropic.com/v1/oauth/token", { method: "POST" });
      assert.equal(tokenRes.status, 200);
      issued++;
      return { token: `ant-${issued}`, expiresAt: Math.floor(Date.now() / 1000) + 600 };
    },
    TokenCache: class {
      #provider: () => Promise<{ token: string; expiresAt: number | null }>;
      #cached: string | null = null;
      constructor(provider: () => Promise<{ token: string; expiresAt: number | null }>) {
        this.#provider = provider;
      }
      async getToken() {
        if (!this.#cached) this.#cached = (await this.#provider()).token;
        return this.#cached;
      }
      invalidate() {
        invalidations++;
        this.#cached = null;
      }
    },
  };

  const calls: { url: string; auth: string | null; apiKey: string | null; beta: string | null }[] = [];
  let messageAttempts = 0;
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://oidc.example/")) return new Response(JSON.stringify({ value: "gh-jwt" }), { status: 200 });
    if (url === "https://api.anthropic.com/v1/oauth/token") {
      assert.ok(init?.signal instanceof AbortSignal);
      return new Response(JSON.stringify({ access_token: "ok" }), { status: 200 });
    }
    const h = new Headers(init?.headers);
    calls.push({ url, auth: h.get("authorization"), apiKey: h.get("x-api-key"), beta: h.get("anthropic-beta") });
    messageAttempts++;
    if (messageAttempts === 2) return new Response("expired", { status: 401 });
    return new Response("ok", { status: 200 });
  }) as typeof fetch;

  const authFetch = createOidcAuthFetch(
    {
      request: { url: "https://oidc.example/tok?sig=1", token: "req-tok" },
      federationRuleId: "fdrl_1",
      organizationId: "org_1",
      serviceAccountId: "svac_1",
      workspaceId: "wrkspc_1",
    },
    sdk,
    fakeFetch,
  );

  const r1 = await authFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": "stale", "anthropic-beta": "interleaved-thinking-2025-05-14" },
  });
  assert.equal(r1.status, 200);
  const r2 = await authFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "anthropic-beta": `interleaved-thinking-2025-05-14,${OAUTH_API_BETA_HEADER}` },
  });
  assert.equal(r2.status, 200);
  assert.equal(issued, 2);
  assert.equal(invalidations, 1);
  assert.deepEqual(calls, [
    {
      url: "https://api.anthropic.com/v1/messages",
      auth: "Bearer ant-1",
      apiKey: null,
      beta: `interleaved-thinking-2025-05-14,${OAUTH_API_BETA_HEADER}`,
    },
    {
      url: "https://api.anthropic.com/v1/messages",
      auth: "Bearer ant-1",
      apiKey: null,
      beta: `interleaved-thinking-2025-05-14,${OAUTH_API_BETA_HEADER}`,
    },
    {
      url: "https://api.anthropic.com/v1/messages",
      auth: "Bearer ant-2",
      apiKey: null,
      beta: `interleaved-thinking-2025-05-14,${OAUTH_API_BETA_HEADER}`,
    },
  ]);
});

test("installOidcAnthropicProvider：包装 anthropic 提供方的 auth 与 stream/streamSimple 注入 OIDC fetch", async () => {
  let registered: Record<string, unknown> | null = null;
  let streamFetch: unknown = null;
  let streamSimpleFetch: unknown = null;
  const runtime = {
    getProvider: (id: string) =>
      id === "anthropic"
        ? {
            id: "anthropic",
            auth: { apiKey: { name: "orig" }, oauth: { name: "oauth" } },
            stream: (_m: unknown, _c: unknown, opts?: Record<string, unknown>) => {
              streamFetch = opts?.fetch;
              return "stream-res";
            },
            streamSimple: (_m: unknown, _c: unknown, opts?: Record<string, unknown>) => {
              streamSimpleFetch = opts?.fetch;
              return "simple-res";
            },
          }
        : undefined,
    registerNativeProvider: (provider: Record<string, unknown>) => {
      registered = provider;
    },
  };
  const sdk: AnthropicOidcSdk = {
    oidcFederationProvider: () => async () => ({ token: "t", expiresAt: null }),
    TokenCache: class {
      async getToken() {
        return "t";
      }
      invalidate() {}
    },
  };
  installOidcAnthropicProvider(runtime, { request: { url: "https://oidc.example/t", token: "k" }, federationRuleId: "f", organizationId: "o" }, sdk);
  assert.ok(registered);
  const prov = registered as {
    auth: { apiKey: { resolve: () => Promise<{ auth: { headers: Record<string, string> }; source: string }> } };
    stream: (m: unknown, c: unknown, o?: Record<string, unknown>) => unknown;
    streamSimple: (m: unknown, c: unknown, o?: Record<string, unknown>) => unknown;
  };
  const resolved = await prov.auth.apiKey.resolve();
  assert.equal(resolved.source, "oidc federation");
  assert.equal(resolved.auth.headers.Authorization, "Bearer oidc");
  assert.equal(prov.stream({}, {}, {}), "stream-res");
  assert.equal(prov.streamSimple({}, {}, {}), "simple-res");
  assert.equal(typeof streamFetch, "function");
  assert.equal(streamFetch, streamSimpleFetch);
});

test("resolveVerifyAuth：CI 强制文件传凭据、读完即删并清理环境变量，本地仍支持静态 API key", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-auth-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const oidcFile = path.join(dir, "oidc-request");
  const ghFile = path.join(dir, "github-token");
  fs.writeFileSync(oidcFile, JSON.stringify({ url: "https://oidc.example/t?sig=1", token: "req-1" }));
  fs.writeFileSync(ghFile, "gh-tok");

  const ciEnv: Record<string, string | undefined> = {
    CI: "true",
    ANTHROPIC_FEDERATION_RULE_ID: "fdrl_1",
    ANTHROPIC_ORGANIZATION_ID: "org_1",
    ANTHROPIC_SERVICE_ACCOUNT_ID: "svac_1",
    ANTHROPIC_WORKSPACE_ID: "wrkspc_1",
    ACTIONS_ID_TOKEN_REQUEST_URL: "leaked",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "leaked",
  };
  const resolved = resolveVerifyAuth({ provider: "anthropic", oidcRequestFile: oidcFile, githubTokenFile: ghFile }, ciEnv);
  assert.equal(fs.existsSync(oidcFile), false);
  assert.equal(fs.existsSync(ghFile), false);
  assert.equal(ciEnv.ACTIONS_ID_TOKEN_REQUEST_TOKEN, undefined);
  assert.equal(ciEnv.ANTHROPIC_FEDERATION_RULE_ID, undefined);
  assert.deepEqual(resolved, {
    oidc: {
      request: { url: "https://oidc.example/t?sig=1", token: "req-1" },
      federationRuleId: "fdrl_1",
      organizationId: "org_1",
      serviceAccountId: "svac_1",
      workspaceId: "wrkspc_1",
    },
    apiKey: undefined,
    githubToken: "gh-tok",
  });

  assert.throws(
    () =>
      resolveVerifyAuth(
        { provider: "anthropic", federationRuleId: "fdrl_1", organizationId: "org_1" },
        { CI: "true", ACTIONS_ID_TOKEN_REQUEST_URL: "https://oidc.example/t", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "req-1" },
      ),
    /--oidc-request-file/,
  );

  const localEnv: Record<string, string | undefined> = { ANTHROPIC_API_KEY: "sk-local" };
  assert.deepEqual(resolveVerifyAuth({ provider: "anthropic" }, localEnv), { oidc: null, apiKey: "sk-local", githubToken: undefined });
  assert.equal(localEnv.ANTHROPIC_API_KEY, undefined);
});

test("工作流里拿凭据的 verify-agent action 只从先清空、再检出默认分支的 .verify-agent-main 载入，且 OIDC 边界与隔离完整", () => {
  const dir = path.join(import.meta.dirname, "..", ".github", "workflows");
  const files = fs.readdirSync(dir).filter((name) => name.endsWith(".yml"));
  const uses = files.flatMap((name) => [...fs.readFileSync(path.join(dir, name), "utf8").matchAll(/uses: (\S*verify-agent\S*)/g)].map((match) => match[1]));
  assert.deepEqual(uses, ["./.verify-agent-main/.github/actions/verify-agent", "./.verify-agent-main/.github/actions/verify-agent"]);
  const workflow = fs.readFileSync(path.join(dir, "verify.yml"), "utf8");
  const trustedCheckouts = [
    ...workflow.matchAll(
      /run: rm -rf \.verify-agent-main\n(?:\s+env:\n(?:\s+\S+: .*\n)+)?\s+- uses: actions\/checkout@v5\n\s+id: trusted\n\s+if: steps\.clean\.outcome == 'success'\n[\s\S]*?ref: \$\{\{ github\.event\.repository\.default_branch \}\}\n\s+path: \.verify-agent-main\n/g,
    ),
  ];
  const piSteps = [...workflow.matchAll(/uses: \.\/\.verify-agent-main\/\.github\/actions\/verify-agent\n\s+id: pi\n\s+if: steps\.trusted\.outcome == 'success'\n/g)];
  assert.equal(trustedCheckouts.length, 2);
  assert.equal(piSteps.length, 2);
  assert.doesNotMatch(workflow, /claude-code-action|CLAUDE_CODE_OAUTH_TOKEN|secrets\.ANTHROPIC_API_KEY|anthropic-api-key/);
  assert.equal([...workflow.matchAll(/^\s+id-token: write$/gm)].length, 2);
  assert.equal([...workflow.matchAll(/anthropic-federation-rule-id: \$\{\{ vars\.ANTHROPIC_FEDERATION_RULE_ID \}\}/g)].length, 2);
  assert.equal([...workflow.matchAll(/anthropic-organization-id: \$\{\{ vars\.ANTHROPIC_ORGANIZATION_ID \}\}/g)].length, 2);
  // verify 与 judge 里非 verify-agent 的所有命令步骤都应清空 ACTIONS_ID_TOKEN_REQUEST_*
  assert.equal([...workflow.matchAll(/ACTIONS_ID_TOKEN_REQUEST_URL: ""/g)].length, 14);
  assert.equal([...workflow.matchAll(/ACTIONS_ID_TOKEN_REQUEST_TOKEN: ""/g)].length, 14);
  assert.equal(fs.existsSync(path.join(dir, "claude-code-review.yml")), false);
  assert.equal(fs.existsSync(path.join(dir, "claude.yml")), false);

  const action = fs.readFileSync(path.join(import.meta.dirname, "..", ".github", "actions", "verify-agent", "action.yml"), "utf8");
  assert.doesNotMatch(action, /anthropic-api-key/);
  assert.match(action, /umask 077[\s\S]*?set -o noclobber[\s\S]*?oidc-request/);
  assert.match(action, /id: run[\s\S]*?env -u ACTIONS_ID_TOKEN_REQUEST_URL -u ACTIONS_ID_TOKEN_REQUEST_TOKEN[\s\S]*?--oidc-request-file "\$RUNNER_TEMP\/verify-runner\/oidc-request"/);
  assert.match(action, /if: always\(\)[\s\S]*?rm -f "\$RUNNER_TEMP\/verify-runner\/oidc-request"/);
});
