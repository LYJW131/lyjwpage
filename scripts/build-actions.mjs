import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// 构建工作流把这个文件从 main 单独拷出来运行，只能用 node: 内置模块，所以路径与上限抄自 shared/ai-paths.ts、shared/build-routine.ts，由测试核对。
export const WORKER_PATHS = { upload: "/api/build/upload", progress: "/api/build/progress", screenshot: "/api/build/screenshot" };
export const UPLOAD_LIMITS = { files: 80, fileBytes: 512 * 1024, totalBytes: 2 * 1024 * 1024, requestBytes: 3 * 1024 * 1024, messageChars: 2000 };
export const SCREENSHOT_LIMITS = { count: 6, bytes: 2 * 1024 * 1024, captionChars: 80 };
export const TEXT_LIMITS = { blockedChars: 600, reasonChars: 500, outputFileBytes: 64 * 1024, patchBytes: 16 * 1024 * 1024 };
export const OUTPUT_DIR = ".build-output";
export const SCREENSHOT_FILE = /^[A-Za-z0-9._-]{1,80}\.(?:png|jpe?g|webp)$/;

const ENV_PATTERNS = {
  RUN_ID: /^[a-f0-9]{32}$/,
  PLAN_COMMIT_SHA: /^[a-f0-9]{40}$/,
  BASE_SHA: /^[a-f0-9]{40}$/,
  PR_NUMBER: /^[1-9][0-9]{0,8}$/,
  CALLBACK_ORIGIN: /^https:\/\/[A-Za-z0-9.-]+$/,
  RUN_URL: /^https:\/\/[A-Za-z0-9.-]+\/[\w.-]+\/[\w.-]+\/actions\/runs\/[0-9]+$/,
};

const defaultIo = {
  fetch: (...args) => globalThis.fetch(...args),
  log: (line) => console.log(line),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export function readEnv(env, names) {
  const values = {};
  for (const name of names) {
    const value = env[name];
    if (typeof value !== "string" || !ENV_PATTERNS[name].test(value)) throw new Error(`${name} is missing or invalid.`);
    values[name] = value;
  }
  return values;
}

// 日志里的外来文本一律 JSON 引号化：行首的 ::xxx:: 会被 runner 当工作流命令执行。
const quote = (value) => JSON.stringify(value);

export function cleanText(value) {
  return value.toWellFormed().replace(/\r\n?/g, "\n").replace(/[^\P{Cc}\n\t]/gu, " ");
}

export function cut(value, max) {
  if (value.length <= max) return value;
  const end = /[\uD800-\uDBFF]/.test(value[max - 1]) ? max - 1 : max;
  return value.slice(0, end);
}

const clip = (value, max) => cut(cleanText(value).trim(), max).trimEnd();

export function neutralizePlan(text) {
  return text.toWellFormed().replace(/<([\s\p{Cf}]*)\/([\s\p{Cf}]*)plan/giu, "&lt;$1/$2plan");
}

export function renderPrompt(template, { runId, planCommitSha, baseSha, plan }) {
  const values = { RUN_ID: runId, PLAN_COMMIT_SHA: planCommitSha, BASE_SHA: baseSha, PLAN: neutralizePlan(plan) };
  return template.replace(/\{\{(RUN_ID|PLAN_COMMIT_SHA|BASE_SHA|PLAN)\}\}/g, (_, key) => values[key]);
}

function parseCliResult(text, what) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`${what} is not valid JSON.`); }
  if (Array.isArray(data)) data = data.findLast((message) => message?.type === "result");
  if (!data || typeof data !== "object") throw new Error(`${what} is not a CLI result object.`);
  return data;
}

export function parseReviewResult(text) {
  const data = parseCliResult(text, "The review output");
  if (data.is_error === true) throw new Error(`The review session ended with an error (${quote(String(data.subtype ?? "unknown"))}).`);
  const output = data.structured_output;
  if (!output || typeof output !== "object") throw new Error("The review output has no structured verdict.");
  if (output.verdict !== "approve" && output.verdict !== "reject") throw new Error(`The review verdict ${quote(String(output.verdict))} is not approve or reject.`);
  const reason = typeof output.reason === "string" ? clip(output.reason, TEXT_LIMITS.reasonChars) : "";
  if (!reason) throw new Error("The review verdict has no reason.");
  return { verdict: output.verdict, reason };
}

