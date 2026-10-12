import { appendFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export const ATTEMPTS = 30;
export const INTERVAL_MS = 10_000;

const SHA = /^[a-f0-9]{40}$/;

// 域名已答出以这次 sha 为祖先的更新提交时让位（superseded）：那次部署有自己的跑次去刷新和通知，这次再等只会超时失败。
export async function waitForSiteVersion({
  origins,
  expected,
  servedCommit,
  isAncestor,
  sleep,
  attempts = ATTEMPTS,
  intervalMs = INTERVAL_MS,
}) {
  const verdicts = new Map();
  for (const origin of origins) {
    for (let attempt = 1; ; attempt += 1) {
      const commit = await servedCommit(origin);
      if (commit === expected) break;
      if (commit && SHA.test(commit)) {
        let newer = verdicts.get(commit);
        if (newer === undefined) {
          newer = await isAncestor(expected, commit);
          if (newer !== null) verdicts.set(commit, newer);
        }
        if (newer) return { status: "superseded", origin, commit };
      }
      if (attempt >= attempts) return { status: "timeout", origin, commit };
      await sleep(intervalMs);
    }
  }
  return { status: "live" };
}

async function servedCommit(origin) {
  try {
    const response = await fetch(`${origin}/api/version`, {
      headers: { "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return typeof body?.commit === "string" ? body.commit : null;
  } catch {
    return null;
  }
}

function githubIsAncestor({ apiUrl, repository, token }) {
  return async (base, head) => {
    try {
      const response = await fetch(`${apiUrl}/repos/${repository}/compare/${base}...${head}?per_page=1`, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        console.log(`::warning::Comparing ${base}...${head} failed with HTTP ${response.status}`);
        return null;
      }
      return (await response.json()).status === "ahead";
    } catch (error) {
      console.log(`::warning::Comparing ${base}...${head} failed: ${error}`);
      return null;
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await waitForSiteVersion({
    origins: process.argv.slice(2),
    expected: process.env.EXPECTED_SHA,
    servedCommit,
    isAncestor: githubIsAncestor({
      apiUrl: process.env.GITHUB_API_URL ?? "https://api.github.com",
      repository: process.env.GITHUB_REPOSITORY,
      token: process.env.GH_TOKEN,
    }),
    sleep: delay,
  });
  if (result.status === "timeout") {
    console.log(`::error::${result.origin} did not serve the expected commit (last saw ${result.commit ?? "nothing"})`);
    process.exit(1);
  }
  if (result.status === "superseded") {
    console.log(`::notice::${result.origin} already serves newer commit ${result.commit}; its own run purges and notifies`);
  }
  appendFileSync(process.env.GITHUB_OUTPUT, `live=${result.status === "live"}\n`);
}
