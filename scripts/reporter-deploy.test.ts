import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/build-reporters.yml", import.meta.url), "utf8");
const verifyStep = workflow.slice(workflow.indexOf("      - name: Verify\n"));
const run = /^ {8}run: \|\n((?: {10}.*(?:\n|$))+)/m.exec(verifyStep)?.[1];
assert.ok(run, "build-reporters Verify step must have a shell command");
const command = run.replace(/^ {10}/gm, "");
const sha = "a".repeat(40);

for (const service of ["server-reporter", "agents-reporter", "discord-reporter"]) {
  test(`${service} deployment requires a clean running container at the expected commit`, (t) => {
    const cwd = mkdtempSync(path.join(tmpdir(), "reporter-deploy-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const scenarios = [
      { name: "expected commit", state: "status=running restarts=0 image=sha256:fixture", commit: sha, pass: true },
      { name: "wrong commit", state: "status=running restarts=0 image=sha256:fixture", commit: "b".repeat(40), pass: false },
      { name: "missing commit", state: "status=running restarts=0 image=sha256:fixture", commit: null, pass: false },
      { name: "empty commit", state: "status=running restarts=0 image=sha256:fixture", commit: "", pass: false },
      { name: "stopped container", state: "status=exited restarts=0 image=sha256:fixture", commit: sha, pass: false },
      { name: "restarting container", state: "status=running restarts=1 image=sha256:fixture", commit: sha, pass: false },
      { name: "missing state", state: "", commit: sha, pass: false },
    ];
    for (const scenario of scenarios) {
      const lines = ["deploy started", scenario.state];
      if (scenario.commit !== null) lines.push(`REPORTER_COMMIT=${scenario.commit}`);
      writeFileSync(path.join(cwd, "deploy.log"), `${lines.join("\n")}\n`);
      const result = spawnSync("bash", ["-euo", "pipefail", "-c", command], {
        cwd,
        env: { ...process.env, SERVICE: service, SHA: sha },
        encoding: "utf8",
        timeout: 5000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, scenario.pass ? 0 : 1, `${scenario.name}: ${result.stdout}${result.stderr}`);
    }
  });
}