export function parseImplementResult(text) {
  const data = parseCliResult(text, "The implementation output");
  const subtype = typeof data.subtype === "string" ? data.subtype : null;
  if (data.is_error === true || subtype && subtype !== "success") throw new Error(`The implementation session ended with an error (${quote(subtype ?? "unknown")}).`);
  return { subtype, turns: data.num_turns, costUsd: data.total_cost_usd };
}

export function formatOutputs(values, delimiter = `ghadelimiter_${randomBytes(16).toString("hex")}`) {
  return Object.entries(values).map(([name, value]) => {
    if (value.includes(delimiter)) throw new Error("The output value contains the heredoc delimiter.");
    return `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
  }).join("");
}

function writeOutputs(env, values) {
  if (!env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is not set.");
  fs.appendFileSync(env.GITHUB_OUTPUT, formatOutputs(values));
}

function appendSummary(env, line) {
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

function isRealDirectory(dir) {
  try { return fs.lstatSync(dir).isDirectory(); } catch { return false; }
}

class OutputFileError extends Error {}

// O_NOFOLLOW 拒绝最后一段是符号链接，O_NONBLOCK 让打开 FIFO 不阻塞；父目录由调用方用 lstat 确认。
export function readRegularFile(file, maxBytes, { truncate = false } = {}) {
  let fd;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    if (error.code === "ELOOP") throw new OutputFileError(`${quote(file)} is a symbolic link.`);
    throw error;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new OutputFileError(`${quote(file)} is not a regular file.`);
    if (stat.size > maxBytes && !truncate) throw new OutputFileError(`${quote(file)} is larger than ${maxBytes} bytes.`);
    const buffer = Buffer.alloc(Math.min(stat.size, maxBytes));
    let read = 0;
    while (read < buffer.length) {
      const n = fs.readSync(fd, buffer, read, buffer.length - read, read);
      if (n === 0) break;
      read += n;
    }
    return buffer.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

function readOptional(file, maxBytes, io, options) {
  try { return readRegularFile(file, maxBytes, options); }
  catch (error) {
    if (!(error instanceof OutputFileError)) throw error;
    io.log(`Ignored build output: ${error.message}`);
    return null;
  }
}

export function screenshotEntries(value) {
  const accepted = [];
  const rejected = [];
  if (!Array.isArray(value)) return { accepted, rejected: ["screenshots.json is not an array"] };
  for (const entry of value) {
    const file = entry && typeof entry === "object" ? entry.file : undefined;
    const caption = entry && typeof entry === "object" && typeof entry.caption === "string" ? clip(entry.caption.replace(/\s+/g, " "), SCREENSHOT_LIMITS.captionChars) : "";
    if (typeof file !== "string" || !SCREENSHOT_FILE.test(file)) rejected.push(`invalid file name ${quote(file)}`);
    else if (!caption) rejected.push(`${quote(file)} has no caption`);
    else if (accepted.some((shot) => shot.file === file)) rejected.push(`${quote(file)} is listed twice`);
    else if (accepted.length >= SCREENSHOT_LIMITS.count) rejected.push(`${quote(file)} exceeds ${SCREENSHOT_LIMITS.count} screenshots`);
    else accepted.push({ file, caption });
  }
  return { accepted, rejected };
}

function readScreenshots(dir, io) {
  const list = readOptional(path.join(dir, "screenshots.json"), TEXT_LIMITS.outputFileBytes, io);
  if (!list) return [];
  let parsed;
  try { parsed = JSON.parse(list.toString("utf8")); } catch { io.log("Ignored build output: screenshots.json is not valid JSON."); return []; }
  const { accepted, rejected } = screenshotEntries(parsed);
  for (const reason of rejected) io.log(`Ignored screenshot: ${reason}.`);
  if (!accepted.length) return [];
  const imageDir = path.join(dir, "screenshots");
  if (!isRealDirectory(imageDir)) { io.log("Ignored screenshots: the screenshots directory is missing or not a directory."); return []; }
  return accepted.flatMap((shot) => {
    const bytes = readOptional(path.join(imageDir, shot.file), SCREENSHOT_LIMITS.bytes, io);
    if (bytes?.length) return [{ ...shot, bytes }];
    io.log(`Ignored screenshot: ${quote(shot.file)} is ${bytes ? "empty" : "missing"}.`);
    return [];
  });
}

const GIT_ENV = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };

class GitError extends Error {}

// 构建检出的 .git 被 Claude 会话碰过，git 读到的配置可能让它执行任意命令：不读系统与全局配置，关掉钩子和 fsmonitor；给了 gitDir 就改用开工前的副本。
function gitRunner(cwd, gitDir) {
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))), ...GIT_ENV };
  const base = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...(gitDir ? [`--git-dir=${path.resolve(gitDir)}`, `--work-tree=${path.resolve(cwd)}`] : [])];
  return (args, { stdout = "pipe", maxBuffer = 64 * 1024 * 1024 } = {}) => {
    const result = spawnSync("git", [...base, ...args], { cwd, env, maxBuffer, stdio: ["ignore", stdout, "pipe"] });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new GitError(`git ${args[0]} failed: ${quote(result.stderr.toString("utf8").trim().slice(0, 500))}`);
    return result.stdout;
  };
}

const splitNul = (buffer) => buffer.toString("utf8").split("\0").filter(Boolean);

// 构建产物目录不是改动；builds/ 下是 Worker 已提交的计划，带上它整次上传都会被 Worker 拒绝。
export function droppedPath(file) {
  return [OUTPUT_DIR, "builds"].some((dir) => file === dir || file.startsWith(`${dir}/`));
}

export function packageBuild({ cwd, out, gitDir, planCommitSha, io = defaultIo }) {
  const git = gitRunner(cwd, gitDir);
  git(["add", "-A", "--", ".", `:(exclude)${OUTPUT_DIR}`]);
  fs.mkdirSync(out, { recursive: true });
  const outputs = path.join(cwd, OUTPUT_DIR);
  let blocked = false;
  if (isRealDirectory(outputs)) {
    for (const name of ["message.md", "blocked.md"]) {
      const bytes = readOptional(path.join(outputs, name), TEXT_LIMITS.outputFileBytes, io, { truncate: true });
      if (!bytes) continue;
      fs.writeFileSync(path.join(out, name), bytes);
      if (name === "blocked.md") blocked = true;
    }
    const shots = readScreenshots(outputs, io);
    if (shots.length) {
      fs.mkdirSync(path.join(out, "screenshots"), { recursive: true });
      for (const shot of shots) fs.writeFileSync(path.join(out, "screenshots", shot.file), shot.bytes);
      fs.writeFileSync(path.join(out, "screenshots.json"), JSON.stringify(shots.map(({ file, caption }) => ({ file, caption }))));
    }
  } else if (fs.existsSync(outputs)) {
    io.log(`Ignored build output: ${OUTPUT_DIR} is not a directory.`);
  }
  const block = (message) => {
    if (!blocked) fs.writeFileSync(path.join(out, "blocked.md"), message);
    io.log(`Packaging stopped: ${message}`);
  };
  const changed = splitNul(git(["diff", "--cached", "--name-only", "--no-renames", "-z", planCommitSha])).filter((file) => !droppedPath(file));
  if (changed.length > UPLOAD_LIMITS.files) return block(`The implementation changed ${changed.length} paths; at most ${UPLOAD_LIMITS.files} can be uploaded.`);
  const patchFile = path.join(out, "changes.patch");
  const fd = fs.openSync(patchFile, "w");
  try { git(["diff", "--cached", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--no-renames", "--no-color", planCommitSha], { stdout: fd }); }
  finally { fs.closeSync(fd); }
  if (fs.statSync(patchFile).size > TEXT_LIMITS.patchBytes) {
    fs.rmSync(patchFile);
    return block("The implementation diff is too large to upload.");
  }
  io.log(`Packaged ${changed.length} changed paths.`);
}

export function parseNameStatus(buffer) {
  const parts = splitNul(buffer);
  const entries = [];
  for (let index = 0; index + 1 < parts.length; index += 2) entries.push({ status: parts[index], path: parts[index + 1] });
  return entries;
}

export function parseIndex(buffer) {
  const index = new Map();
  for (const record of splitNul(buffer)) {
    const tab = record.indexOf("\t");
    const [mode, sha] = record.slice(0, tab).split(" ");
    index.set(record.slice(tab + 1), { mode, sha });
  }
  return index;
}

const blockedResult = (message) => ({ blocked: message });

export function preparePublication({ env, work, artifact, runId, baseSha, io = defaultIo }) {
  const result = typeof env.IMPLEMENT_RESULT === "string" && /^[a-z_]{1,20}$/.test(env.IMPLEMENT_RESULT) ? env.IMPLEMENT_RESULT : "unknown";
  if (result !== "success") return blockedResult(`The implementation job did not finish (${result}).`);
  if (!isRealDirectory(artifact)) return blockedResult("The implementation job did not finish (missing output).");
  const blocked = readOptional(path.join(artifact, "blocked.md"), TEXT_LIMITS.outputFileBytes, io, { truncate: true });
  if (blocked) return blockedResult(clip(blocked.toString("utf8"), TEXT_LIMITS.blockedChars) || "The implementation stopped without giving a reason.");
  const patchFile = path.join(artifact, "changes.patch");
  let patchStat;
  try { patchStat = fs.lstatSync(patchFile); } catch { return blockedResult("The implementation job did not finish (missing output)."); }
  if (!patchStat.isFile()) return blockedResult("The implementation job did not finish (missing output).");
  if (patchStat.size > TEXT_LIMITS.patchBytes) return blockedResult("The implementation diff is too large to upload.");
  if (patchStat.size === 0) return blockedResult("The implementation finished without changes.");

  const git = gitRunner(work);
  try { git(["apply", "--cached", "--binary", "--whitespace=nowarn", path.resolve(patchFile)]); }
  catch (error) {
    if (!(error instanceof GitError)) throw error;
    io.log(`Patch rejected: ${error.message}`);
    return blockedResult("The implementation patch could not be applied to the plan commit.");
  }
  const entries = parseNameStatus(git(["diff", "--cached", "--name-status", "--no-renames", "-z", "HEAD"]));
  const dropped = entries.filter((entry) => droppedPath(entry.path));
  if (dropped.length) io.log(`Left out of the upload: ${quote(dropped.map((entry) => entry.path))}`);
  const changes = entries.filter((entry) => !droppedPath(entry.path));
  if (!changes.length) return blockedResult("The implementation finished without changes.");
  if (changes.length > UPLOAD_LIMITS.files) return blockedResult(`The implementation changed ${changes.length} paths; at most ${UPLOAD_LIMITS.files} can be uploaded.`);
  const unsupported = changes.find((entry) => !["A", "M", "D"].includes(entry.status));
  if (unsupported) return blockedResult(`${unsupported.path} changed in an unsupported way (${unsupported.status}); only regular file additions, edits and deletions can be uploaded.`);

  const index = parseIndex(git(["ls-files", "-s", "-z"]));
  const files = [];
  const deletions = [];
  let total = 0;
  for (const change of changes) {
    if (change.status === "D") { deletions.push(change.path); continue; }
    const entry = index.get(change.path);
    if (!entry) return blockedResult(`${change.path} could not be read from the patch.`);
    if (entry.mode === "120000") return blockedResult(`${change.path} is a symbolic link; only regular files can be uploaded.`);
    if (entry.mode === "160000") return blockedResult(`${change.path} is a submodule; only regular files can be uploaded.`);
    if (entry.mode !== "100644" && entry.mode !== "100755") return blockedResult(`${change.path} has unsupported mode ${entry.mode}; only regular files can be uploaded.`);
    const size = Number(git(["cat-file", "-s", entry.sha]).toString("utf8").trim());
    if (!Number.isSafeInteger(size) || size > UPLOAD_LIMITS.fileBytes) return blockedResult(`${change.path} is larger than the ${UPLOAD_LIMITS.fileBytes}-byte file limit.`);
    total += size;
    if (total > UPLOAD_LIMITS.totalBytes) return blockedResult(`The changed files exceed the ${UPLOAD_LIMITS.totalBytes}-byte upload limit.`);
    const bytes = git(["cat-file", "blob", entry.sha], { maxBuffer: UPLOAD_LIMITS.fileBytes + 1 });
    files.push({ path: change.path, content: bytes.toString("base64"), mode: entry.mode });
  }

  const messageBytes = readOptional(path.join(artifact, "message.md"), TEXT_LIMITS.outputFileBytes, io, { truncate: true });
  const message = clip(messageBytes?.toString("utf8") ?? "", UPLOAD_LIMITS.messageChars) || `chore(build): implement ${runId}`;
  const upload = { baseSha, message, files, deletions };
  if (Buffer.byteLength(JSON.stringify(upload)) > UPLOAD_LIMITS.requestBytes) return blockedResult(`The upload exceeds the ${UPLOAD_LIMITS.requestBytes}-byte request limit.`);
  return { upload, screenshots: readScreenshots(artifact, io) };
}

async function mintIdToken(env, audience, io, timeoutMs) {
  const { ACTIONS_ID_TOKEN_REQUEST_URL: url, ACTIONS_ID_TOKEN_REQUEST_TOKEN: token } = env;
  if (!url || !token) throw new Error("GitHub Actions OIDC is unavailable; the job needs id-token: write.");
  const response = await io.fetch(`${url}&audience=${encodeURIComponent(audience)}`, { headers: { Authorization: `bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`GitHub Actions OIDC answered HTTP ${response.status}.`);
  const { value } = await response.json();
  if (typeof value !== "string" || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(value)) throw new Error("GitHub Actions OIDC returned no token.");
  io.log(`::add-mask::${value}`);
  return value;
}

export const WORKER_TIMING = {
  gateBudgetMs: 60_000,
  publishBudgetMs: 200_000,
  uploadReserveMs: 150_000,
  requestMs: 20_000,
  mintMs: 15_000,
  minAttemptMs: 10_000,
  retryDelaysMs: [2_000, 5_000],
};

// 只重试 0（网络错误或超时）与 502/503/504：Worker 在领取上传凭据之前失败时重试安全；已领取的话重试只会拿到 401，结果不变。
const RETRYABLE_STATUS = new Set([0, 502, 503, 504]);

// GitHub 的 OIDC 令牌只活几分钟，每次尝试都现取一张，不跨请求缓存。
function workerClient({ env, origin, runId, io, deadline }) {
  return async (pathname, body, { timeoutMs = WORKER_TIMING.requestMs, retry = true, until = deadline } = {}) => {
    if (until - Date.now() < WORKER_TIMING.minAttemptMs) {
      io.log(`Worker ${pathname}: skipped; the time budget ran out.`);
      return { ok: false, status: 0, text: "" };
    }
    let status;
    let text;
    for (let attempt = 0; ; attempt += 1) {
      status = 0;
      try {
        const token = await mintIdToken(env, origin, io, Math.max(1, Math.min(WORKER_TIMING.mintMs, until - Date.now())));
        const response = await io.fetch(`${origin}${pathname}?runId=${runId}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, until - Date.now()))),
        });
        status = response.status;
        text = await response.text();
      } catch (error) {
        text = error instanceof Error ? error.message : String(error);
      }
      io.log(`Worker ${pathname}: HTTP ${status} ${quote(text.slice(0, 2000))}`);
      const delay = WORKER_TIMING.retryDelaysMs[attempt];
      if (!retry || !RETRYABLE_STATUS.has(status) || delay === undefined || until - Date.now() - delay < WORKER_TIMING.minAttemptMs) break;
      await (io.sleep ?? defaultIo.sleep)(delay);
    }
    return { ok: status >= 200 && status < 300, status, text };
  };
}

const GATE_PROGRESS = "Plan review approved the plan; implementation is starting.";

export function gateDecision({ reviewResult, verdict, reason }) {
  const text = typeof reason === "string" ? clip(reason, TEXT_LIMITS.reasonChars) : "";
  if (reviewResult === "success" && verdict === "approve") return { approved: true, label: "approved", reason: text, worker: { message: GATE_PROGRESS } };
  if (reviewResult === "success" && verdict === "reject") return { approved: false, label: "declined", reason: text, worker: { blocked: true, message: cut(`Plan review declined: ${text || "no reason was given."}`, TEXT_LIMITS.blockedChars) } };
  return { approved: false, label: "did not finish", reason: "", worker: { blocked: true, message: "The plan review did not finish." } };
}

export function reviewComment(decision, runUrl) {
  const lines = [`**Plan review: ${decision.label}**`];
  if (decision.reason) lines.push("", decision.reason.split("\n").map((line) => `> ${line}`).join("\n"));
  lines.push("", `[Workflow run](${runUrl})`);
  return lines.join("\n").replaceAll("@", "@​");
}

async function postReviewComment(env, prNumber, body, io) {
  const repository = env.GITHUB_REPOSITORY;
  if (!env.GITHUB_TOKEN || !repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    io.log("Plan review comment skipped: GITHUB_TOKEN or GITHUB_REPOSITORY is not set.");
    return;
  }
  try {
    const response = await io.fetch(`${env.GITHUB_API_URL || "https://api.github.com"}/repos/${repository}/issues/${prNumber}/comments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", "User-Agent": "lyjwpage-build" },
      body: JSON.stringify({ body }),
      signal: AbortSignal.timeout(30_000),
    });
    io.log(`Plan review comment: HTTP ${response.status}`);
  } catch (error) {
    io.log(`Plan review comment failed: ${quote(error instanceof Error ? error.message : String(error))}`);
  }
}

export async function runGate({ env, io = defaultIo }) {
  let approved = false;
  try {
    const { RUN_ID, PR_NUMBER, CALLBACK_ORIGIN, RUN_URL } = readEnv(env, ["RUN_ID", "PR_NUMBER", "CALLBACK_ORIGIN", "RUN_URL"]);
    const decision = gateDecision({ reviewResult: env.REVIEW_RESULT, verdict: env.VERDICT, reason: env.REASON });
    io.log(`Plan review ${decision.label}.`);
    await postReviewComment(env, PR_NUMBER, reviewComment(decision, RUN_URL), io);
    const post = workerClient({ env, origin: CALLBACK_ORIGIN, runId: RUN_ID, io, deadline: Date.now() + WORKER_TIMING.gateBudgetMs });
    const response = await post(WORKER_PATHS.progress, decision.worker);
    appendSummary(env, `Plan review ${decision.label}; the Worker answered HTTP ${response.status}.`);
    if (!response.ok) throw new Error(`The Worker did not accept the plan review result (HTTP ${response.status}).`);
    approved = decision.approved;
  } finally {
    writeOutputs(env, { approved: String(approved) });
  }
  return true;
}

export async function runPublish({ env, work, artifact, io = defaultIo }) {
  const { RUN_ID, BASE_SHA, CALLBACK_ORIGIN } = readEnv(env, ["RUN_ID", "BASE_SHA", "CALLBACK_ORIGIN"]);
  const publication = preparePublication({ env, work, artifact, runId: RUN_ID, baseSha: BASE_SHA, io });
  const deadline = Date.now() + WORKER_TIMING.publishBudgetMs;
  const post = workerClient({ env, origin: CALLBACK_ORIGIN, runId: RUN_ID, io, deadline });
  if (publication.blocked) {
    io.log(`Build blocked: ${quote(publication.blocked)}`);
    const response = await post(WORKER_PATHS.progress, { blocked: true, message: clip(publication.blocked, TEXT_LIMITS.blockedChars) });
    // 运行摘要按 Markdown 渲染且对外公开，停下原因来自 Claude 和补丁里的路径，只进日志。
    appendSummary(env, `Build blocked; the reason is in the job log (Worker HTTP ${response.status}).`);
    return response.ok;
  }
  // 截图失败不影响上传：截图不重试（Worker 可能已经收下），也只能用上传预留之外的时间。
  for (const shot of publication.screenshots) {
    const response = await post(WORKER_PATHS.screenshot, { caption: shot.caption, content: shot.bytes.toString("base64") }, { retry: false, until: deadline - WORKER_TIMING.uploadReserveMs });
    if (!response.ok) io.log(`Screenshot ${quote(shot.file)} was not accepted; continuing.`);
  }
  const { files, deletions } = publication.upload;
  const response = await post(WORKER_PATHS.upload, publication.upload, { timeoutMs: WORKER_TIMING.uploadReserveMs });
  appendSummary(env, `Build upload of ${files.length} files and ${deletions.length} deletions: Worker HTTP ${response.status}.`);
  return response.ok;
}

function readText(file, maxBytes) {
  const bytes = readRegularFile(file, maxBytes);
  if (!bytes) throw new Error(`${quote(file)} does not exist.`);
  return bytes.toString("utf8");
}

const COMMANDS = {
  prompt: {
    options: { template: { type: "string" }, plan: { type: "string" } },
    run: ({ values, env, io }) => {
      if (!values.template || !values.plan) throw new Error("Usage: prompt --template <file> --plan <file>");
      const { RUN_ID, PLAN_COMMIT_SHA, BASE_SHA } = readEnv(env, ["RUN_ID", "PLAN_COMMIT_SHA", "BASE_SHA"]);
      io.write(renderPrompt(readText(values.template, 256 * 1024), { runId: RUN_ID, planCommitSha: PLAN_COMMIT_SHA, baseSha: BASE_SHA, plan: readText(values.plan, 256 * 1024) }));
      return true;
    },
  },
  "review-result": {
    run: ({ positionals, env, io }) => {
      if (positionals.length !== 1) throw new Error("Usage: review-result <file>");
      const result = parseReviewResult(readText(positionals[0], 4 * 1024 * 1024));
      io.log(`Plan review verdict: ${result.verdict}; reason: ${quote(result.reason)}`);
      writeOutputs(env, result);
      return true;
    },
  },
  "implement-result": {
    run: ({ positionals, io }) => {
      if (positionals.length !== 1) throw new Error("Usage: implement-result <file>");
      const result = parseImplementResult(readText(positionals[0], 16 * 1024 * 1024));
      io.log(`Implementation finished: ${quote(result)}`);
      return true;
    },
  },
  gate: { run: ({ env, io }) => runGate({ env, io }) },
  package: {
    options: { out: { type: "string" }, "git-dir": { type: "string" } },
    run: ({ values, env, io }) => {
      if (!values.out) throw new Error("Usage: package --out <dir> [--git-dir <dir>]");
      const { PLAN_COMMIT_SHA } = readEnv(env, ["PLAN_COMMIT_SHA"]);
      packageBuild({ cwd: process.cwd(), out: values.out, gitDir: values["git-dir"], planCommitSha: PLAN_COMMIT_SHA, io });
      return true;
    },
  },
  publish: {
    options: { work: { type: "string" }, artifact: { type: "string" } },
    run: ({ values, env, io }) => {
      if (!values.work || !values.artifact) throw new Error("Usage: publish --work <dir> --artifact <dir>");
      return runPublish({ env, work: values.work, artifact: values.artifact, io });
    },
  },
};

export async function main(argv, { env = process.env, io = { ...defaultIo, write: (text) => process.stdout.write(text) } } = {}) {
  const [name, ...args] = argv;
  const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : null;
  if (!command) throw new Error(`Unknown command ${quote(name ?? "")}; expected one of ${Object.keys(COMMANDS).join(", ")}.`);
  const { values, positionals } = parseArgs({ args, options: command.options ?? {}, allowPositionals: true, strict: true });
  return command.run({ values, positionals, env, io });
}

function invokedDirectly() {
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (invokedDirectly()) {
  main(process.argv.slice(2)).then((ok) => {
    if (!ok) process.exitCode = 1;
  }, (error) => {
    console.log(`::error::${(error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ")}`);
    process.exitCode = 1;
  });
}
