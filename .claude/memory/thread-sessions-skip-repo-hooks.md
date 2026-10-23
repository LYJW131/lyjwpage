---
name: thread-sessions-skip-repo-hooks
description: Claude Projects thread sessions do not run the repo's .claude/settings.json hooks (guards, tokens.ci) — only the platform launcher hooks
metadata:
  type: project
---

Verified 2026-10-24 04:55 SGT in a project thread: `scripts/guard-forbidden-commands.mjs` blocks `git -c user.name=x status` when called directly (exit 2), but the same Bash call in the thread was not blocked. The thread's Claude runs with `/home/claude/.claude/launcher-settings.json` hooks only (PostToolUse nudge, Stop git-check + reply-gate, UserPromptSubmit reminder). A standalone cloud session on the same env does run repo hooks (lyjw saw tokens.ci uploads from one).

Official (code.claude.com/docs/en/claude-projects「What threads pick up from your repositories」): cloud threads load CLAUDE.md/.claude/rules only; repo `.claude/settings.json` hooks, permissions, env, plugins, skills, .mcp.json are not used. Only alternatives: run the thread on lyjw's computer, or the environment setup script / env vars.

Consequences: in threads, the identity/deploy guard, `guard-merge-method.ts`, and the tokens.ci SessionStart/Stop hooks ([[tokens-ci-cloud-hook]]) do not fire. Threads must follow those rules by hand (run `pnpm merge-message`, pass `expectedHeadSha`, etc.).

2026-10-24 05:40 SGT (probe in thread「项目讨论串加载哪些配置」): per the same doc table, threads load only root `CLAUDE.md`/`.claude/CLAUDE.md` and NON-path-specific `.claude/rules/`. All 7 lyjwpage rules have `paths:` frontmatter, and nested `CLAUDE.md` (workers/*, scripts, reporters/*, docs/explainer) are subdir files, so none load in threads: reading `workers/core/package.json` and `shared/state-core.ts` injected nothing. Threads must open those files by hand. Thread process: `CLAUDE_CODE_ENTRYPOINT=remote_projects`, hooks/permissions come from `/home/claude/.claude/launcher-settings.json`. Standalone cloud sessions (cloud-environments doc「What carries over」) do load repo hooks, permissions, `.mcp.json` (single repo), skills, agents, commands; repo-declared plugins load in neither.

**How to apply:** don't claim a repo hook protects thread work. Re-test after platform updates with the same direct-vs-in-thread comparison.
