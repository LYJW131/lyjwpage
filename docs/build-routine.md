# 访客协作构建

> 类型：runbook

首页对话是设计、提交 issue 和发起构建的入口。任何 GitHub 账号都能参与；代码不检查账号是否为仓库所有者或协作者。共享协议与上限统一见 `shared/build-routine.ts`，后端在 `workers/ai/src/build/`，HTTP 入口由 `shared/ai-paths.ts#AI_HTTP_PATHS` 登记，经 site 或 api 的 Service Binding 转发。写代码的是 GitHub Actions 工作流 `.github/workflows/build.yml`：提示词与 Claude Code 设置在 `.github/build/`，各 job 调用的脚本是 `scripts/build-actions.mjs`。部署与分支 Preview 使用 [Workers 构建](./workers-builds.md) 的既有流程。

## 设计与确认

Clef 将站点改动请求路由给 Sonnet；Sonnet 先判断是否值得做，只有调用 `start_design` 才创建设计会话，调用前先对访客说一句交接（模型没写时 Worker 按访客语言补 `shared/build-routine.ts#PLAN_LABELS` 的 `handoff`）：Worker 在 Claude Managed Agents 上开一个会话，对话卡片在交接处画一条设计会话分隔线，并在分隔线下方给出设计模式的隐私说明；访客同意后浏览器补发，Worker 才把这段对话交给会话里的 Opus 规划者，规划者的回复接在交接回复后面，从访客这条消息接着规划，不让访客再描述一遍。候选请求仍扣普通聊天额度，Sonnet 无空位时拒绝，不降级；开启会话的这一轮也计入设计轮数。已有有效会话的请求直接转给同一个 Managed Agents 会话，不再调用 Clef，也不扣普通聊天档位额度；规划者的上下文、读过的文件和沙盒都留在会话里，设计令牌只带会话 ID。会话期限、轮数和全站窗口上限以 `BUILD_DESIGN_LIMITS` 为准；计数存在 `BuildCoordinator`，复制浏览器存档不能刷新额度。会话过期或轮数耗尽后，浏览器清除设计令牌并恢复普通对话，在最后一条回复下标出会话已结束及原因（`/exit` 同样标出），提示重新描述改动可开新会话；服务端返回专用失效代码时也清除令牌。

规划者在会话沙盒里匿名克隆公开仓库 main，用 glob、grep、read 和只读命令查代码与文档，用 `get_site_status` 看实时数据，再用 `ask_visitor` 提问、`propose_build` 输出标题、Markdown 规格、验收项和预计路径；访客能读到的内容（消息、题目、选项和整份计划）都用访客的语言写，代码标识符与路径保留原文，构建工作流的计划审查理由也用计划的语言。题目和计划不立刻回结果：会话停在等结果的状态，访客下一条消息就作为那次调用的结果发回。`workers/ai/src/build/validation.ts#parseBuildPlan` 校验后签出计划；计划有效期取 `BUILD_PLAN_TTL_MS`。计划内容是需求，不是可执行指令。规划者默认访客不了解站点的设计与代码：给访客看的回复、题目和计划标题只讲页面上看得到的效果，技术取舍自己从代码里定，路径、组件名等实现细节只进规格、验收项和路径（`workers/ai/src/chat/design.ts#PLANNER_PROMPT`）。改动范围的最终硬限制在上传阶段执行。

计划卡提供两个出口：

- **Open issue**：在新标签页直接跳转到 GitHub issue 创建页（`shared/build-routine.ts#buildIssueUrl`），用 `improvement.yml` 表单打开，标题与「想要什么」「验收标准」「涉及路径」按计划预填，「现在的情况」一栏填来源署名和隐藏标记，访客在 GitHub 确认后以自己的账号提交，无需给本站授权，也不消费计划。正文写不进 `performed_via_github_app`，`from-chat` 标签由 `.github/workflows/issue-labels.yml` 改按 context 字段里的隐藏标记（`shared/build-routine.ts#BUILD_ISSUE_ORIGIN`）补上。
- **Start build**：发起协作构建前在计划卡展开 `src/components/github-consent.tsx#GithubConsent` 的 GitHub 授权说明（按 `shared/build-routine.ts#visitorLanguage` 跟随访客语言，用中日英），访客点接受才弹出授权窗口；同意不保存，下次再点还会展开。每次都弹窗连接 GitHub，把授权码随计划一起交给 Worker，不签发、不保存任何会话凭据。Worker 兑换授权码、查 `/user` 拿账号名、用户 ID 与显示名，随即撤销访客 token（失败路径也撤销），然后原子地消费计划和账号/全站额度，记录访客的 GitHub noreply co-author。同一计划的构建重试必须重新验证同一个 GitHub 用户 ID，返回原 run 与 PR；不同账号不能接管。浏览器在授权与请求期间同步锁住按钮，避免重复点击。

