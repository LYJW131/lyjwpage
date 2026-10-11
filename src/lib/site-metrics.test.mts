import assert from "node:assert/strict";
import test from "node:test";
import { fetchSiteAnalytics, parseSiteAnalyticsSources, parseSitePageviews } from "./site-analytics.ts";
import { fetchSiteDeployments, parseActiveSiteDeployment, parseSiteBuild } from "./site-deployments.ts";

const pageviews = (count: number) => ({ data: { viewer: { accounts: [{ summary: [{ count }] }] } } });
const sources = parseSiteAnalyticsSources(JSON.stringify({ "lyjw.me": "a".repeat(32), "lyjw131.com": "b".repeat(32) }));
const stamp = "2026-10-10T12:00:00Z";
const build = (id = "one", sha = "a".repeat(40)) => ({
  build_uuid: id,
  created_on: stamp,
  running_on: stamp,
  stopped_on: "2026-10-10T12:01:30Z",
  status: "stopped",
  build_outcome: "success",
  build_trigger_metadata: { branch: "main", commit_hash: sha, commit_message: "Deploy\nprivate detail", environment_variables: { SECRET: "not-public" } },
});
const active = (versions = [{ version_id: "version-one", percentage: 100 }]) =>
  ({ success: true, result: { deployments: [{ created_on: stamp, versions }] } });

test("analytics requires both production domains and rejects partial or malformed results", () => {
  assert.throws(() => parseSiteAnalyticsSources(JSON.stringify({ "lyjw.me": "a".repeat(32) })));
  assert.equal(parseSitePageviews(pageviews(31)), 31);
  assert.equal(parseSitePageviews({ data: { viewer: { accounts: [{ summary: [] }] } } }), 0);
  for (const raw of [{ errors: [{}], ...pageviews(1) }, pageviews(-1), pageviews(0.5), {}, { data: { viewer: { accounts: [] } } }]) {
    assert.throws(() => parseSitePageviews(raw));
  }
});

test("analytics totals pageviews from disjoint host filters, never visits or Worker requests", async () => {
  const requests: Record<string, unknown>[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body.variables);
    assert.match(body.query, /requestHost: \$host/);
    assert.match(body.query, /datetime_lt: \$end/);
    assert.doesNotMatch(body.query, /dimensions|visits|workersInvocations/);
    return Response.json(pageviews(body.variables.host === "lyjw.me" ? 23 : 41));
  };
  const now = Date.parse("2026-10-11T08:00:00Z");
  const result = await fetchSiteAnalytics("account", "token", sources, now, fetcher);
  assert.equal(result.pageviews, 64);
  assert.equal(result.start, Date.parse("2026-10-04T00:00:00Z"));
  assert.equal(result.end, Date.parse("2026-10-11T00:00:00Z"));
  assert.equal(requests.length, 2);
  await assert.rejects(fetchSiteAnalytics("account", "token", [sources[0], sources[0]], now, fetcher));
  await assert.rejects(fetchSiteAnalytics("account", "token", sources, now, async () => Response.json({ errors: [{}] })));
});

test("build parsing projects public fields and measures running-to-stopped duration", () => {
  const parsed = parseSiteBuild(build());
  assert.equal(parsed.buildDurationMs, 90_000);
  assert.equal(parsed.commit?.message, "Deploy");
  assert.doesNotMatch(JSON.stringify(parsed), /SECRET|not-public|private detail/);
  assert.equal(parseSiteBuild({ ...build(), status: "running", stopped_on: null }).state, "BUILDING");
  assert.equal(parseSiteBuild({ ...build(), build_outcome: "fail" }).state, "ERROR");
  assert.equal(parseSiteBuild({ ...build(), stopped_on: "2026-10-09T00:00:00Z" }).buildDurationMs, null);
});

test("active deployment respects API order and rejects invalid traffic allocations", () => {
  const raw = active();
  raw.result.deployments.push({ created_on: "2026-10-11T00:00:00Z", versions: [{ version_id: "not-active", percentage: 100 }] });
  assert.equal(parseActiveSiteDeployment(raw)?.versions[0].id, "version-one");
  assert.throws(() => parseActiveSiteDeployment(active([{ version_id: "one", percentage: 40 }])));
  assert.throws(() => parseActiveSiteDeployment(active([{ version_id: "one", percentage: 50 }, { version_id: "one", percentage: 50 }])));
});

