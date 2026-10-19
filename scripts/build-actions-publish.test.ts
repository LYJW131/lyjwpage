import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { SCREENSHOT_LIMITS, TEXT_LIMITS, UPLOAD_LIMITS, WORKER_PATHS, runPublish, screenshotEntries } from "./build-actions.ts";
import { BASE_SHA, body, git, JWT, packageAndPublish, PNG, publishEnv, repo, RUN_ID, server, workerPath, writeFile } from "./build-actions-harness.ts";

test("package and publish upload added, modified, deleted, executable and binary files", async (t) => {
  const fixture = repo(t);
  const binary = Buffer.concat([randomBytes(512), Buffer.from([0, 0, 0])]);
  writeFile(fixture.checkout, "src/new.ts", "export const fresh = true;\n");
  writeFile(fixture.checkout, "src/edit.ts", "export const value = 2;\n");
  fs.rmSync(path.join(fixture.checkout, "src/remove.ts"));
  fs.chmodSync(path.join(fixture.checkout, "src/tool.sh"), 0o755);
  writeFile(fixture.checkout, "src/run.sh", "#!/bin/sh\n", 0o755);
  writeFile(fixture.checkout, "public/logo.bin", binary);
  writeFile(fixture.checkout, `builds/${RUN_ID}.md`, "# Plan, edited by the builder\n");
  writeFile(fixture.checkout, ".build-output/message.md", "\n feat(site): add things \n\nBody @mention\n");
  writeFile(fixture.checkout, ".build-output/notes.txt", "scratch\n");
  writeFile(fixture.checkout, ".build-output/screenshots/home-1440.png", PNG);
  writeFile(fixture.checkout, ".build-output/screenshots.json", JSON.stringify([{ file: "home-1440.png", caption: "  Home page,\n1440 wide " }, { file: "../escape.png", caption: "bad" }, { file: "missing.png", caption: "Missing" }]));

  const run = await packageAndPublish(t, fixture);
  assert.equal(run.ok, true);
  assert.deepEqual(run.workerRequests().map(workerPath), [WORKER_PATHS.screenshot, WORKER_PATHS.upload]);
  for (const entry of run.workerRequests()) {
    assert.equal(entry.url.split("?")[1], `runId=${RUN_ID}`);
    assert.equal(entry.authorization, `Bearer ${JWT}`);
  }
  assert.ok(run.logs.indexOf(`::add-mask::${JWT}`) >= 0);
  assert.equal(run.requests.filter((entry) => entry.url.startsWith("/oidc")).length, 2, "each Worker request carries a freshly minted token");
  assert.ok(run.logs.includes('Ignored screenshot: "missing.png" is missing.'));

  const [screenshot, upload] = run.workerRequests().map(body);
  assert.deepEqual(screenshot, { caption: "Home page, 1440 wide", content: PNG.toString("base64") });
  assert.equal(upload.baseSha, BASE_SHA);
  assert.equal(upload.message, "feat(site): add things \n\nBody @mention");
  assert.deepEqual(upload.deletions, ["src/remove.ts"]);
  const files = Object.fromEntries(upload.files.map((file) => [file.path, { mode: file.mode, content: Buffer.from(file.content, "base64") }]));
  assert.deepEqual(Object.keys(files).sort(), ["public/logo.bin", "src/edit.ts", "src/new.ts", "src/run.sh", "src/tool.sh"]);
  assert.deepEqual(files["public/logo.bin"], { mode: "100644", content: binary });
  assert.deepEqual(files["src/tool.sh"], { mode: "100755", content: Buffer.from("#!/bin/sh\necho tool\n") });
  assert.equal(files["src/run.sh"].mode, "100755");
  assert.equal(files["src/edit.ts"].content.toString(), "export const value = 2;\n");
  assert.match(fs.readFileSync(run.env.GITHUB_STEP_SUMMARY, "utf8"), /Build upload of 5 files and 1 deletions: Worker HTTP 200\./);
  assert.deepEqual(fs.readdirSync(fixture.out).sort(), ["changes.patch", "message.md", "screenshots", "screenshots.json"]);
});