计划的使用记录在 DO 中。只有 Start build 消费计划：构建用 App 的只读安装令牌读取 main，成功后原子消费计划与额度，并将计划关联到唯一 run。读取 main 失败或构建额度拒绝不消费计划；已消费的计划不能再发起构建，同账号重试只恢复原 run，不重复扣额度。Open issue 不经过 Worker：GitHub 的原生提交不会回传结果，浏览器点过链接只在本地存档记下打开过表单（`src/lib/chat-archive.ts#ChatProposal` 的 `issueOpened`），两个出口都保留，访客没提交就回来仍可改选 Start build。签发计划时 Worker 给它一个 `issueRef`（即计划 ID），预填表单的隐藏标记带上它（`shared/build-routine.ts#buildIssueMarker`）；卡片在页面可见时按 `BUILD_ISSUE_POLL_MS` 轮询、回到页面时立即查一次 `/api/build/issue`，Worker 验过计划 token（过期后仍接受 `BUILD_ISSUE_LOOKUP_GRACE_MS`）后用只读安装令牌列出计划签发以来的 issue，按标记认出编号最小的那个（翻页到创建时间早于计划签发为止，翻不完就报错，不当成没有，`workers/ai/src/build/github.ts#findPlanIssue`），记在 `BuildCoordinator`；同一计划查 GitHub 的节奏受 `workers/ai/src/build/coordinator.ts#ISSUE_CHECK_MS` 限制。确认之后卡片显示 issue 链接并关闭出口，构建开始或计划过期同样关闭（`src/lib/chat-archive.ts#proposalChoiceOpen`）。没有 `issueRef` 的旧计划无从确认，打开过表单后只保留 Open issue（`src/lib/chat-archive.ts#proposalBuildOpen`）。反过来也一样：点了 Start build、GitHub 授权弹窗还开着时，访客仍可点 Cancel 或改选 Open issue，卡片关掉弹窗、收回授权说明；只有登录完成、Worker 正在受理构建的那一段两个出口都锁住。确认不消费计划，但 Start build 在登录之后、读取 main 之前会绕过节流再查一次（`workers/ai/src/build/handlers.ts#handleBuild`），已有这份计划的 issue 就回 409 并带上 issue，卡片随即显示它，不建分支、不扣额度；卡片点 Start build 时也先触发一次查询。标记写在公开正文里，任何人抄去另一个 issue 也只影响这一张卡片的显示。GitHub 请求结果不确定时先查 GitHub，不能把网络失败当成「没有创建」。构建频率取 `BUILD_QUOTA`；设计、账号和状态令牌使用不同用途标签，不能互换。

## 草稿与派发

Worker 用 App 的只读安装令牌读取 main 的当前提交作为 `baseSha`，再将它与 runId、一次性上传凭据绑定并原子占用计划与额度。上传凭据由 `BUILD_SESSION_SECRET` 按 runId 派生（`workers/ai/src/build/token.ts#uploadTokenForRun`），DO 只存它的哈希，凭据本身不发给任何人。随后用写入安装令牌将已确认计划保存为 `builds/<runId>.md`，以真实文件差异提交到 `branchForRun(runId)` 分支并创建草稿 PR。计划文件只包含 `BuildPlan` 的标题、规格、验收项和预计路径，不加入会话记录、令牌或访客身份。构建响应带当前 run 与草稿链接，浏览器立即显示并保存。

草稿 PR 经 GitHub 确认后，Worker 才用写入安装令牌向本仓库发 `repository_dispatch`（`event_type` 为 `build`）。`client_payload` 只有 runId、planCommitSha、baseSha、PR 号和回调源 `callbackOrigin`：Build 请求到达的 api 源，生产是公开 API 地址，分支 Preview 是该 Preview 的地址。计划正文不进 payload，工作流从固定的 planCommitSha 读计划文件。GitHub 回 2xx 即算派发成功，HTTP 响应不等待工作流启动。GitHub 以 408、429 之外的 4xx 拒绝时 run 直接 `failed`；网络错误、5xx、408、429 视为结果未知，run 保持原阶段并附上原因，之后由超时收尾；两种情况 PR 都保持草稿。派发由 `BuildCoordinator` 的 `claimDispatch` 原子标记限制为一次。

