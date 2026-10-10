import { DurableObject } from "cloudflare:workers";
import { BUILD_DESIGN_LIMITS, BUILD_QUOTA, BUILD_RECONCILE_MS, BUILD_REPO, BUILD_STATUS_TTL_MS, BUILD_TIMEOUT_MS, type BuildPlan, type BuildRun } from "@shared/build-routine";
import type { Env } from "../runtime";

export type StoredRun = { state: BuildRun; plan: BuildPlan; account: string; accountId?: number; coauthor: string; sessionUrl?: string; baseSha: string; uploadHash: string; uploadUsed: boolean; uploadExpiresAt: number; callbackOrigin?: string; planCommitSha?: string; implementationHeadSha?: string; publicationBody?: string; preparation?: { token: string; expiresAt: number }; dispatchAttempted?: boolean; reviewRequested?: boolean };
type PlanReservation = { runId: string; accountId?: number };
const PREPARATION_LEASE_MS = 60_000;
const PUBLICATION_BODY_MAX_CHARS = 64_000;
const phases = { triggered: 0, running: 1, uploaded: 2, validated: 3, pr_open: 4, blocked: 5, failed: 5, timeout: 5, merged: 6, closed: 6 } as const;

function preparedRun(run: StoredRun): boolean {
  return !!(run.callbackOrigin || run.planCommitSha || run.dispatchAttempted);
}

function acceptsAgentUpdates(run: StoredRun): boolean {
  return !preparedRun(run) || !!(run.dispatchAttempted && run.planCommitSha && run.state.pr);
}

function validPreparedPullRequest(planCommitSha: string, pr: NonNullable<BuildRun["pr"]>): boolean {
  return /^[a-f0-9]{40}$/.test(planCommitSha) && pr.headSha === planCommitSha && pr.draft === true && Number.isSafeInteger(pr.number) && pr.number > 0 && pr.url === `https://github.com/${BUILD_REPO}/pull/${pr.number}`;
}

