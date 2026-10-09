import { BUILD_PLAN_TTL_MS, BUILD_TOKEN_MAX_CHARS, type BuildPlan, type BuildProposal } from "@shared/build-routine";
import type { Env } from "../runtime";
import { signBuildToken, verifyBuildToken } from "./token";
import { parseBuildPlan } from "./validation";
export { parseBuildPlan } from "./validation";

export type PlanPayload = { kind: "plan"; id: string; plan: BuildPlan; expiresAt: number };

export async function issuePlan(env: Env, value: unknown): Promise<BuildProposal> {
  const plan = parseBuildPlan(value);
  if (!plan) throw new Error("The plan is invalid or includes protected paths.");
  if (!env.BUILD_SESSION_SECRET || !env.BUILD_COORDINATOR) throw new Error("Build planning is unavailable.");
  const expiresAt = Date.now() + BUILD_PLAN_TTL_MS;
  const token = await signBuildToken<PlanPayload>({ kind: "plan", id: crypto.randomUUID(), plan, expiresAt }, env.BUILD_SESSION_SECRET);
  if (token.length > BUILD_TOKEN_MAX_CHARS) throw new Error("The plan is too large to sign. Shorten its text.");
  return { plan, token, expiresAt };
}

export async function readPlan(env: Env, token: string): Promise<PlanPayload | null> {
  if (!env.BUILD_SESSION_SECRET) return null;
  const payload = await verifyBuildToken<PlanPayload>(token, env.BUILD_SESSION_SECRET, "plan");
  return payload && typeof payload.id === "string" && parseBuildPlan(payload.plan) ? payload : null;
}

export async function consumePlan(env: Env, token: string): Promise<BuildPlan | null> {
  const payload = await readPlan(env, token);
  if (!payload || !env.BUILD_COORDINATOR) return null;
  return await env.BUILD_COORDINATOR.getByName("global").claimPlan(payload.id, payload.expiresAt) ? payload.plan : null;
}