## 构建工作流

`.github/workflows/build.yml` 只响应 `repository_dispatch` 的 `build` 事件，GitHub 只运行默认分支上的这份工作流；能发这个事件的是带 Contents 写权限的令牌：Worker 的 App 安装令牌、维护者，以及本仓库任何声明了 `contents: write` 的工作流 job 的 `GITHUB_TOKEN`（`repository_dispatch` 是 `GITHUB_TOKEN` 不触发新运行这条规则的例外），它们都能带任意 payload 启动构建。给运行 agent 或不可信代码的 job 加 `contents: write`，就扩大了能启动构建、并替进行中的 run 报告 `blocked` 的范围。同一 runId 同时只跑一个（`concurrency`，不取消进行中的运行）。上传凭据从 run 创建起计时，派发、工作流排队和每个 job 等 runner 的时间却不计入 `timeout-minutes`，所以各 job 的 `timeout-minutes` 之和要比 `BUILD_TIMEOUT_MS` 至少短出排队余量 `scripts/build-actions.test.mjs#QUEUE_ALLOWANCE_MS`，否则跑满时限的运行回传时上传凭据已过期；实现 job 里 Claude 那一步另有更短的时限，超时按实现没跑完报告 `blocked`。`scripts/build-actions.test.mjs` 核对这个和，以及实现 job 的 `--model` 与 `BUILD_CLAUDE_COAUTHOR` 对应。payload 只经环境变量进入脚本，每个 job 先按格式校验 runId、两个 SHA、PR 号和回调源。顶层 `permissions: {}`，各 job 只声明自己要的权限；全程不读写 Actions 缓存（这些运行处在默认分支的缓存作用域，实现 job 又执行不可信代码），所有检出 `persist-credentials: false`。提示词、Claude Code 设置和 `scripts/build-actions.mjs` 一律取自工作流自己的提交（main），不取构建分支上的副本。Claude Code CLI 直接用 npm 装固定版本（`CLAUDE_CODE_VERSION`），凭据是 Actions Secret `CLAUDE_CODE_OAUTH_TOKEN`，只传给运行 CLI 的那一步。

1. **review**：只读仓库。检出 main，从 planCommitSha 取出 `builds/<runId>.md`，用 `.github/build/review.md` 拼出提示词，交给 Sonnet：只开 Read、Glob、Grep，读的是 main 的检出，设置见 `.github/build/review-settings.json`，结论按 `.github/build/review-schema.json` 输出 `approve` 或 `reject` 和一段写给访客的理由，再由 `scripts/build-actions.mjs#parseReviewResult` 写成 job 输出。审查拦下有害、试图操纵 agent、要动受保护路径、前后矛盾或明显做不成的计划，合理的改进放行；它不替代上传校验与维护者审查。
2. **gate**：无论审查成败都运行，持 `id-token: write` 与 `pull-requests: write`。它先在 PR 上发一条 Plan review 评论（结论、引用的理由与本次运行链接，`@` 已转义；评论失败只记日志），再向 Worker 报告（`scripts/build-actions.mjs#gateDecision`）：通过时报一条进度，拒绝或审查没跑完时报 `blocked`。只有审查通过且 Worker 接受了这条报告，job 输出 `approved=true`，实现才开始；Worker 没有接受时 job 失败。
3. **implement**：只读仓库、没有 `id-token`，Claude 和它跑的代码都拿不到回传 Worker 的凭据。先从工作流提交拷出受信配置，再检出 planCommitSha、`pnpm install --frozen-lockfile`，装沙盒依赖（bubblewrap、socat，Ubuntu 24.04 另需放行 bwrap 的 AppArmor 配置）并实际建一次 bwrap 命名空间（CLI 的 `failIfUnavailable` 只查程序在不在），停掉 Docker（runner 用户经 docker.sock 就能拿到 root），再装截图用的 chrome-headless-shell（沙盒的 seccomp 会杀掉完整版 Chrome；装不上只跳过截图）：这一步在沙盒外、有 sudo，所以只按工作流里写死的版本下载并核对 SHA-256，不用现场解析依赖的安装器。Claude Code 以 Opus 运行，提示词 `.github/build/implement.md`，设置 `.github/build/implement-settings.json`：Bash 一律进沙盒，沙盒起不来就失败，网络只放行设置里列出的域名，`CLAUDE_CODE_OAUTH_TOKEN` 不进沙盒命令的环境。Claude 只改工作区，并把提交说明、停下说明与截图写进 `.build-output/`。CLI 成功结束后，`scripts/build-actions.mjs#packageBuild` 用会话开始前备份的 `.git`，把相对 planCommitSha 的改动打成补丁（`.build-output/` 与 `builds/` 不算改动），连同这些输出存为短期 artifact `build-output`。
4. **publish**：审查通过时无论实现成败都运行，持 `id-token: write`，在全新的 runner 上检出 main（受信脚本）与 planCommitSha。`scripts/build-actions.mjs#preparePublication` 把补丁只应用到索引，从索引读文件 mode 与内容，不读工作区、不跟随符号链接；只接受普通文件的新增、修改和删除，符号链接、子模块、类型变更或空改动都改为报告 `blocked`。实现 job 没跑完、Claude 写了停下说明时同样报告 `blocked`；否则先逐张提交截图（失败只记日志），再提交上传 JSON。提交说明取 Claude 写的 message.md，缺了用 `chore(build): implement <runId>`。job 只在 Worker 接受上传或 `blocked` 报告时成功，Worker 的回应写进日志与运行摘要；运行摘要按 Markdown 渲染，`blocked` 的原因来自 Claude 与补丁路径，只进日志。