export class BuildCoordinator extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS build_records (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL)");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS build_hits (kind TEXT NOT NULL, account TEXT NOT NULL, at INTEGER NOT NULL)");
    ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS build_hits_at ON build_hits(at)");
  }

  private get<T>(key: string): T | null {
    const rows = this.ctx.storage.sql.exec<{ value: string }>("SELECT value FROM build_records WHERE key = ? AND expires > ?", key, Date.now()).toArray();
    return rows.length ? JSON.parse(rows[0].value) as T : null;
  }

  private put(key: string, value: unknown, expires: number): void {
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO build_records(key, value, expires) VALUES (?, ?, ?)", key, JSON.stringify(value), expires);
  }

  private prune(): void {
    this.ctx.storage.sql.exec("DELETE FROM build_records WHERE expires <= ?", Date.now());
    this.ctx.storage.sql.exec("DELETE FROM build_hits WHERE at <= ?", Date.now() - BUILD_QUOTA.windowMs);
  }

  private count(kind: string, account?: string): number {
    const row = account === undefined
      ? this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM build_hits WHERE kind = ?", kind).one()
      : this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM build_hits WHERE kind = ? AND account = ?", kind, account).one();
    return Number(row.n);
  }

  createDesign(id: string, expiresAt: number): boolean {
    return this.ctx.storage.transactionSync(() => {
      this.prune();
      if (expiresAt <= Date.now() || expiresAt > Date.now() + BUILD_DESIGN_LIMITS.ttlMs || this.get(`design:${id}`) || this.count("design") >= BUILD_DESIGN_LIMITS.everyone) return false;
      this.put(`design:${id}`, { turns: 0, expiresAt }, expiresAt);
      this.ctx.storage.sql.exec("INSERT INTO build_hits VALUES (?, ?, ?)", "design", "", Date.now());
      return true;
    });
  }

  admitDesign(id: string): { status: "ok" | "expired" | "exhausted"; remaining: number } {
    return this.ctx.storage.transactionSync(() => {
      const session = this.get<{ turns: number; expiresAt: number }>(`design:${id}`);
      if (!session) return { status: "expired", remaining: 0 };
      if (session.turns >= BUILD_DESIGN_LIMITS.maxTurns) return { status: "exhausted", remaining: 0 };
      session.turns += 1;
      this.put(`design:${id}`, session, session.expiresAt);
      return { status: "ok", remaining: BUILD_DESIGN_LIMITS.maxTurns - session.turns };
    });
  }

  claimPlan(id: string, expiresAt: number): boolean {
    return this.ctx.storage.transactionSync(() => {
      this.prune();
      if (expiresAt <= Date.now() || this.get(`plan:${id}`)) return false;
      this.put(`plan:${id}`, true, expiresAt);
      return true;
    });
  }

  reserveRun(run: StoredRun, planId: string, planExpiresAt: number): "ok" | "used" | "account" | "site" {
    return this.ctx.storage.transactionSync(() => {
      this.prune();
      if (planExpiresAt <= Date.now() || this.get(`plan:${planId}`) || this.get(`run:${run.state.runId}`)) return "used";
      if (this.count("fire", String(run.accountId ?? run.account)) >= BUILD_QUOTA.fire.account) return "account";
      if (this.count("fire") >= BUILD_QUOTA.fire.everyone) return "site";
      this.put(`plan:${planId}`, { runId: run.state.runId, accountId: run.accountId } satisfies PlanReservation, run.state.createdAt + BUILD_STATUS_TTL_MS);
      this.put(`run:${run.state.runId}`, run, run.state.createdAt + BUILD_STATUS_TTL_MS);
      this.ctx.storage.sql.exec("INSERT INTO build_hits VALUES (?, ?, ?)", "fire", String(run.accountId ?? run.account), Date.now());
      return "ok";
    });
  }

  isPlanUsed(id: string): boolean {
    return !!this.get(`plan:${id}`);
  }

  hasPlanRun(planId: string): boolean {
    const reservation = this.get<PlanReservation | true>(`plan:${planId}`);
    return typeof reservation === "object" && !!reservation?.runId && !!this.readRun(reservation.runId);
  }

  findPlanRun(planId: string, accountId: number): StoredRun | null {
    const reservation = this.get<PlanReservation | true>(`plan:${planId}`);
    if (!Number.isSafeInteger(accountId) || typeof reservation !== "object" || reservation?.accountId !== accountId) return null;
    const run = this.readRun(reservation.runId);
    return run?.accountId === accountId ? run : null;
  }

  readRun(runId: string): StoredRun | null {
    const run = this.get<StoredRun>(`run:${runId}`);
    const expired = run && (["triggered", "running"].includes(run.state.phase)
      ? Date.now() >= run.state.createdAt + BUILD_TIMEOUT_MS
      : ["uploaded", "validated"].includes(run.state.phase) && Date.now() >= run.state.updatedAt + BUILD_TIMEOUT_MS);
    if (run && expired) {
      run.state = { ...run.state, phase: "timeout", reason: "Timed out; the result is unknown.", updatedAt: Date.now() };
      this.put(`run:${runId}`, run, run.state.createdAt + BUILD_STATUS_TTL_MS);
    }
    return run;
  }

  setSessionUrl(runId: string, sessionUrl: string): void {
    this.ctx.storage.transactionSync(() => {
      const run = this.readRun(runId);
      if (!run) return;
      run.sessionUrl = sessionUrl;
      this.put(`run:${runId}`, run, run.state.createdAt + BUILD_STATUS_TTL_MS);
    });
  }

  claimPreparation(runId: string): string | null {
    return this.ctx.storage.transactionSync(() => {
      const run = this.readRun(runId);
      if (!run || run.state.phase !== "triggered" || run.dispatchAttempted || run.uploadUsed || run.uploadExpiresAt <= Date.now() || run.preparation && run.preparation.expiresAt > Date.now()) return null;
      const token = crypto.randomUUID();
      run.preparation = { token, expiresAt: Date.now() + PREPARATION_LEASE_MS };
      this.put(`run:${runId}`, run, run.state.createdAt + BUILD_STATUS_TTL_MS);
      return token;
    });
  }

  releasePreparation(runId: string, token: string): void {
    this.ctx.storage.transactionSync(() => {
      const run = this.readRun(runId);
      if (!run || run.preparation?.token !== token) return;
      delete run.preparation;
      this.put(`run:${runId}`, run, run.state.createdAt + BUILD_STATUS_TTL_MS);
    });
  }

  failPreparation(runId: string, token: string, reason: string, blocked = false): boolean {
    return this.ctx.storage.transactionSync(() => {
      const run = this.readRun(runId);
      if (!run || run.preparation?.token !== token || run.preparation.expiresAt <= Date.now() || run.dispatchAttempted || run.state.phase !== "triggered") return false;
      run.state = { ...run.state, phase: blocked ? "blocked" : "triggered", reason, updatedAt: Date.now() };
      this.put(`run:${runId}`, run, run.state.createdAt + BUILD_STATUS_TTL_MS);
      return true;
    });
  }

  setPrepared(runId: string, planCommitSha: string, pr: NonNullable<BuildRun["pr"]>, token: string): BuildRun | null {
    return this.ctx.storage.transactionSync(() => {
      const run = this.readRun(runId);
      if (!run || run.preparation?.token !== token || run.preparation.expiresAt <= Date.now() || run.dispatchAttempted || run.state.phase !== "triggered" || run.uploadExpiresAt <= Date.now()) return null;
      if (!validPreparedPullRequest(planCommitSha, pr) || planCommitSha === run.baseSha || run.planCommitSha && run.planCommitSha !== planCommitSha || run.state.pr && run.state.pr.number !== pr.number) return null;
      run.planCommitSha = planCommitSha;
      run.state = { ...run.state, pr, reason: undefined, updatedAt: Date.now() };
      this.put(`run:${runId}`, run, run.state.createdAt + BUILD_STATUS_TTL_MS);
      return run.state;
    });
  }

  setLegacyPrepared(runId: string, planCommitSha: string, pr: NonNullable<BuildRun["pr"]>): boolean {
    return this.ctx.storage.transactionSync(() => {
      const run = this.readRun(runId);
      if (!run || run.callbackOrigin !== undefined || run.planCommitSha !== undefined || !run.uploadUsed || run.state.phase !== "validated") return false;
      if (!validPreparedPullRequest(planCommitSha, pr) || planCommitSha === run.baseSha || run.state.pr && (run.state.pr.number !== pr.number || run.state.pr.url !== pr.url || run.state.pr.headSha !== planCommitSha)) return false;
      run.planCommitSha = planCommitSha;
      run.state = { ...run.state, pr, updatedAt: Date.now() };
      this.put(`run:${runId}`, run, run.state.createdAt + BUILD_STATUS_TTL_MS);
      return true;
    });
  }

  claimDispatch(runId: string): boolean {
    return this.ctx.storage.transactionSync(() => {
      const run = this.readRun(runId);
      if (!run || run.state.phase !== "triggered" || run.dispatchAttempted || run.preparation || run.uploadUsed || run.uploadExpiresAt <= Date.now() || !run.planCommitSha || run.state.pr?.headSha !== run.planCommitSha || run.state.pr.draft !== true) return false;
      run.dispatchAttempted = true;
      this.put(`run:${runId}`, run, run.state.createdAt + BUILD_STATUS_TTL_MS);
      return true;
    });
  }

  failDispatch(runId: string, reason: string, rejected = false): boolean {
    return this.ctx.storage.transactionSync(() => {
      const run = this.readRun(runId);
      if (!run?.dispatchAttempted || !["triggered", "running"].includes(run.state.phase)) return false;
      run.state = { ...run.state, phase: rejected ? "failed" : run.state.phase, reason, updatedAt: Date.now() };
      this.put(`run:${runId}`, run, run.state.createdAt + BUILD_STATUS_TTL_MS);
      return true;
    });
  }

  failPublication(runId: string, patch: { phase?: "failed" | "blocked"; reason: string }, expected: BuildRun): BuildRun | null {
    return this.ctx.storage.transactionSync(() => {
      const run = this.readRun(runId);
      if (!run) return null;
      if (["closed", "merged"].includes(run.state.phase) || run.state.phase !== expected.phase || run.state.pr?.headSha !== expected.pr?.headSha || run.state.pr?.draft !== expected.pr?.draft) return run.state;
      run.state = { ...run.state, ...patch, updatedAt: Date.now() };
      this.put(`run:${runId}`, run, run.state.createdAt + BUILD_STATUS_TTL_MS);
      return run.state;
    });
  }

  completePublication(runId: string, pr: NonNullable<BuildRun["pr"]>): BuildRun | null {
    return this.ctx.storage.transactionSync(() => {
      const run = this.readRun(runId);
      if (!run || !run.uploadUsed || !run.implementationHeadSha || pr.headSha !== run.implementationHeadSha || pr.number !== run.state.pr?.number || pr.url !== run.state.pr.url || typeof pr.draft !== "boolean") return null;
      if (["closed", "merged", "blocked"].includes(run.state.phase) || run.state.phase === "pr_open" && run.state.pr.headSha === run.implementationHeadSha) return run.state;
      if (!["validated", "failed", "timeout"].includes(run.state.phase)) return null;
      const updatedAt = Date.now();
      const signals = run.state.pr.headSha !== pr.headSha ? { ci: { state: "unknown", updatedAt }, preview: { state: "unknown", updatedAt } } : {};
      run.state = { ...run.state, ...signals, phase: "pr_open", pr, reason: undefined, updatedAt };
      this.put(`run:${runId}`, run, run.state.createdAt + BUILD_STATUS_TTL_MS);
      return run.state;
    });
  }

  setImplementationHead(runId: string, sha: string, body?: string): boolean {
    return this.ctx.storage.transactionSync(() => {
      const run = this.readRun(runId);
      if (!run || !run.uploadUsed || run.state.phase !== "validated" || !run.planCommitSha || !run.state.pr || !/^[a-f0-9]{40}$/.test(sha) || sha === run.planCommitSha || run.implementationHeadSha && run.implementationHeadSha !== sha) return false;
      if (body !== undefined && (body.length > PUBLICATION_BODY_MAX_CHARS || run.publicationBody !== undefined && run.publicationBody !== body)) return false;
      run.implementationHeadSha = sha;
      if (body !== undefined) run.publicationBody = body;
      this.put(`run:${runId}`, run, run.state.createdAt + BUILD_STATUS_TTL_MS);
      return true;
    });
  }

  claimReviewRequests(runId: string): boolean {
    return this.ctx.storage.transactionSync(() => {
      const run = this.readRun(runId);
      if (!run || run.reviewRequested || run.state.phase !== "pr_open" || !run.uploadUsed || !run.implementationHeadSha || run.state.pr?.headSha !== run.implementationHeadSha) return false;
      run.reviewRequested = true;
      this.put(`run:${runId}`, run, run.state.createdAt + BUILD_STATUS_TTL_MS);
      return true;
    });
  }

  claimUpload(runId: string, hash: string): StoredRun | null {
    return this.ctx.storage.transactionSync(() => {
      const run = this.readRun(runId);
      if (!run || !acceptsAgentUpdates(run) || run.uploadUsed || run.uploadHash !== hash || run.uploadExpiresAt <= Date.now() || !["triggered", "running"].includes(run.state.phase)) return null;
      run.uploadUsed = true;
      run.state = { ...run.state, phase: "uploaded", reason: undefined, updatedAt: Date.now() };
      this.put(`run:${runId}`, run, run.state.createdAt + BUILD_STATUS_TTL_MS);
      return run;
    });
  }

  progress(runId: string, hash: string, message: string): boolean {
    return this.ctx.storage.transactionSync(() => {
      const run = this.readRun(runId);
      if (!run || !acceptsAgentUpdates(run) || run.uploadUsed || run.uploadHash !== hash || run.uploadExpiresAt <= Date.now() || !["triggered", "running"].includes(run.state.phase)) return false;
      run.state = { ...run.state, phase: "running", reason: undefined, progress: message.slice(0, 200), updatedAt: Date.now() };
      this.put(`run:${runId}`, run, run.state.createdAt + BUILD_STATUS_TTL_MS);
      return true;
    });
  }

  // 计划路径加计划外名额仍不够、只能靠断言或放宽测试才能完成时，routine 用它停下：同样占用上传令牌，停下后不能再上传。
  blockRun(runId: string, hash: string, reason: string): boolean {
    return this.ctx.storage.transactionSync(() => {
      const run = this.readRun(runId);
      if (!run || !acceptsAgentUpdates(run) || run.uploadUsed || run.uploadHash !== hash || run.uploadExpiresAt <= Date.now() || !["triggered", "running"].includes(run.state.phase)) return false;
      run.uploadUsed = true;
      run.state = { ...run.state, phase: "blocked", reason, progress: undefined, updatedAt: Date.now() };
      this.put(`run:${runId}`, run, run.state.createdAt + BUILD_STATUS_TTL_MS);
      return true;
    });
  }

  updateRun(runId: string, patch: Partial<BuildRun>, expectedHeadSha?: string): BuildRun | null {
    return this.ctx.storage.transactionSync(() => {
      const run = this.readRun(runId);
      if (!run) return null;
      patch = { ...patch };
      if (expectedHeadSha && run.state.pr?.headSha !== expectedHeadSha) return run.state;
      if (patch.pr && run.state.pr && patch.pr.number !== run.state.pr.number) return run.state;
      if (preparedRun(run) && patch.pr && (!run.state.pr || patch.pr.headSha !== run.state.pr.headSha && patch.pr.headSha !== run.implementationHeadSha)) {
        delete patch.phase;
        delete patch.pr;
        delete patch.ci;
        delete patch.preview;
        delete patch.review;
        delete patch.githubUpdatedAt;
        patch.reconciledAt = 0;
      }
      const publicationAdvance = preparedRun(run) && run.uploadUsed && !!run.implementationHeadSha && patch.pr?.headSha === run.implementationHeadSha && run.state.pr?.headSha !== run.implementationHeadSha;
      if (!expectedHeadSha && !publicationAdvance && patch.pr && run.state.pr && patch.pr.headSha !== run.state.pr.headSha && patch.githubUpdatedAt === run.state.githubUpdatedAt) {
        delete patch.phase;
        delete patch.pr;
        delete patch.ci;
        delete patch.preview;
        delete patch.review;
        patch.reconciledAt = 0;
      }
      if (patch.githubUpdatedAt && run.state.githubUpdatedAt && patch.githubUpdatedAt < run.state.githubUpdatedAt) {
        delete patch.githubUpdatedAt;
        if (!publicationAdvance) {
          delete patch.phase;
          delete patch.pr;
          delete patch.ci;
          delete patch.preview;
          delete patch.review;
          delete patch.reconciledAt;
        }
      }
      const published = run.uploadUsed && !!run.implementationHeadSha && (patch.pr ?? run.state.pr)?.headSha === run.implementationHeadSha;
      if (preparedRun(run) && patch.phase === "pr_open" && !published) delete patch.phase;
      const reopened = run.state.phase === "closed" && patch.phase === "pr_open" && !!patch.githubUpdatedAt && (patch.githubUpdatedAt > (run.state.githubUpdatedAt ?? 0) || !!expectedHeadSha);
      const confirmedPr = patch.phase === "pr_open" && !!patch.pr && run.uploadUsed && (!preparedRun(run) || published) && ["failed", "timeout"].includes(run.state.phase);
      if (patch.phase && phases[patch.phase] < phases[run.state.phase] && !reopened && !confirmedPr) delete patch.phase;
      if (run.state.phase === "merged") delete patch.phase;
      if (confirmedPr || patch.phase === "pr_open" || patch.phase === "merged" || patch.phase === "closed") patch.reason = undefined;
      if (patch.pr && run.state.pr && patch.pr.headSha !== run.state.pr.headSha) {
        patch.ci = { state: "unknown", updatedAt: Date.now() };
        patch.preview = { state: "unknown", updatedAt: Date.now() };
      }
      for (const field of ["ci", "preview", "review"] as const) {
        if (patch[field] && run.state[field] && patch[field].updatedAt < run.state[field].updatedAt) delete patch[field];
      }
      run.state = { ...run.state, ...patch, runId, branch: run.state.branch, createdAt: run.state.createdAt, updatedAt: Date.now() };
      this.put(`run:${runId}`, run, run.state.createdAt + BUILD_STATUS_TTL_MS);
      return run.state;
    });
  }

  findRun(headSha?: string, prNumber?: number): StoredRun | null {
    if (!headSha && !prNumber) return null;
    const rows = headSha
      ? this.ctx.storage.sql.exec<{ value: string }>("SELECT value FROM build_records WHERE key LIKE 'run:%' AND json_extract(value, '$.state.pr.headSha') = ? AND expires > ? LIMIT 1", headSha, Date.now()).toArray()
      : this.ctx.storage.sql.exec<{ value: string }>("SELECT value FROM build_records WHERE key LIKE 'run:%' AND json_extract(value, '$.state.pr.number') = ? AND expires > ? LIMIT 1", prNumber!, Date.now()).toArray();
    return rows.length ? JSON.parse(rows[0].value) as StoredRun : null;
  }

  claimReconcile(runId: string): boolean {
    return this.ctx.storage.transactionSync(() => {
      const run = this.readRun(runId);
      if (!run || !run.state.pr || ["merged", "closed"].includes(run.state.phase) || this.get(`reconcile:${runId}`)) return false;
      this.put(`reconcile:${runId}`, true, Date.now() + BUILD_RECONCILE_MS);
      return true;
    });
  }

  hasDelivery(id: string): boolean {
    return !!this.get(`delivery:${id}`);
  }

  completeDelivery(id: string): void {
    this.ctx.storage.transactionSync(() => {
      this.prune();
      this.put(`delivery:${id}`, true, Date.now() + BUILD_STATUS_TTL_MS);
    });
  }
}
