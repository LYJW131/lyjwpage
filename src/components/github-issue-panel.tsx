"use client";

import { useState } from "react";

import { workerUrl } from "@/lib/worker-url";
import { signInWithGithub } from "@/lib/github-sign-in";
import {
  GITHUB_ISSUE_LIMITS,
  GITHUB_ISSUE_PATH,
  GITHUB_ISSUE_REPO,
  type GithubIssueDraft,
  type GithubIssueResult,
} from "@shared/github-issue";

const ISSUE_URL = workerUrl(process.env.NEXT_PUBLIC_BACKEND_URL, GITHUB_ISSUE_PATH);

type Status = { kind: "idle" } | { kind: "working" } | { kind: "error"; message: string } | ({ kind: "done" } & GithubIssueResult);

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
