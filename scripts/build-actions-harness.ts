import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";

import { packageBuild, runPublish } from "./build-actions.ts";

export const RUN_ID = "0123456789abcdef0123456789abcdef";
export const BASE_SHA = "b".repeat(40);
export const ORIGIN = "https://worker.test";
export const JWT = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl";
export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);
export const GIT_ENV = { ...(Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))) as NodeJS.ProcessEnv), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

export function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false", ...args], { cwd, env: GIT_ENV, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

export function tempDir(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "build-actions-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function writeFile(root: string, rel: string, content: string | Buffer, mode?: number) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  if (mode) fs.chmodSync(file, mode);
}

export function parseOutputs(text: string) {
  const values: Record<string, string> = {};
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const match = /^(\w+)<<(\S+)$/.exec(lines[index] ?? "");
    if (!match) continue;
    const end = lines.indexOf(match[2] ?? "", index + 1);
    values[match[1] ?? ""] = lines.slice(index + 1, end).join("\n");
    index = end;
  }
  return values;
}

type Fixture = ReturnType<typeof repo>;
type Entry = { method: string | undefined; url: string; authorization: string | undefined; body: string };
export type Respond = (entry: Entry) => { status?: number; json?: unknown } | undefined;

export function repo(t: TestContext) {
  const root = tempDir(t);
  const origin = path.join(root, "origin");
  writeFile(origin, "src/keep.ts", "export const keep = 1;\n");
  writeFile(origin, "src/edit.ts", "export const value = 1;\n");
  writeFile(origin, "src/remove.ts", "export const gone = true;\n");
  writeFile(origin, "src/tool.sh", "#!/bin/sh\necho tool\n", 0o644);
  writeFile(origin, "public/logo.bin", Buffer.from([0, 1, 2, 3, 255, 0]));
  writeFile(origin, `builds/${RUN_ID}.md`, "# Plan\n");
  git(origin, "init", "-q");
  git(origin, "add", "-A");
  git(origin, "commit", "-q", "-m", "plan");
  const planSha = git(origin, "rev-parse", "HEAD");
  const checkout = path.join(root, "checkout");
  const work = path.join(root, "work");
  git(root, "clone", "-q", origin, checkout);
  git(root, "clone", "-q", origin, work);
  const gitDir = path.join(root, "build-git");
  fs.cpSync(path.join(checkout, ".git"), gitDir, { recursive: true });
  return { root, checkout, work, gitDir, planSha, out: path.join(root, "out") };
}

export async function server(t: TestContext, respond: Respond = () => ({})) {
  const requests: Entry[] = [];
  const instance = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const entry: Entry = { method: req.method, url: req.url ?? "", authorization: req.headers.authorization, body: Buffer.concat(chunks).toString("utf8") };
    requests.push(entry);
    if (entry.url.startsWith("/oidc")) {
      const ok = req.headers.authorization === "bearer request-token";
      res.writeHead(ok ? 200 : 403, { "Content-Type": "application/json" });
      res.end(JSON.stringify(ok ? { value: JWT } : {}));
      return;
    }
    const { status = 200, json = { accepted: true } } = respond(entry) ?? {};
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(json));
  });
  await new Promise<void>((resolve) => instance.listen(0, "127.0.0.1", () => resolve()));
  t.after(() => instance.close());
  const base = `http://127.0.0.1:${(instance.address() as AddressInfo).port}`;
  const logs: string[] = [];
  const sleeps: number[] = [];
  const io = {
    fetch: (url: string, init?: RequestInit) => fetch(String(url).replace(ORIGIN, base), init),
    log: (line: string) => { logs.push(line); },
    sleep: async (ms: number) => { sleeps.push(ms); },
    write: () => {},
  };
  const workerRequests = () => requests.filter((entry) => !entry.url.startsWith("/oidc"));
  return { base, requests, workerRequests, logs, sleeps, io };
}

export function publishEnv(t: TestContext, base: string, extra: Record<string, string | undefined> = {}) {
  const dir = tempDir(t);
  return {
    RUN_ID,
    BASE_SHA,
    CALLBACK_ORIGIN: ORIGIN,
    IMPLEMENT_RESULT: "success",
    ACTIONS_ID_TOKEN_REQUEST_URL: `${base}/oidc?api-version=2.0`,
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-token",
    GITHUB_STEP_SUMMARY: path.join(dir, "summary.md"),
    GITHUB_OUTPUT: path.join(dir, "output"),
    ...extra,
  };
}

export async function packageAndPublish(t: TestContext, fixture: Fixture, { gitDir = fixture.gitDir, respond, env: extra }: { gitDir?: string | null; respond?: Respond; env?: Record<string, string | undefined> } = {}) {
  const harness = await server(t, respond);
  packageBuild({ cwd: fixture.checkout, out: fixture.out, gitDir, planCommitSha: fixture.planSha, io: harness.io });
  const env = publishEnv(t, harness.base, extra);
  const ok = await runPublish({ env, work: fixture.work, artifact: fixture.out, io: harness.io });
  return { ...harness, ok, env };
}

type Body = { baseSha: string; message: string; files: { path: string; mode: string; content: string }[]; deletions: string[]; caption?: string; content?: string; blocked?: boolean; body?: string };

export const workerPath = (entry: Entry) => entry.url.split("?")[0];
export const body = (entry: Entry | undefined) => JSON.parse((entry as Entry).body) as Body;