test("paths under .build-output stay out even when the builder staged them itself", async (t) => {
  const fixture = repo(t);
  writeFile(fixture.checkout, "src/edit.ts", "export const value = 3;\n");
  writeFile(fixture.checkout, ".build-output/forced.txt", "staged by hand\n");
  git(fixture.checkout, "add", "-f", ".build-output/forced.txt");
  git(fixture.checkout, "commit", "-q", "-m", "builder commit");
  const run = await packageAndPublish(t, fixture, { gitDir: null });
  const upload = body(run.workerRequests().at(-1));
  assert.deepEqual(upload.files.map((file) => file.path), ["src/edit.ts"]);
  assert.equal(upload.message, `chore(build): implement ${RUN_ID}`);
});

test("publish blocks symlinks and names the path", async (t) => {
  const fixture = repo(t);
  fs.symlinkSync("../package.json", path.join(fixture.checkout, "src/link.ts"));
  writeFile(fixture.checkout, "src/edit.ts", "export const value = 4;\n");
  const run = await packageAndPublish(t, fixture);
  assert.equal(run.ok, true);
  assert.deepEqual(run.workerRequests().map(workerPath), [WORKER_PATHS.progress]);
  assert.deepEqual(body(run.workerRequests()[0]), { blocked: true, message: "src/link.ts is a symbolic link; only regular files can be uploaded." });
});

test("package ignores symlinked build outputs", async (t) => {
  const fixture = repo(t);
  writeFile(fixture.root, "outside.md", "secret\n");
  fs.mkdirSync(path.join(fixture.checkout, ".build-output"));
  fs.symlinkSync(path.join(fixture.root, "outside.md"), path.join(fixture.checkout, ".build-output/message.md"));
  fs.symlinkSync(path.join(fixture.root, "outside.md"), path.join(fixture.checkout, ".build-output/blocked.md"));
  writeFile(fixture.checkout, "src/edit.ts", "export const value = 5;\n");
  const run = await packageAndPublish(t, fixture);
  assert.ok(!fs.existsSync(path.join(fixture.out, "message.md")));
  assert.ok(!fs.existsSync(path.join(fixture.out, "blocked.md")));
  assert.equal(body(run.workerRequests().at(-1)).message, `chore(build): implement ${RUN_ID}`);
  assert.ok(run.logs.some((line) => line.includes("is a symbolic link")));
});

test("an implementation without changes is reported as blocked", async (t) => {
  const fixture = repo(t);
  writeFile(fixture.checkout, ".build-output/message.md", "feat: nothing\n");
  writeFile(fixture.checkout, `builds/${RUN_ID}.md`, "# Plan, rewritten\n");
  const run = await packageAndPublish(t, fixture);
  assert.deepEqual(body(run.workerRequests()[0]), { blocked: true, message: "The implementation finished without changes." });

  const untouched = repo(t);
  const clean = await packageAndPublish(t, untouched);
  assert.equal(fs.statSync(path.join(untouched.out, "changes.patch")).size, 0);
  assert.deepEqual(body(clean.workerRequests()[0]), { blocked: true, message: "The implementation finished without changes." });
});

test("blocked.md stops the upload and is capped", async (t) => {
  const fixture = repo(t);
  writeFile(fixture.checkout, "src/edit.ts", "export const value = 6;\n");
  const lure = "[claim it](https://evil.example) <img src=https://evil.example/x.png>";
  writeFile(fixture.checkout, ".build-output/blocked.md", `  Needs workers/core/src/x.ts. ${lure} ${"z".repeat(800)}`);
  const run = await packageAndPublish(t, fixture);
  assert.equal(run.ok, true);
  assert.deepEqual(run.workerRequests().map(workerPath), [WORKER_PATHS.progress]);
  const blocked = body(run.workerRequests()[0]);
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.message.length, TEXT_LIMITS.blockedChars);
  assert.ok(blocked.message.startsWith(`Needs workers/core/src/x.ts. ${lure} zzz`));
  assert.ok(run.logs.some((line) => line.startsWith("Build blocked: \"Needs workers/core/src/x.ts.")));
  assert.equal(fs.readFileSync(run.env.GITHUB_STEP_SUMMARY, "utf8"), "Build blocked; the reason is in the job log (Worker HTTP 200).\n");
});