回传 Worker 的三个端点（`shared/ai-paths.ts` 的上传、进度、截图路径，都带 `?runId=`）只认 GitHub Actions OIDC 令牌。gate 与 publish 用 runner 提供的 `ACTIONS_ID_TOKEN_REQUEST_URL` 申领，受众是 payload 里的回调源加 runId（`workers/ai/src/build/actions-oidc.ts#buildWorkflowAudience`，与 `scripts/build-actions.mjs#workflowAudience` 同一格式），申领后先在日志里遮蔽。Worker 在 `workers/ai/src/build/actions-oidc.ts#verifyActionsToken` 核对 RS256 签名（GitHub 的 JWKS，缓存与未知 `kid` 的重拉间隔见同文件 `JWKS_TTL_MS`、`JWKS_REFETCH_MS`）、签发者、受众等于该 run 记下的 `callbackOrigin` 加上查询参数里的 runId、仓库为 `BUILD_REPO` 且仓库数字 ID 与所有者 ID 等于 `BUILD_REPO_ID`、`BUILD_REPO_OWNER_ID`（换仓库、转移所有权时三者要一起改）、`workflow_ref` 是 main 上的 build.yml（`BUILD_WORKFLOW_REF`），`job_workflow_ref` 出现时也必须是它、事件为 `repository_dispatch`、`ref` 为 main、GitHub 托管 runner，以及签发、生效与过期时间。受众把令牌绑在单个 run 上：同一回调源下，为一个 run 申领的令牌不能替别的 run 报告或上传；它仍只证明请求来自 main 上 build.yml 中有 `id-token: write` 的 job，能派发 `repository_dispatch` 的人可以为任意 runId 启动这些 job。验过后 Worker 用该 run 派生的上传凭据哈希调用 `BuildCoordinator`，一次性上传、`blocked` 即作废、截图只收在上传前，都按这个哈希判定。拿不到 GitHub 签名公钥时回 503，其余鉴权失败回 401；这些端点不接受其他 bearer 令牌。

## 上传与 PR

Worker 收到的上传 JSON 类型为 `BuildUpload`：`baseSha`、提交说明 `message`、`files`（每项为 `path`、完整文件内容的 base64 字符串 `content`、Git 文件 `mode`）和 `deletions`（完整相对路径）。Worker 不接收 patch、目录包、符号链接或子模块。改名表示为删除旧路径、上传新路径。

Worker 先原子占用上传凭据，再执行请求体、文件数、单文件/总字节、路径和 mode 检查；校验失败也不能重用凭据。边界均取 `BUILD_UPLOAD_LIMITS`；超过请求字节限制时边读边停止，不先缓冲任意大小正文。上传的 baseSha 必须与该 run 最初分配的 main 提交一致，且由 GitHub API 验证仍在 main 的历史中；它不是 planCommitSha。上传只能包含相对 planCommitSha 的实现差异，不得修改或删除 `builds/` 中的计划文件。工作流打包时的检查只是提前拦截，以 Worker 的校验为准。

