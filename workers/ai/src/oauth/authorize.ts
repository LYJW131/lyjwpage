import { AuthorizationError, authorizationErrorRedirect, type AuthRequest, type ResumedUpstream } from "@cloudflare/workers-oauth-provider";
import { OAUTH_AUTHORIZE_PATH, OAUTH_GITHUB_CALLBACK_PATH } from "@shared/ai-paths";
import { GITHUB_APP_CLIENT_ID } from "@shared/github-issue";
import { MCP_HISTORY_SCOPE } from "@shared/mcp-auth";
import { site } from "@shared/site";

import { verifyGithubVisitor } from "../build/handlers";
import { base64url } from "../crypto";
import type { Env } from "../runtime";
import { consentPage, messagePage } from "./consent-page";
import { authorizationServer, type McpGrantProps } from "./server";

type Upstream = { verifier: string };

function redirect(location: string, headers = new Headers()): Response {
  headers.set("Location", location);
  return new Response(null, { status: 302, headers });
}

// 只有 parseAuthRequest 校验过客户端与回调地址的错误才能重定向回客户端，其余就地渲染。
function authorizationFailure(error: unknown): Response {
  if (error instanceof AuthorizationError) {
    return error.redirectTo ? redirect(error.redirectTo) : messagePage(400, "This sign-in link is not valid.", error.description);
  }
  throw error;
}

async function s256(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

function githubAuthorizeUrl(state: string, challenge: string): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", GITHUB_APP_CLIENT_ID);
  url.searchParams.set("redirect_uri", `${site.url}${OAUTH_GITHUB_CALLBACK_PATH}`);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("allow_signup", "false");
  return url.href;
}

// 先在本站同意页问一次（防代理混淆：每个 MCP 客户端都经这一个 GitHub App 登录），同意后才跳 GitHub。
export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const oauth = authorizationServer.getOAuthApi(env);
  if (request.method === "GET") {
    let authRequest: AuthRequest;
    try {
      authRequest = await oauth.parseAuthRequest(request);
    } catch (error) {
      return authorizationFailure(error);
    }
    const details = await oauth.describeConsent(authRequest);
    const consent = await oauth.beginConsent(authRequest);
    consent.headers.set("Content-Type", "text/html; charset=utf-8");
    return new Response(consentPage(details, consent.handle, OAUTH_AUTHORIZE_PATH), { headers: consent.headers });
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });

  const form = await request.formData();
  const handle = String(form.get("handle") ?? "");
  try {
    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(request, handle);
      return redirect(denied.redirectTo, denied.headers);
    }
    const approved = await oauth.approveConsent(request, handle, { scope: [MCP_HISTORY_SCOPE] });
    const verifier = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    const { state, headers } = await oauth.beginUpstream(approved.request, { data: { verifier } satisfies Upstream, headers: approved.headers });
    return redirect(githubAuthorizeUrl(state, await s256(verifier)), headers);
  } catch (error) {
    return authorizationFailure(error);
  }
}

export async function handleGithubCallback(request: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  const oauth = authorizationServer.getOAuthApi(env);
  let resumed: ResumedUpstream<Upstream>;
  try {
    resumed = await oauth.finishUpstream<Upstream>(request);
  } catch (error) {
    if (error instanceof AuthorizationError) return messagePage(400, "This sign-in has expired.", "Start again from your MCP client.");
    throw error;
  }
  const { request: original, data, headers } = resumed;
  const code = new URL(request.url).searchParams.get("code");
  if (!code || !env.GITHUB_APP_CLIENT_SECRET) return redirect(authorizationErrorRedirect(original, "access_denied"), headers);

  const visitor = await verifyGithubVisitor(code, data.verifier, env.GITHUB_APP_CLIENT_SECRET, fetcher);
  if (visitor instanceof Response) return redirect(authorizationErrorRedirect(original, "temporarily_unavailable"), headers);
  if (visitor.userId !== site.githubId) {
    return redirect(authorizationErrorRedirect(original, "access_denied", `Only ${site.shortName} can sign in here.`), headers);
  }
  const { redirectTo } = await oauth.completeAuthorization({
    request: original,
    userId: String(visitor.userId),
    metadata: { login: visitor.account },
    scope: [MCP_HISTORY_SCOPE],
    props: { githubId: visitor.userId } satisfies McpGrantProps,
  });
  return redirect(redirectTo, headers);
}