test("commit messages are trimmed to the Worker limit", async (t) => {
  const fixture = repo(t);
  writeFile(fixture.checkout, "src/edit.ts", "export const value = 7;\n");
  writeFile(fixture.checkout, ".build-output/message.md", `feat: long\n\n${"字".repeat(3000)}`);
  const run = await packageAndPublish(t, fixture);
  assert.equal(body(run.workerRequests().at(-1)).message.length, UPLOAD_LIMITS.messageChars);
});

test("oversized files and too many paths are blocked before upload", async (t) => {
  const large = repo(t);
  writeFile(large.checkout, "public/big.bin", randomBytes(UPLOAD_LIMITS.fileBytes + 1));
  const big = await packageAndPublish(t, large);
  assert.deepEqual(body(big.workerRequests()[0]), { blocked: true, message: `public/big.bin is larger than the ${UPLOAD_LIMITS.fileBytes}-byte file limit.` });

  const many = repo(t);
  for (let index = 0; index <= UPLOAD_LIMITS.files; index++) writeFile(many.checkout, `src/many/file-${index}.ts`, `export const n = ${index};\n`);
  const crowded = await packageAndPublish(t, many);
  assert.ok(!fs.existsSync(path.join(many.out, "changes.patch")));
  assert.deepEqual(body(crowded.workerRequests()[0]), { blocked: true, message: `The implementation changed ${UPLOAD_LIMITS.files + 1} paths; at most ${UPLOAD_LIMITS.files} can be uploaded.` });
});

test("publish reports an unfinished implementation job", async (t) => {
  const fixture = repo(t);
  const harness = await server(t);
  const failed = await runPublish({ env: publishEnv(t, harness.base, { IMPLEMENT_RESULT: "failure" }), work: fixture.work, artifact: fixture.out, io: harness.io });
  assert.equal(failed, true);
  const missing = await runPublish({ env: publishEnv(t, harness.base), work: fixture.work, artifact: path.join(fixture.root, "nowhere"), io: harness.io });
  assert.equal(missing, true);
  const odd = await runPublish({ env: publishEnv(t, harness.base, { IMPLEMENT_RESULT: "fail\n::stop-commands::x" }), work: fixture.work, artifact: fixture.out, io: harness.io });
  assert.equal(odd, true);
  assert.deepEqual(harness.workerRequests().map(body), [
    { blocked: true, message: "The implementation job did not finish (failure)." },
    { blocked: true, message: "The implementation job did not finish (missing output)." },
    { blocked: true, message: "The implementation job did not finish (unknown)." },
  ]);
});

test("publish fails when the Worker rejects the upload", async (t) => {
  const fixture = repo(t);
  writeFile(fixture.checkout, "src/edit.ts", "export const value = 8;\n");
  const run = await packageAndPublish(t, fixture, { respond: () => ({ status: 400, json: { error: "A changed path is outside the allowed scope." } }) });
  assert.equal(run.ok, false);
  assert.ok(run.logs.some((line) => line.startsWith(`Worker ${WORKER_PATHS.upload}: HTTP 400 `)));
  assert.match(fs.readFileSync(run.env.GITHUB_STEP_SUMMARY, "utf8"), /Worker HTTP 400/);
});

test("screenshot lists are validated", () => {
  const list = [
    { file: "a.png", caption: "A" },
    { file: "a.png", caption: "again" },
    { file: "b.jpeg", caption: "" },
    { file: "c.gif", caption: "gif" },
    { file: "sub/d.png", caption: "nested" },
    { file: "e.webp", caption: "x".repeat(200) },
    ...Array.from({ length: 6 }, (_, index) => ({ file: `f${index}.jpg`, caption: `F${index}` })),
  ];
  const { accepted, rejected } = screenshotEntries(list);
  assert.deepEqual(accepted.map((shot) => shot.file), ["a.png", "e.webp", "f0.jpg", "f1.jpg", "f2.jpg", "f3.jpg"]);
  assert.equal(accepted[1].caption.length, SCREENSHOT_LIMITS.captionChars);
  assert.equal(rejected.length, list.length - accepted.length);
  assert.deepEqual(screenshotEntries({}).accepted, []);
});
