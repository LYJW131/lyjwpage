import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const outputFile = fileURLToPath(new URL("../.wrangler/build-metadata.mjs", import.meta.url));

export function writeBuildMetadata(env = process.env, destination = outputFile) {
  const sha = env.WORKERS_CI_COMMIT_SHA?.trim();
  const commit = /^[a-f0-9]{40}$/i.test(sha ?? "") ? sha.toLowerCase() : undefined;
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `export const buildCommit = ${JSON.stringify(commit) ?? "undefined"};\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  writeBuildMetadata();
}
