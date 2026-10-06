import { get, put } from "@/lib/cache";
import { repoIdFromUrl } from "@/lib/github-repo";
import { site } from "@/lib/site";

import { ok, skipMissing, type Job, type JobResult } from "../job";

// 须与 .github/workflows/avatar-sync.yml 同步：头像地址、标记文件路径和哈希算法都要和 Action 一致，否则两边永远对不上。
export const AVATAR_URL = `https://avatars.githubusercontent.com/u/${site.githubId}?s=512`;
export const MARKER_PATH = ".github/github-avatar.sha256";
const WORKFLOW_FILE = "avatar-sync.yml";

const DISPATCHED_KEY = "avatar-watch:dispatched:v1";
// Action 提交失败时标记文件不会更新；同一个哈希在这段时间内只触发一次，不让每轮都再跑一次失败的 Action。
export const REDISPATCH_AFTER_MS = 6 * 60 * 60_000;

export type AvatarWatchDeps = {
  fetch: typeof fetch;
  token: string;
  memo: { get(key: string): Promise<string | undefined>; put(key: string, value: string, ttlMs: number): Promise<void> };
};

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function avatarHash(deps: AvatarWatchDeps): Promise<string> {
  const response = await deps.fetch(AVATAR_URL, { redirect: "manual" });
  const type = response.headers.get("content-type") ?? "";
  if (response.status !== 200 || !type.startsWith("image/")) {
    throw new Error(`GitHub 头像响应异常：${response.status} ${type}`);
  }
  return sha256Hex(await response.arrayBuffer());
}

function githubHeaders(token: string, accept: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, Accept: accept, "User-Agent": "lyjwpage", "X-GitHub-Api-Version": "2022-11-28" };
}

async function markerHash(deps: AvatarWatchDeps, owner: string, name: string): Promise<string> {
  const response = await deps.fetch(
    `https://api.github.com/repos/${owner}/${name}/contents/${MARKER_PATH}?ref=main`,
    { headers: githubHeaders(deps.token, "application/vnd.github.raw+json") },
  );
  if (!response.ok) throw new Error(`读取 ${MARKER_PATH} 失败：HTTP ${response.status}`);
  return (await response.text()).trim();
}

async function dispatch(deps: AvatarWatchDeps, owner: string, name: string): Promise<void> {
  const response = await deps.fetch(
    `https://api.github.com/repos/${owner}/${name}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: "POST",
      headers: { ...githubHeaders(deps.token, "application/vnd.github+json"), "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main" }),
    },
  );
  if (!response.ok) throw new Error(`触发 ${WORKFLOW_FILE} 失败：HTTP ${response.status}`);
}

export async function watchAvatar(deps: AvatarWatchDeps): Promise<JobResult> {
  const { owner, name } = repoIdFromUrl(site.repo);
  const [current, recorded] = await Promise.all([avatarHash(deps), markerHash(deps, owner, name)]);
  if (current === recorded) return ok();
  if ((await deps.memo.get(DISPATCHED_KEY)) === current) return ok("dispatch pending");
  await dispatch(deps, owner, name);
  await deps.memo.put(DISPATCHED_KEY, current, REDISPATCH_AFTER_MS);
  return ok("dispatched");
}

export const avatarWatchJob: Job = {
  name: "avatar-watch",
  everyMinutes: 15,
  offset: 6,
  maxRuntimeMinutes: 1,
  async run({ env }) {
    const token = env.GITHUB_DISPATCH_TOKEN?.trim();
    if (!token) return skipMissing("avatar-watch", ["GITHUB_DISPATCH_TOKEN"]);
    return watchAvatar({ fetch: (input, init) => fetch(input, init), token, memo: { get: (key) => get<string>(key), put } });
  },
};