允许的路径是站点源码、静态资源、文档、共享代码和各 Worker 的源码，以及 `reporters/` 之外任意位置的 Markdown 文档（`workers/ai/src/build/validation.ts#markdownDoc`；agent 指令文件仍被受保护名挡掉），测试文件也必须位于这些允许目录内。上传和删除原则上匹配签名计划的 `paths`：文件精确匹配，结尾 `/` 的目录允许其下的路径，并允许同目录的测试文件。计划没列到、但契约或测试必须一起改的文件，在允许目录内最多放行 `BUILD_UPLOAD_LIMITS.outsidePlanFiles` 个（Markdown 文档不计），超过这个数拒绝上传，在卡片上列出路径。PR 正文的重点审查一节（`workers/ai/src/build/github.ts#reviewPaths`）列出计划外文件以及改到共享契约、构建与授权代码、对话提示词、`docs/` 之外文档的文件，各标原因，PR 开出后补上直达该文件 diff 的链接。拒绝规则按每个路径段转小写后匹配，优先于允许规则：CI（含 `.github/build/`）、agent 配置和规则、依赖清单与锁文件、脚本（含 `scripts/build-actions.mjs`）、部署配置、上报器和子模块配置不能改。准确规则只在 `workers/ai/src/build/validation.ts#allowedBuildPath` 维护；文件和删除项都过同一检查。`workers/ai/src/build/github.ts#validateBuildBase` 还会完整检查 base tree：树被截断时拒绝，不允许替换或删除目录、符号链接与子模块，也不允许路径穿过这些非目录父节点；删除目标必须存在。

GitHub 写入使用 `GITHUB_APP_PRIVATE_KEY` 经 WebCrypto 签 RS256 JWT，换取限定于目标仓库的安装 token。上传验证通过后，Worker 核对既有草稿 PR 的仓库、base、branch、run 标记与 head，按 planCommitSha 的 tree 创建 blob、tree 和实现 commit，保留计划文件，以非强推方式更新同一分支。实现提交父节点固定为 planCommitSha；写入前记录实现 SHA，便于远端更新结果不确定时核对并恢复。分支含有非预期提交、PR 被关闭或提前转为待审时停止写入；不覆盖其他改动，也不另开 PR。提交说明里的 `Co-authored-by` 与 `Claude-Session` 行一律移除，改由 Worker 追加验证身份对应的访客一行和 `workers/ai/src/build/github.ts#BUILD_CLAUDE_COAUTHOR` 一行（与实现 job 的模型对应），PR 正文附同样的尾注；issue 与 PR 正文的小节标题和固定文案按 `shared/build-routine.ts#planLanguage` 跟随计划语言（中、日、英）；PR 正文中的计划与提交说明转义 `@`，避免意外通知。PR 号码、地址与 head SHA 取 GitHub API 返回值，不猜测成功。只有已验证上传的实现 head 仍与 PR 一致、CI 汇总成功且 GitHub Actions 的 `check` 检查明确成功时，Worker 才将草稿转为待审；只有计划提交、跳过的检查、取消或失败均不满足条件。Preview 单独展示，不作为转待审的门槛。没有自动合并路径。

界面改动的截图由 Claude 在实现 job 的沙盒里用本地开发服务器截桌面与 375px 宽度，写进 `.build-output/` 的 screenshots 目录，并在同目录的 screenshots.json 登记文件名与说明，做法见 `.github/build/implement.md`：沙盒的网络命名空间里没有 DNS，开发服务器的 workerd 不认代理变量，Chrome 又不会向代理发凭据，所以同一条 Bash 命令里先起 `.github/build/dev-net.mjs`，由它在本机开到生产 API 与 `lyjw.me` 的明文中继和一个替 Chrome 补代理凭据的 CONNECT 代理。`/img/*` 经生产站点取 R2 图片，所以沙盒网络放行 `lyjw.me`；封面、头像等远端图片也在沙盒里取源，网络还要放行 `src/lib/image-proxy.ts#allowedImageHost` 允许的图片主机，清单在 `.github/build/implement-settings.json`。publish job 在上传前把每张截图以 JSON（`caption` 与 base64 图片 `content`）提交到截图端点。Worker 只在上传凭据尚未占用时接收，核对 PNG、JPEG 或 WebP 文件头与 `BUILD_SCREENSHOT_LIMITS`，按 SHA-256 内容寻址写入站点 R2 图片桶（ai 的 `IMAGES` 绑定），在 run 里记下 objectKey 与清洗过的说明。实现提交确认追加到草稿 PR 后，`workers/ai/src/build/screenshots.ts#postScreenshotComment` 用 App 的安装令牌发一条评论，图片地址是 `site.url` 下的 `/img/<objectKey>`，标题与说明跟随计划语言；没有截图时不发，评论失败只记 Sentry（tag `build.step`），不影响 PR 与 run 状态。截图是永久公开的对象，不进构建卡片。分支 Preview 没有 `IMAGES`，截图端点返回 503。

