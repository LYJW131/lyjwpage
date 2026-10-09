"use client";

import { useState } from "react";

import { workerUrl } from "@/lib/worker-url";
import {
  GITHUB_APP_CLIENT_ID,
  GITHUB_CALLBACK_PATH,
  GITHUB_ISSUE_LIMITS,
  GITHUB_ISSUE_PATH,
  GITHUB_ISSUE_REPO,
  GITHUB_SIGN_IN_MESSAGE,
  type GithubIssueDraft,
  type GithubIssueResult,
} from "@shared/github-issue";

const ISSUE_URL = workerUrl(process.env.NEXT_PUBLIC_BACKEND_URL, GITHUB_ISSUE_PATH);
const CANCELLED = "GitHub sign-in was cancelled.";
const UNAVAILABLE = "GitHub sign-in isn't available in this browser.";

type Status = { kind: "idle" } | { kind: "working" } | { kind: "error"; message: string } | ({ kind: "done" } & GithubIssueResult);

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type SignIn = { code: string; codeVerifier: string };

// window.open 必须在点击的同一个调用栈里同步发出，否则会被当成弹窗广告拦掉；PKCE 的 SHA-256 是异步的，所以先开空白弹窗，算完 challenge 再把它导去 GitHub。
function signInWithGithub(): Promise<SignIn> {
  if (!crypto.subtle) return Promise.reject(new Error(UNAVAILABLE));
  const state = crypto.randomUUID();
  const codeVerifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const popup = window.open("about:blank", "github-sign-in", "popup,width=520,height=720");
  if (!popup) return Promise.reject(new Error("Allow pop-ups for this site to sign in with GitHub."));
  return new Promise((resolve, reject) => {
    const done = () => {
      window.removeEventListener("message", onMessage);
      clearInterval(timer);
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; state?: unknown; code?: unknown } | null;
      if (event.origin !== location.origin || data?.type !== GITHUB_SIGN_IN_MESSAGE || data.state !== state) return;
      done();
      if (typeof data.code === "string" && data.code) resolve({ code: data.code, codeVerifier });
      else reject(new Error(CANCELLED));
    };
    const timer = setInterval(() => {
      if (!popup.closed) return;
      done();
      reject(new Error(CANCELLED));
    }, 500);
    window.addEventListener("message", onMessage);
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier)).then(
      (hash) => {
        const url = new URL("https://github.com/login/oauth/authorize");
        url.searchParams.set("client_id", GITHUB_APP_CLIENT_ID);
        url.searchParams.set("redirect_uri", `${location.origin}${GITHUB_CALLBACK_PATH}`);
        url.searchParams.set("state", state);
        url.searchParams.set("code_challenge", base64url(new Uint8Array(hash)));
        url.searchParams.set("code_challenge_method", "S256");
        if (!popup.closed) popup.location.href = url.href;
      },
      () => {
        done();
        popup.close();
        reject(new Error(UNAVAILABLE));
      },
    );
  });
}

export function IssuePanel({ draft, onClose }: { draft: GithubIssueDraft; onClose: () => void }) {
  const [title, setTitle] = useState(draft.title);
  const [body, setBody] = useState(draft.body);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const working = status.kind === "working";

  async function submit() {
    if (!ISSUE_URL) {
      setStatus({ kind: "error", message: "Filing issues is offline right now." });
      return;
    }
    setStatus({ kind: "working" });
    try {
      const { code, codeVerifier } = await signInWithGithub();
      const res = await fetch(ISSUE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, codeVerifier, title, body }),
      });
      const data = (await res.json().catch(() => null)) as (GithubIssueResult & { error?: string }) | null;
      if (!res.ok || !data?.url) throw new Error(data?.error ?? "Couldn't open the issue. Try again.");
      setStatus({ kind: "done", url: data.url, number: data.number });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error && err.message !== "Failed to fetch" ? err.message : "Couldn't reach the server." });
    }
  }

  return (
    <div className="mb-2 rounded-md border border-line-strong bg-surface px-3 py-2 font-mono text-[11px] text-muted-foreground">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-foreground">New issue · {GITHUB_ISSUE_REPO}</span>
        <button type="button" onClick={onClose} aria-label="Close issue draft" className="hover:text-foreground">
          esc
        </button>
      </div>
      {status.kind === "done" ? (
        <div>
          Opened{" "}
          <a href={status.url} target="_blank" rel="noreferrer noopener" className="text-foreground underline underline-offset-2">
            #{status.number}
          </a>{" "}
          on GitHub. Thanks!
        </div>
      ) : (
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={GITHUB_ISSUE_LIMITS.titleChars}
            placeholder="Title"
            aria-label="Issue title"
            disabled={working}
            className="rounded border border-line bg-background px-2 py-1 text-base text-foreground outline-none focus:border-foreground/40 sm:text-sm"
          />
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={GITHUB_ISSUE_LIMITS.bodyChars}
            rows={5}
            placeholder="What happened, or what would you like? (Markdown)"
            aria-label="Issue body"
            disabled={working}
            className="scrollbar-none max-h-32 resize-none rounded border border-line bg-background px-2 py-1 text-base text-foreground outline-none [field-sizing:content] focus:border-foreground/40 sm:max-h-48 sm:text-sm [&::-webkit-scrollbar]:hidden"
          />
          {status.kind === "error" && <div className="text-red-500">{status.message}</div>}
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
            <span>Posted publicly under your GitHub account.</span>
            <button
              type="submit"
              disabled={working || !title.trim()}
              className="ml-auto shrink-0 rounded bg-foreground px-2.5 py-1 text-background transition-opacity disabled:opacity-40"
            >
              {working ? "Waiting for GitHub…" : "Sign in with GitHub & submit"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
