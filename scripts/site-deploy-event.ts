import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export type DeployEvent = {
  [key: string]: unknown;
  inputs?: { commit?: string };
  check_run?: {
    app?: { slug?: string };
    name?: string;
    conclusion?: string | null;
    check_suite?: { head_branch?: string | null };
    head_sha?: string;
  };
};

export function siteDeploymentSha(eventName: string | undefined, event: DeployEvent, defaultSha = "") {
  let sha: unknown;
  if (eventName === "workflow_dispatch") {
    sha = event.inputs?.commit || defaultSha;
  } else if (eventName === "check_run") {
    const check = event.check_run;
    if (check?.app?.slug !== "cloudflare-workers-and-pages" ||
        check.name !== "Workers Builds: site" ||
        check.conclusion !== "success" ||
        check.check_suite?.head_branch !== "main") return null;
    sha = check.head_sha;
  } else {
    return null;
  }
  if (typeof sha !== "string" || !/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error("A complete production commit SHA is required");
  }
  return sha;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")) as DeployEvent;
  const sha = siteDeploymentSha(
    process.env.GITHUB_EVENT_NAME,
    event,
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  );
  console.log(`eligible=${sha !== null}`);
  if (sha !== null) console.log(`sha=${sha}`);
}