## 状态与恢复

状态由 `BuildCoordinator` 保存。`triggered` 表示已受理并正在准备草稿或派发构建工作流；派发未确认时附带结果未知的原因。`running` 表示计划审查已通过、实现已开始。`uploaded` 表示上传凭据已占用，正文仍须通过校验；`validated` 表示上传已通过校验，`pr_open` 表示实现已发布到原 PR。`pr.draft` 单独表示 GitHub 草稿状态，卡片据此区分等待检查与待审。合并和关闭按 GitHub 结果推进，拒绝时展示原因。

准备阶段用 DO 租约串行化并发请求，创建计划 commit、分支或 PR 的部分成功会保留远端结果；重试先查询并验证 GitHub 身份，恢复同一分支和 PR。带签名状态 token 的状态查询也可重试未完成的准备；同账号的 Build 重试返回同一 run。构建工作流的派发由原子标记限制为一次，派发结果不确定时不会再次启动付费构建。run 停在 `failed`、`blocked` 或 `timeout` 且草稿只含计划提交时，`BuildCoordinator` 的 alarm（间隔取 `workers/ai/src/build/coordinator.ts#DRAFT_SWEEP_MS`，Build 受理时排上）关闭该草稿 PR、保留分支，失败原因后补一句已关闭；run 仍停在原失败状态，卡片保留草稿链接与原因，GitHub 的关闭事件不把它改成 `closed`。已记录实现提交的 run 可能仍在恢复发布，草稿不关。还有待处理 run 时 alarm 继续排下一次，超时也由它发现；关闭遇到 GitHub 暂时失败下次重试，PR 与这次构建对不上时跳过并记 Sentry（tag `build.step`）。等待上传从 run 创建时计时，上传或校验中断从状态更新时间计时，超过 `BUILD_TIMEOUT_MS` 均显示结果未知；上传凭据同样在 run 创建后 `BUILD_TIMEOUT_MS` 过期，工作流在那之后的回传一律被拒。已接收上传的 run 若随后收到 GitHub 的 PR 确证，可从失败或超时恢复，并清除旧错误原因。

gate job 在计划审查通过后向进度端点报告一句；进度只作展示，不代表通过验证，实现过程中没有更细的进度。工作流不上传就结束时，由 gate 或 publish 向同一端点报告 `blocked`（`workers/ai/src/build/coordinator.ts#blockRun`）：计划审查拒绝或没跑完、实现 job 没跑完、改动为空或不能上传，以及 Claude 判断计划路径加上计划外放行的名额仍不够、只能靠类型断言或放宽测试才能完成而写下停下说明。`blocked` 占用上传凭据，run 停在 `blocked`，卡片显示 Worker 加了前缀的原因，访客据此重新出计划。规划者出计划前要读所涉 Worker 的 AGENTS.md「须成对修改」一节，把成对文件列进 `paths`。

GitHub webhook 按原始正文验证 `X-Hub-Signature-256`，并核对目标仓库与 run 分支（`check_run`、`check_suite`、`status` 带的分支都不是构建分支时，验签后直接确认，不唤醒 `BuildCoordinator`、也不登记 delivery ID；没带分支名时照常按 SHA 查），处理成功后才登记 delivery ID 去重，处理失败保留重投机会。订阅事件为 `check_run`、`check_suite`、`status`、`issue_comment`、`pull_request`。检查、预览与评论是独立状态；`claude[bot]` 的评论只供参考，不能授权代码或合并。卡片注明此边界。卡片的审查栏只读 `claude[bot]`，gate 发的 Plan review 评论不进审查栏。

Claude review 卡片通过 `src/lib/build-review-summary.ts#buildReviewSummary` 将可识别的审查结论显示为 No issues 或 Issues found；缺失、失败或无法识别的结论显示 Unknown。评论正文不直接显示，链接仍指向 GitHub 原评论；本地保存的会话也使用同一展示规则。

