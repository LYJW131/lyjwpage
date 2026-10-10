import { HttpError, parseModel, readError, TERMINAL_RUN_STATUSES } from "./cursor-cloud.mjs";

// 分支既是 agent 的工作分支，也是「这条告警已经派过」的标记：分支在就跳过，删掉分支即重试。
export const BRANCH_PREFIX = "codeql-fix/alert-";
export const DEFAULT_LIMIT = 10;
export const DEFAULT_WAIT_MS = 110 * 60_000;

const GITHUB_API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 30_000;
const MAX_HELP_CHARS = 4_000;
const SECURITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const SEVERITY_RANK = { error: 0, warning: 1, note: 2 };

export const alertBranch = (alert) => `${BRANCH_PREFIX}${alert.number}`;

export function sortAlerts(alerts) {
  const rank = (alert) => [
    SECURITY_RANK[alert.rule?.security_severity_level] ?? 9,
    SEVERITY_RANK[alert.rule?.severity] ?? 9,
    alert.number,
  ];
  return [...alerts].sort((a, b) => {
    const [x, y] = [rank(a), rank(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
}

function location(alert) {
  const loc = alert.most_recent_instance?.location ?? {};
  if (!loc.path) return "unknown location";
  const lines = loc.start_line ? (loc.end_line && loc.end_line !== loc.start_line ? ` lines ${loc.start_line}-${loc.end_line}` : ` line ${loc.start_line}`) : "";
  return `\`${loc.path}\`${lines}`;
}

export function buildAlertPrompt({ repo, alert, branch, baseRef }) {
  const rule = alert.rule ?? {};
  const severity = [rule.severity && `severity ${rule.severity}`, rule.security_severity_level && `security severity ${rule.security_severity_level}`].filter(Boolean).join(", ");
  const help = (rule.help || rule.full_description || "").trim();
  const sections = [
    `Fix CodeQL code scanning alert #${alert.number} in ${repo}.`,
    "",
    `- Rule: \`${rule.id}\` — ${rule.description ?? rule.name ?? ""}${severity ? ` (${severity})` : ""}`,
    `- Location: ${location(alert)}`,
    `- Message: ${alert.most_recent_instance?.message?.text ?? ""}`,
    `- Alert: ${alert.html_url}`,
  ];
  if (help) sections.push("", "## Rule help", "", help.length > MAX_HELP_CHARS ? `${help.slice(0, MAX_HELP_CHARS)}…` : help);
  sections.push(
    "",
    "## How to work",
    `- You are on branch \`${branch}\`, created from \`${baseRef}\`. Commit the fix on this branch; a pull request is opened from it when you finish. This PR must address only this one alert.`,
    "- Fix the root cause in the code. Do not silence the alert: no suppression comments (`codeql[...]`, `lgtm`), no edits to CodeQL configuration, query filters or workflow scan settings, and no skipping or disabling tests or checks.",
    "- Follow the repository's AGENTS.md and the nested AGENTS.md files for the directories you touch, including their validation steps. Run the relevant tests, lint and typecheck for what you changed.",
    "- If the alert is a false positive, or cannot be fixed safely without a larger design change, make no changes and explain why in your final message.",
    "- Write the commit message in the repository's existing convention (see `git log`).",
    "- Finish with a short summary: what the problem was, how you fixed it, and how you verified it.",
  );
  return sections.join("\n");
}

export function githubClient({ token, repo, fetch = globalThis.fetch }) {
  async function request(method, path, body) {
    const response = await fetch(`${GITHUB_API}/repos/${repo}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "lyjwpage-codeql-autofix",
        "x-github-api-version": "2022-11-28",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new HttpError("GitHub", method, path, response.status, await readError(response));
    return response.status === 204 ? null : response.json();
  }
  const refPath = (kind, branch) => `/git/${kind}/heads/${branch.split("/").map(encodeURIComponent).join("/")}`;
  return {
    async listOpenAlerts() {
      const alerts = [];
      for (let page = 1; ; page += 1) {
        const batch = await request("GET", `/code-scanning/alerts?tool_name=CodeQL&state=open&per_page=100&page=${page}`);
        alerts.push(...batch);
        if (batch.length < 100) return alerts;
      }
    },
    async branchSha(branch) {
      try {
        return (await request("GET", refPath("ref", branch))).object.sha;
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) return null;
        throw error;
      }
    },
    createBranch: (branch, sha) => request("POST", "/git/refs", { ref: `refs/heads/${branch}`, sha }),
    deleteBranch: (branch) => request("DELETE", refPath("refs", branch)),
  };
}

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const prUrlOf = (run) => run?.git?.branches?.find((branch) => branch.prUrl)?.prUrl;

export async function runCodeqlAutofix({
  repo,
  baseRef,
  github,
  cursor,
  model,
  limit = DEFAULT_LIMIT,
  dryRun = false,
  waitMs = DEFAULT_WAIT_MS,
  log = console,
  sleep = sleepMs,
  now = Date.now,
  signal,
}) {
  const modelSelection = parseModel(model);
  const alerts = sortAlerts(await github.listOpenAlerts());
  log.log(`${alerts.length} 条未关闭的 CodeQL 告警`);
  const baseSha = alerts.length ? await github.branchSha(baseRef) : null;
  const items = [];
  let launched = 0;

  for (const alert of alerts) {
    const branch = alertBranch(alert);
    const item = { alert, branch };
    items.push(item);
    if (await github.branchSha(branch)) {
      item.outcome = "already attempted";
      continue;
    }
    if (launched >= limit) {
      item.outcome = "deferred";
      continue;
    }
    launched += 1;
    if (dryRun) {
      item.outcome = "would launch";
      continue;
    }
    try {
      await github.createBranch(branch, baseSha);
    } catch (error) {
      item.outcome = error instanceof HttpError && error.status === 422 ? "already attempted" : "launch failed";
      item.error = error.message;
      continue;
    }
    try {
      const { agent, run } = await cursor.createAgent({
        name: `CodeQL #${alert.number}: ${alert.rule?.id ?? ""}`.slice(0, 100),
        prompt: { text: buildAlertPrompt({ repo, alert, branch, baseRef }) },
        model: modelSelection,
        repos: [{ url: `https://github.com/${repo}`, startingRef: branch }],
        workOnCurrentBranch: true,
        autoCreatePR: true,
      });
      Object.assign(item, { agent, run, outcome: "running" });
      log.log(`#${alert.number} ${alert.rule?.id} → ${agent.url}`);
    } catch (error) {
      item.outcome = "launch failed";
      item.error = error.message;
      // 没起成 agent 就把标记分支删掉，下次还能重试。
      await github.deleteBranch(branch).catch((deleteError) => log.warn(`::warning::删除 ${branch} 失败：${deleteError.message}`));
    }
  }

  const running = () => items.filter((item) => item.run && !TERMINAL_RUN_STATUSES.has(item.run.status));
  const deadline = now() + waitMs;
  while (running().length && !signal?.aborted && now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    for (const item of running()) {
      try {
        item.run = await cursor.getRun(item.agent.id, item.run.id);
      } catch (error) {
        log.warn(`::warning::读取 #${item.alert.number} 的运行状态失败：${error.message}`);
      }
    }
  }
  if (signal?.aborted) {
    for (const item of running()) {
      await cursor.cancelRun(item.agent.id, item.run.id).catch((error) => log.warn(`::warning::取消 #${item.alert.number} 失败：${error.message}`));
      item.run = { ...item.run, status: "CANCELLED" };
    }
  }

  // PR 在运行结束后才由 Cursor 打开，刚 FINISHED 时 git 里可能还没有 prUrl。
  const awaitingPr = () => items.filter((item) => item.run?.status === "FINISHED" && !prUrlOf(item.run));
  for (let attempt = 0; attempt < 4 && awaitingPr().length && !signal?.aborted; attempt += 1) {
    await sleep(POLL_INTERVAL_MS);
    for (const item of awaitingPr()) item.run = await cursor.getRun(item.agent.id, item.run.id).catch(() => item.run);
  }

  for (const item of items) {
    if (!item.run) continue;
    const status = item.run.status;
    item.prUrl = prUrlOf(item.run);
    if (status === "FINISHED") item.outcome = item.prUrl ? "pr opened" : "no change";
    else if (TERMINAL_RUN_STATUSES.has(status)) item.outcome = status.toLowerCase();
    else item.outcome = "still running";
    item.result = item.run.result;
  }

  const failed = items.some((item) => ["launch failed", "error", "expired"].includes(item.outcome));
  return { items, code: failed ? 1 : 0 };
}

const cell = (text) => String(text ?? "").replace(/[\\|]/g, "\\$&").replace(/\s+/g, " ").trim();

export function renderSummary({ items, dryRun }) {
  const lines = [`## CodeQL autofix${dryRun ? " (dry run)" : ""}`, ""];
  if (!items.length) return [...lines, "No open CodeQL alerts."].join("\n");
  lines.push("| Alert | Rule | Location | Outcome | Links |", "| --- | --- | --- | --- | --- |");
  for (const item of items) {
    const links = [item.prUrl && `[PR](${item.prUrl})`, item.agent?.url && `[agent](${item.agent.url})`].filter(Boolean).join(" · ");
    lines.push(`| [#${item.alert.number}](${item.alert.html_url}) | \`${cell(item.alert.rule?.id)}\` | ${cell(location(item.alert))} | ${cell(item.outcome)} | ${links} |`);
  }
  const notes = items.filter((item) => item.error || (item.outcome === "no change" && item.result));
  if (notes.length) {
    lines.push("", "### Notes");
    for (const item of notes) lines.push("", `**#${item.alert.number}** (${item.outcome})`, "", item.error ?? item.result);
  }
  return lines.join("\n");
}
