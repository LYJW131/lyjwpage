# /build 交接

> 类型：runbook

给接手 `/build` 的 agent：分支 `claude/claude-code-agent-sdk-6fc50c`（worktree `.claude/worktrees/claude-code-agent-sdk-6fc50c`），用户暂不合 main。功能现状与架构见 [build-routine.md](./build-routine.md)，那里是权威；本文只列没做完的事。做完一项就删掉对应条目，全部做完后删掉本文并从 [docs/README.md](./README.md) 撤下登记。

## 背景

- 用户的定位是「公开的协作构建」：任何 GitHub 账号都能用，不要提议只放行本人或协作者。
- 访客先在 `POST /api/build/chat` 和规划模型（Opus 5.5，`ANTHROPIC_API_KEY`）对话，模型调 `propose_build` 出计划，Worker 签成绑定账号的 1 小时 token；`POST /api/build` 只收这个 token。端到端已验证：PR #76（lyjw131[bot] 开，合著者是用户 Chrome 里连着的 @An0nCh1hayaa）。
- 提示词注入只做过两次手工试探：改 CI 那条是 API 自带的拒答拦下的（0 输出），`curl | sh` 那条是规划模型自己拒的。没有成体系的测试。

## 待办（按顺序）

1. **合 main。** main 有本分支没有的提交，其中 `1689da4b` 修了 Sentry 外泄（Worker 事件不再带请求头与正文；出站代理 DO 的 transaction 原先带 `x-api-key` 原文）和 GitHub issue 改走 PKCE。worktree 是 app 建的，用 ccd_host 的 `sync_with_base_branch` 合，预计三处冲突：
   - `src/lib/testing/register-alias.mjs`：两边修的是同一个问题（依赖包里的 CJS 相对 require），留 main 的写法。
   - `workers/api/src/github-issue.ts`：本分支把 `exchangeCode` / `revoke` 搬进了 `workers/api/src/github-oauth.ts`，main 给换 code 加了 PKCE 的 `code_verifier`。把 PKCE 搬进 `github-oauth.ts#exchangeCode`，`build-routine.ts#handleBuildSession` 也要收并转交 `code_verifier`。
   - `src/components/github-issue-panel.tsx`：本分支把 `signInWithGithub` 抽到了 `src/lib/github-sign-in.ts`（`/build` 共用），main 在面板里加了 PKCE 和抹掉地址栏 code。把 PKCE 合进 `src/lib/github-sign-in.ts`，`src/app/build/build-console.tsx` 的 `connect()` 把 verifier 一起 POST 给 `/api/build/session`。

   合完跑 `pnpm --dir workers/api typecheck`、`pnpm --dir workers/api test`、`pnpm test`、`pnpm docs:check`，推送后在预览上重连一次 GitHub 验证登录。
2. **轮换 `ROUTINE_FIRE_TOKEN`。** 合 main 之前，预览 Worker 的 `/fire` 经出站代理 DO 发出，`Authorization` 头里的令牌可能随 Sentry transaction 外泄（原因同 `1689da4b`）。合完、预览重建后，按 rotate-secret 技能的流程在 routine 的 API 触发器弹窗 Regenerate，值经剪贴板写进预览 Secret 与本机 `.dev.vars`（位置见 [ops-facts.md](./ops-facts.md)「Claude Code」）。预览上的 `ANTHROPIC_API_KEY` 同理建议换新；它属于哪个 Console 工作空间未核对，换的时候一并定下。
3. **CI 在带凭据的环境里跑 routine 推的分支代码**（见 [build-routine.md](./build-routine.md)「安全边界」）。三项都是仓库外设置，先问用户：Vercel 把 `GITHUB_TOKEN`、`SENTRY_AUTH_TOKEN`、`REVALIDATE_SECRET` 移出 Preview 或缩权；Workers Builds 能否排除 `claude/build-*` 分支的预览构建（构建令牌能部署 Worker，最严重）；敏感的 Actions Secret 放进只允许 main 的 GitHub Environment。更根本的做法是让 routine 推到 fork、以 fork PR 进来，改动大，作为选项提给用户。
4. **额度由用户拍板。** 现值见 `shared/build-routine.ts#BUILD_QUOTA`；对话每次最多 `BUILD_CHAT_LIMITS.maxToolRounds` 轮 Opus 调用。
5. **PR #76** 是冒烟测试，问用户要不要关（之前三个冒烟 PR 是用户要求关的）。`claude/build-*` 分支都还留着。
6. 小问题，不急：`/build` 刚加载就打字会被水合清空；计划里写「不要改 `workers/`」这类话也会命中 `build-chat.ts#OFF_LIMITS`，可能多来回一轮；THIS BROWSER 卡片的旧记录因格式改了而不显示。

## 本机状态

- 本 worktree 的 `workers/api/.dev.vars`：`BUILD_SESSION_SECRET` 故意与预览不同；`ROUTINE_FIRE_URL` 指向不存在的 routine，本地点 Start build 只会回 400，不起会话；`ALLOWED_ORIGINS` 配给 `.claude/launch.json` 的 `api-worker-alt` + `lyjwpage-local-alt`。
- 本地测试会话：用 `.dev.vars` 的 `BUILD_SESSION_SECRET` 调 `workers/api/src/build-routine.ts#signSession` 签一个短期会话，写进 localStorage 的 `build-github-session`。
- 开发服务器已停；`lyjwpage-local-alt` 会改动 `tsconfig.json`，提交前还原。