test("latest successful build is not mistaken for deployed production or a rollback", async () => {
  const fetcher: typeof fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/site/deployments")) return Response.json(active());
    if (path.includes("/builds/workers/")) return Response.json({ success: true, result: [build("new-build", "b".repeat(40))] });
    if (path.endsWith("/builds/builds")) return Response.json({ success: true, result: { builds: { "version-one": build("old-build") } } });
    throw new Error("Unexpected endpoint");
  };
  const value = await fetchSiteDeployments("account", "c".repeat(32), "token", Date.now(), fetcher);
  assert.equal(value.production?.commit?.sha, "a".repeat(40));
  assert.equal(value.recent[0].commit?.sha, "b".repeat(40));
});

test("split deployments do not fabricate one production commit", async () => {
  const fetcher: typeof fetch = async (url) => {
    if (String(url).includes("/site/deployments")) return Response.json(active([
      { version_id: "one", percentage: 60 }, { version_id: "two", percentage: 40 },
    ]));
    return Response.json({ success: true, result: [build()] });
  };
  const value = await fetchSiteDeployments("account", "c".repeat(32), "token", Date.now(), fetcher);
  assert.equal(value.production, null);
  assert.equal(value.activeVersions.length, 2);
});

test("a fully routed version without a build record becomes its own production row, not the newest build", async () => {
  const fetcher: typeof fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/site/deployments")) return Response.json(active());
    if (path.includes("/builds/workers/")) return Response.json({ success: true, result: [build("new-build", "b".repeat(40))] });
    return Response.json({ success: true, result: { builds: {} } });
  };
  const value = await fetchSiteDeployments("account", "c".repeat(32), "token", Date.now(), fetcher);
  assert.equal(value.production?.id, "cloudflare-version:version-one");
  assert.equal(value.production?.commit, null);
  assert.equal(value.recent[0].id, "cloudflare-build:new-build");
});

test("a deployed build is shown as production even if its own run failed or came from a branch", async () => {
  const fetcher: typeof fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/site/deployments")) return Response.json(active());
    if (path.includes("/builds/workers/")) return Response.json({ success: true, result: [] });
    const deployed = { ...build("manual"), build_outcome: "fail", build_trigger_metadata: { branch: "hotfix" } };
    return Response.json({ success: true, result: { builds: { "version-one": deployed } } });
  };
  const value = await fetchSiteDeployments("account", "c".repeat(32), "token", Date.now(), fetcher);
  assert.equal(value.production?.state, "READY");
  assert.equal(value.production?.target, "production");
});

test("no active deployment keeps recent builds newest first, capped at five", async () => {
  const builds = Array.from({ length: 7 }, (_, i) => ({ ...build(`b${i}`), created_on: `2026-10-0${i + 1}T00:00:00Z` }));
  const fetcher: typeof fetch = async (url) => {
    if (String(url).includes("/site/deployments")) return Response.json({ success: true, result: { deployments: [] } });
    return Response.json({ success: true, result: builds });
  };
  const value = await fetchSiteDeployments("account", "c".repeat(32), "token", Date.now(), fetcher);
  assert.equal(value.production, null);
  assert.deepEqual(value.recent.map((row) => row.id), ["b6", "b5", "b4", "b3", "b2"].map((id) => `cloudflare-build:${id}`));
});

test("build states map stopped outcomes and branches, and a bad tag or HTTP error never reads as empty", async () => {
  assert.equal(parseSiteBuild({ ...build(), status: "queued" }).state, "QUEUED");
  assert.equal(parseSiteBuild({ ...build(), status: "initializing" }).state, "INITIALIZING");
  for (const outcome of ["cancelled", "terminated", "skipped"]) {
    assert.equal(parseSiteBuild({ ...build(), build_outcome: outcome }).state, "CANCELED");
  }
  assert.equal(parseSiteBuild({ ...build(), build_outcome: "mystery" }).state, "UNKNOWN");
  assert.equal(parseSiteBuild({ ...build(), build_trigger_metadata: { branch: "feature" } }).target, "preview");
  assert.throws(() => parseSiteBuild({ ...build(), build_uuid: "" }));

  const forbidden: typeof fetch = async () => new Response("no", { status: 403 });
  await assert.rejects(fetchSiteDeployments("account", "c".repeat(32), "token", Date.now(), forbidden), /403/);
  await assert.rejects(fetchSiteDeployments("account", "not-a-tag", "token", Date.now(), forbidden), /tag is invalid/);
});
