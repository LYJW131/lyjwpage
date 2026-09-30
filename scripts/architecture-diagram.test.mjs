import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("./architecture-diagram.mjs", import.meta.url));
const lock = JSON.parse(fs.readFileSync(new URL("./archify.lock.json", import.meta.url), "utf8"));

function fixture(t, version, body) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "architecture-runner-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, "bin"));
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ version }));
  fs.writeFileSync(path.join(directory, "bin/archify.mjs"), body);
  return directory;
}

function validate(directory) {
  return spawnSync(process.execPath, [script, "--validate"], {
    encoding: "utf8",
    env: { ...process.env, ARCHIFY_DIR: directory },
  });
}

test("rejects an incompatible installed version before executing it", (t) => {
  const result = validate(fixture(t, "2.0.0", 'throw new Error("must not execute");'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Archify 版本不匹配/);
  assert.doesNotMatch(result.stderr, /must not execute/);
});

test("nonzero Archify exit remains a failure even with an ok receipt", (t) => {
  const result = validate(fixture(t, lock.version, 'console.log(JSON.stringify({ok:true,checks:[]}));process.exit(7);'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /校验未通过/);
});

test("validation forwards the repository and showcase contract", (t) => {
  const result = validate(fixture(t, lock.version, `
    import assert from "node:assert/strict";
    const args = process.argv.slice(2);
    assert.equal(args[0], "validate");
    assert.equal(args[1], "architecture");
    assert.equal(args[args.indexOf("--quality") + 1], "showcase");
    assert.equal(args[args.indexOf("--repo-root") + 1], process.cwd());
    assert.ok(args.includes("--json"));
    console.log(JSON.stringify({ok:true,checks:[{}]}));
  `));
  assert.equal(result.status, 0, result.stderr);
});

test("failed finalize cannot run exports or replace the existing receipt", (t) => {
  const directory = fixture(t, lock.version, 'console.log(JSON.stringify({ok:false,diagnostics:[{message:"browser blocked"}]}));process.exit(2);');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "architecture-pipeline-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts"));
  fs.mkdirSync(path.join(root, "docs"));
  fs.copyFileSync(script, path.join(root, "scripts/architecture-diagram.mjs"));
  fs.writeFileSync(path.join(root, "scripts/archify.lock.json"), JSON.stringify(lock));
  fs.symlinkSync(fileURLToPath(new URL("../node_modules", import.meta.url)), path.join(root, "node_modules"));
  fs.writeFileSync(path.join(root, "docs/architecture.receipt.json"), "previous receipt");
  const result = spawnSync(process.execPath, [path.join(root, "scripts/architecture-diagram.mjs")], {
    encoding: "utf8", env: { ...process.env, ARCHIFY_DIR: directory },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /browser blocked/);
  assert.equal(fs.readFileSync(path.join(root, "docs/architecture.receipt.json"), "utf8"), "previous receipt");
  assert.equal(fs.existsSync(path.join(root, "docs/architecture-light.png")), false);
});