CI 与 Preview 由 `workers/ai/src/build/github.ts#reconcileBuild` 统一分类和汇总：只有 `cloudflare-workers-and-pages` 应用的 `Workers Builds: site` 检查计入 Preview，其余检查和全部 commit status 都计入 CI。Preview 取 `started_at` 最新（再按 check id 决胜）的那一条 site 检查：完成且成功时链接指向该分支稳定的 `https://<分支>-site.lyjw.workers.dev` 预览地址，由 Cloudflare Access 保护、访问要登录，不使用任何第三方 `details_url`；进行中显示等待，失败结论显示失败，skipped / neutral 或没有该检查时显示未知；读取失败或不完整时同样显示未知。检查与部署 webhook 只标记状态需要重新对账，单条事件不能覆盖整体结论。

卡片可见且构建未到终态时轮询；`merged`、`closed`、`blocked`、`failed`、`timeout` 停止自动轮询，卡片保留手动 Refresh status 入口。刷新失败保留最后已知状态和 PR 链接；已记录实现提交的发布歧义可通过状态查询核对并恢复。`merged` / `closed` 不再调用 GitHub 对账。其他已有 PR 的陈旧状态按 `BUILD_RECONCILE_MS` 限制对账频率，通过 GitHub API 查询 PR、检查和预览状态。无法读取 PR 时保留最后观测到的事实；PR 查询成功后，读取失败或不完整的检查、预览与审查结果显示未知，不用构建工作流的运行结论推断结果。对账按 head SHA 与 GitHub 更新时间防止旧结果覆盖新提交。状态访问需要绑定 runId 的签名 token。

浏览器用 localStorage 保存多个会话，包括历史签章、设计/计划令牌和构建 runId/状态令牌。`/clear` 与 `/new` 新开会话，设计会话里 `/exit` 丢掉设计令牌、回到普通对话，旧会话仍可切换、删除或确认后全部清空。流式分片只更新内存，回复结束或中断时再持久化，设计会话的回复在收到 `design` 事件时先存一次；设计会话里请求送达后断线，浏览器保留访客那条并自动补发一次规划者的回复，刷新页面后也会补发最后一条没盖章的设计回复。容量策略由 `src/lib/chat-archive.ts` 维护。过期计划按钮禁用；localStorage 不可用时退回内存，刷新后不承诺恢复。

## 安全边界

| 性质 | 约束 | 依据与边界 |
| --- | --- | --- |
| 硬约束 | 计划、设计会话和状态 token 验签，上传凭据只存哈希并只能消费一次 | `workers/ai/src/build/token.ts`、`workers/ai/src/build/plan.ts`、`BuildCoordinator`；签名不保证计划语义安全 |
| 硬约束 | 上传、进度、截图端点只认 main 上 build.yml 签出的 GitHub Actions OIDC 令牌，受众须是该 run 的回调源加 runId | `workers/ai/src/build/actions-oidc.ts#verifyActionsToken`、`buildWorkflowAudience`；哪些 job 能申领由工作流的 `id-token` 权限决定 |
| 硬约束 | 设计轮数、全站设计会话、账号/全站构建限额 | DO 中原子计数；入口 Rate Limiting 只是额外保护 |
| 硬约束 | 上传路径、mode、字节数、文件数和 baseSha | Worker 校验后才调用 GitHub 写 API；工作流和提示词都不能放宽这些检查 |
| 配置保证 | 工作流不持有仓库写凭据、不推送；只有不执行 Claude 的 gate 与 publish 能申领 OIDC 令牌；不用缓存，检出不留凭据；受信文件只取工作流自己的提交 | `.github/workflows/build.yml`；该文件、`.github/build/` 与 `scripts/build-actions.mjs` 都在 `allowedBuildPath` 的拒绝范围内，访客构建改不了，改它们就是改构建边界，由维护者审查 |
| 配置保证 | Anthropic 凭据是 Actions Secret `CLAUDE_CODE_OAUTH_TOKEN`，只给运行 CLI 的步骤；实现 job 的 Bash 进沙盒，拿不到该凭据，网络只放行约定域名；审查 job 没有 Bash 和写工具 | `.github/build/implement-settings.json`、`.github/build/review-settings.json`；沙盒是否在托管 runner 上生效须在 Actions 实测 |
| 配置保证 | Worker Preview 不含生产凭据 | 必须核对实际选中的 Preview；Worker 预览隔离存储不等于所有凭据自动安全 |
| 软约束 | 规划者、计划审查与实现的提示词，Claude 审查 | 会被模型误解或注入；不能替代上传校验、隔离环境与维护者审查 |

仓库是公开的：工作流日志、artifact、Plan review 评论和 PR 都对外可见，计划、审查理由、补丁与截图都按公开内容处理。脚本写日志前把 OIDC 令牌遮蔽、外来文本加引号；Claude CLI 的输出只写进 runner 临时目录，日志里只有结论摘要。

允许目录中的代码仍可以改变页面或后端行为；路径校验并不是任意代码安全证明。PR 中的代码、测试和说明均按不可信贡献处理。合并仍由维护者决定。

## 待配置与验收

这些操作由有授权的维护者完成；文档不表示已配置。

1. 在 AI Worker 与实际用于验收的分支 Preview 配置 `BUILD_SESSION_SECRET`、`GITHUB_APP_PRIVATE_KEY`、`GITHUB_WEBHOOK_SECRET`；现有 `GITHUB_APP_CLIENT_SECRET` 供 PKCE 授权使用；付费设计对话仍需要现有模型、历史签名和 Turnstile 配置。`ROUTINE_FIRE_URL`、`ROUTINE_FIRE_TOKEN` 没有代码读取，从 AI Worker 和各 Preview 删除这两个 Secret。不要把生产凭据复制进 Preview。
2. GitHub App 配置 webhook 指向对应环境的构建 webhook 路径，并订阅上文事件；确认 Contents、Pull requests、Issues 写权限（派发 `repository_dispatch` 用的也是 Contents 写权限），以及 Checks 和 Commit statuses 读取权限及目标仓库安装。安装 token 的缩减权限由 `workers/ai/src/build/github.ts#installationApi` 指定。JWT issuer 使用公开 `GITHUB_APP_CLIENT_ID`，安装 ID 由 GitHub 查询，不另存凭据。回调页仍是 `GITHUB_CALLBACK_PATH`，验收地址须登记在 App 中。
3. 仓库侧：`.github/workflows/build.yml` 与 `.github/build/` 合进 main 后，生产和 Preview 才派发得出构建（`repository_dispatch` 只跑默认分支的工作流，OIDC 也只认 main 上的 build.yml）。仓库级 Actions Secret `CLAUDE_CODE_OAUTH_TOKEN` 要存在且不限定 environment；仓库的 Actions 策略要允许工作流用到的官方 action 与 `pnpm/action-setup`。OIDC 不需要在 GitHub 侧另配信任关系，校验全在 Worker 代码里。
4. 分支 Preview 实测时，Preview 的 api 地址就是回调源，main 上的工作流直接回调它，OIDC 受众随之变成该 Preview 的源加 runId，不用改工作流或沙盒网络（与 Worker 通信的只有 gate 与 publish，Claude 不访问 Worker）；不能用生产回调源验证 Preview run。核对 Worker Preview 只持有专供测试的凭据，无 `GITHUB_TOKEN`、`SENTRY_AUTH_TOKEN`。核对 Workers Builds 监视路径包含共享构建契约，清单见 [Workers 构建](./workers-builds.md)。
5. 用少量真实请求验收设计会话、PKCE、计划审查的放行与拒绝（PR 评论与卡片上的 `blocked`）、实现 job 的沙盒（读不到 `CLAUDE_CODE_OAUTH_TOKEN`、访问清单外域名被拦）、一次性上传、OIDC 受众或 run 不符时被拒、App 作者与访客 co-author、检查/预览/审查卡片更新；另测越界上传、重复上传、过期回传与刷新恢复。线上核验后才将远端配置事实记入 [仓库外事实](./ops-facts.md)。
6. 第一次 Actions 构建在生产成功后，在 claude.ai 停用 routine「lyjwpage /build」，并按实际状态更新 [仓库外事实](./ops-facts.md#claude-code-云端-routine) 的这一节。

## 构建提示词

计划审查与实现的提示词分别是 `.github/build/review.md` 与 `.github/build/implement.md`，由 `scripts/build-actions.mjs#renderPrompt` 填入 runId、planCommitSha、baseSha 与计划正文：计划包在 `<plan>` 里，正文里的 `</plan` 先被中和（`neutralizePlan`），计划只是数据，不能改写提示词的规则。实现提示词规定 `.build-output/` 里提交说明（message.md）、停下说明（blocked.md）与截图（screenshots.json 和 screenshots 目录）的写法，`scripts/build-actions.mjs#packageBuild` 按同样的约定读取，改一边要同步另一边。工具、沙盒、网络与凭据隔离由同目录的 settings 文件和工作流执行，不靠提示词。

GitHub JWT、webhook 与 Actions OIDC 的协议依据分别见 [JWT 文档](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app)、[webhook 验签](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries) 和 [OpenID Connect](https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect)。
