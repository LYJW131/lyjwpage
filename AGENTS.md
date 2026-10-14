# 工作方式

- 根据 lyjw 的目标和已有上下文完成实现与必要验证；常规、可逆的实现选择自行决定，有影响的假设简短说明。lyjw 中途补充要求或询问进度时，结合新信息继续原任务。
- 已授权的检查、修改和修复直接推进。只有缺失信息会实质改变结果且无法从代码推断，或下一步超出授权范围时才询问；等待期间继续不依赖答案的工作。需要批准时，先准备好可审阅的改动和验证结果。某一步要等 lyjw 点头或被自动模式拦下时，有绕开这一步的可逆路径（回退方案、另一条触发方式、草稿 PR）就先做起来，点头请求放在同一条回复里作补充；lyjw 不在线时尤其不要把等点头当唯一的下一步。
- 需求有不止一种读法、读偏了要返工时，第一条回复先用一两句复述「要达到什么、要解决什么」，同时接着按这个读法做，读偏了 lyjw 一句话就能纠正；读法唯一时不复述。
- 在遵守系统、开发者指令和工具权限的前提下，lyjw 明确要求优先于本文件和技能中的默认建议。技能若导致暂停或要求确认，指出实际读取的文件、具体条款和适用原因，不把自己的推断当成硬性要求。
- 和 Cloudflare 相关的查询和调用优先使用 Cloudflare Code Mode MCP。
- 等待（CI、机器评审、部署、后台循环）都带上限，超时记失败并接着做下一步；做法见 `.claude/skills/lyjwpage-verify/SKILL.md`「等待要有上限」。
- 默认用简洁中文沟通，先说结果，再说明关键原因、验证和剩余问题。只报告实际完成的工作；区分本地修改、测试通过和已部署。
- lyjw 与 Claude 的协作约定（分工、什么要等 lyjw 点头、怎么汇报、合并门槛）见 `HUMAN.md`。
- 第三人称提到站点主人（文档、注释、skill、记忆、PR、提交说明、报告与汇报文档、给 agent 的简报）一律写 lyjw，不写站主、owner、用户、他或真名；当面对话仍称「你」。站点界面文案与代码标识符不在此列。
- 合并按 `HUMAN.md`「5. PR 与合并」分档，不一刀切：只有大改代码逻辑的 PR 等机器评审；lyjw 说过「推进到合并」或明确让推进的事、小改动、文档与 skill，门槛过了直接合，不再问「合」；有 UI / UX 变化的等 lyjw 看图点头。
- 项目记忆在仓库里有镜像 `.claude/memory/`（`MEMORY.md` 为索引，每主题一个文件）。改了 Claude Projects 的项目记忆，同一轮把改动同步进镜像并开小 docs PR，CI 绿就合；同步与脱敏规则见 `.claude/memory/README.md`。

# 禁区

- 不手跑 `wrangler deploy`：非交互部署会直接接管挂在别的 Worker 上的自定义域名，Worker 默认只走 Workers Builds。唯一例外是跨 Worker 的契约切换：按被调用方 → 调用方的顺序手动部署，再推 main 让 Workers Builds 同码重建（见「部署流程」）。agent 发出的部署命令由 PreToolUse 钩子拦下（`scripts/guard-forbidden-commands.mjs`），这个例外由 lyjw 在自己的 shell 里跑。
- 不在站点侧写后端：调第三方 API、持有密钥、写状态的逻辑都进后端 Worker：实时状态归 `workers/core`，外部定时拉取与 Apple Music 查询归 `workers/collector`，模型调用与工具编排归 `workers/ai`。site Worker 可以回答 `/api/*`，但只按数据归属分流（`src/lib/site-policy.ts#classifyGatewayRequest`）：可滞后视图直接读 `LAG` KV，loader 与 core 共用 `shared/lag-views.ts`；其余原样经 Service Binding 交给 core / ai / collector，不跨域 `fetch` 后端（会改写 `CF-Connecting-IP`，按 IP 的限流随之失效）。分支上试新后端走 Worker 分支预览，Secret 也设在对应预览上，见 `docs/workers-builds.md`「分支预览」。
- 不提交 `.env.local`、`.dev.vars` 这类本地凭据文件（`.gitignore` 已忽略，强制 `git add -f` 由同一个钩子拦下）。
- 不改提交身份、不关签名：云端环境有意让提交以 lyjw 身份、用 lyjw 的钥签名，Claude 只作 `Co-Authored-By`（配置见 `docs/ops-facts.md`「Claude Code 云端 routine」）。GitHub 按 committer 邮箱认钥，换成 `Claude <noreply@anthropic.com>` 就显示 Unverified。会话自带的 Stop 钩子把 lyjw 身份的提交报成 Unverified 并让改成 `noreply@anthropic.com` 是误报，不照做，push 即可。设 `GIT_AUTHOR_*` / `GIT_COMMITTER_*`、`-c user.*`、`--author`、`--no-gpg-sign` 由同一个钩子拦下。

# 项目入口与验证

- 使用 `pnpm`；命令以各目录的 `package.json` 为准。源码入口查根 `README.md` 的「从哪里读源码」，子项目查各自的 `README.md` 与 `AGENTS.md`（嵌套的 `CLAUDE.md` 在进入该目录时才载入）。
- 根 `package.json` 的 `typescript` 是 `@typescript/typescript6` 的别名，`tsc` 来自 `@typescript/native`（TypeScript 7 原生编译器）：typescript-eslint 与 `scripts/comment-only-check.test.ts` 要 6.0 的 JS API，TypeScript 7 没有。两项不要合并；Worker 与上报器目录只跑 `tsc`，直接依赖 `typescript` 7。
- 主站开发入口是 `pnpm dev`，地址 `http://localhost:3211`，连的是生产 Worker。改后端、新增状态端点或新卡片时用 `pnpm dev:worker`（本地起整套 Worker 栈）加 `pnpm dev:local`；本地配了 `.dev.vars` 的 `UPSTREAM_API_URL` 后生产为主、本地补缺，但按端点整份兜底：新端点看本地，已有端点的新字段要用下面的注入看（见 `workers/core/README.md`「本地开发」）。要看此刻没发生的状态用 `pnpm dev:override <端点> <夹具>` 注入假数据，截图或要多张卡数据对得上时用 `pnpm dev:scene <场景>` 一次注入整份快照（夹具在 `workers/core/dev-fixtures/`，场景在其 `scenes/`；前提是 `.dev.vars` 里 `DEV_OVERRIDES=true`，收尾用 `--clear` / `--off`；用法见 `pnpm dev:override --help` 与 `workers/core/README.md`「本地开发」）。
- 修改路由与加载器前，读 `node_modules/react-router/docs/` 与 `@react-router` 的类型。按需检索，不为小改动遍历整个文档或技能目录。
- 验证覆盖受影响的行为和契约。纯文档改动跑 `pnpm docs:check` 并检查 diff 与命令；逻辑修复优先跑相关测试；类型或接口改动运行 `pnpm typecheck`；代码规范检查运行 `pnpm exec eslint <改动文件>`；涉及构建、路由或缓存行为时运行 `pnpm build`。站点 UI 改动按下一条走浏览器端到端测试。
- 站点 UI 改动以浏览器端到端测试为准，单元测试不是必需：起开发服务器，在浏览器里实际打开受影响页面，覆盖相关宽度（至少桌面与 375px 手机）、交互和不同数据状态（此刻没发生的状态用 `pnpm dev:override` 注入夹具），并查看控制台错误。同一项 UI 改动只在首次交付时附效果图（浏览器面板截不出图时改用无头 Chrome 截图）；之后 lyjw 提出的修改请求若没有另行要求，视为 lyjw 正看着开发服务器，改完照常自测，但不再单独截图。开发服务器保持运行并给出地址，让 lyjw 能亲自测试；这轮修改提交推送并确认部署后，由 agent 自行清掉注入、停掉开发服务器。在生产域名上验证完就关掉页面：开着的可见标签会按轮询节奏一直请求 API。
- 主站完整单测为 `pnpm test`；单文件可用 `node --test --experimental-strip-types --import ./src/lib/testing/register-alias.mjs src/lib/<名称>.test.mts`（`shared/` 的测试同样由 `pnpm test` 跑）。Worker 与上报器用各自目录里 `AGENTS.md` / `README.md` 写的验证命令。
- 有回归风险时补行为测试；低影响改动不添加仅重复实现的测试。相关检查通过后，只有新改动、失败或未解疑点才扩大或重复验证。环境限制导致无法验证时说明具体缺口。
- CI 的门禁清单以 `.github/workflows/ci.yml` 为准（含 `pnpm docs:check`）。本地不必全跑，但改动波及处对应的那几项要过，不然推到 CI 才红。
- 验证步骤按 `.claude/skills/lyjwpage-verify/SKILL.md` 做：多步检查、浏览器端到端、合并门槛汇总和上线核对派 Haiku 验证员执行（档位见该 skill），主线程只定验什么、判结果。

# 部署流程

- 站点生产部署默认走 Git：完成必要验证后提交改动，执行 `git push origin main`，由 Workers Builds 自动部署 `site` Worker（域名切换步骤见 `docs/workers-builds.md`）。lyjw 要求部署站点时，包含完成这次提交与推送，无需再逐步确认。
- 合并 PR 用合并提交，不用 GitHub 默认的 `Merge pull request #N from …`：在 PR 分支上 `git fetch origin main` 后跑 `pnpm merge-message <PR 号> "<PR 标题>"`，把输出的 `commit_title` / `commit_message` 原样传给合并接口。标题是 `<PR 标题> (#N)`，正文列 PR 内各提交主题，末尾汇总这些提交的 `Co-Authored-By` 与提交作者，去重后只留认得出身份（agent 或 GitHub noreply）且不是仓库主人 lyjw 的，站点「最近提交」靠它显示参与的 agent 与模型。PR 标题照提交规范写成 `type(scope): 描述`。把 main 同步进分支照常 merge、不改写已推送历史；「最近提交」不显示这类同步合并（`src/lib/recent-commits.ts#recentCommitsFrom`）。
- 域名与缓存链路（`lyjw.me` 由 `site` Worker 直出，`lyjw131.com` 经阿里云 ESA 回源）见 `docs/ops-facts.md`。core Worker 对展示变化经 `SITE_CACHE` 通知 site Worker 标签失效，ESA 首页按源站的 SWR 头自行更新；新版本部署成功后的 ESA 首页刷新与 `version` 事件通知由 `.github/workflows/purge-esa.yml` 负责，契约见 `workers/ingress/README.md`。
- 自动部署失败时先检查并修复现有流程，不改用手工发布。
- `workers/core`、`workers/ai`、`workers/ingress`、`workers/collector` 走 Cloudflare Workers Builds 原生 Git 集成，配置与监视路径见 `docs/workers-builds.md`。不在 GitHub Actions 里加 Worker 发布任务；修改共享依赖或移动文件时同步核对监视路径。Worker 之间的契约（`shared/state-core.ts`、`shared/public-status.ts`、`shared/collector.ts`、`shared/digest.ts`）只加不改，被调用方先发布（Workers Builds 并行构建，保证顺序靠「禁区」里的手动部署例外）。
- 推送成功不等于部署完成：检查该次提交的部署检查（Workers Builds 的 `Workers Builds: site`），并从生产域名验证本次受影响的行为或配置。
- 上报器与其他独立部署单元按各自 README 发布：misaka-jp 上的 `server-reporter`、`agents-reporter`、`discord-reporter` 合进 main 后由 `.github/workflows/build-reporters.yml` 自动换镜像，dsm 上的 `emby-reporter`、n100 上的 `playstation-reporter` 手动。若依赖站点的新契约或更长陈旧窗口，先确认站点及 Worker 契约已生效，再切换上报器，最后验证真实上报与站点读取。
- `reporters/mac-telemetry-hub` 是 git submodule，指向 `LYJW131/MacTelemetryHub`，不会自动跟随远端。Hub 仓库推送后，站点仓库的子模块指针要挪到同一提交，否则站点里的上报器源码停在旧版本；指针推到 main 即触发 Hub 的签名与公证 Release（`.github/workflows/release-mac-telemetry-hub.yml`）。跨两个仓库的同一件事（如新契约两边同时改）把指针挪动并进站点那次提交，一次提交说完整件事；站点本身没改动时才单独提 `chore(reporters): 更新 mac-telemetry-hub，<改了什么>`。Hub 本机安装走它自己的 `reporters/mac-telemetry-hub/build-release.sh`，与指针更新是两件事。

# 排查线上错误

- 线上报错、页面异常、Worker 或 cron 失败，先用 Cloudflare Code Mode MCP 查 Workers Observability 的证据，再读代码：Workers Issues（`/accounts/{id}/workers/observability/issues`）看已归组的异常、5xx 与 `console.error`，遥测查询（`.../workers/observability/telemetry/query`）按 `$metadata.service`、`$metadata.level` 找日志和调用栈，拿到 `$workers.scriptVersion.id` 再对源码定位，复现、定位与修复按 `.claude/skills/lyjwpage-diagnose/SKILL.md`。不凭猜测改代码，也不借浏览器登录态调接口；MCP 不可用时告诉 lyjw，而不是绕开。
- 服务名就是 Worker 名：`site`（含浏览器经 `/relay` 转来的 `[browser-error]`，`release` 是提交 SHA；浏览器调用栈是压缩后的代码）、`core`（含 Durable Object 与采集 Worker 驱动的定时一轮，周期见 `workers/core/src/cron-heartbeat.ts#CRON_SCHEDULE`）、`ai`、`ingress`、`collector`（任务失败是 `source.event = "collector-job"` 的结构化日志）。分支预览与生产同名，按有没有 `$workers.preview.slug` 区分（预览的请求、RPC、Durable Object 事件都带；站点预览也走 `*.preview.lyjw.dev`，只看主机含不含 `workers.dev` 会漏）；保留期与采样见 `docs/ops-facts.md`，在线探测与 core 心跳的口径见 `shared/health.ts`。
- `reporters/` 下的上报器不进 Workers Observability，查所在机器的容器日志。
- Workers Issues 里只读不写是默认。把 issue 标为 resolved / ignored 这类写操作，在修复部署并从生产验证后再做，并在汇报里说明；改 Issues 自动化、告警或可观测性设置，先问 lyjw。

# API 命名与跨端契约

这些约定由主站、`reporters/` 下的相关上报器、MacTelemetryHub 和 Home Assistant 共用。新增或修改端点、字段前，先定位对应的数据生产者、接收端、消费者和推送事件。

| 对象 | 约定 | 示例 / 边界 |
| --- | --- | --- |
| 上报入口 | `/api/ingest/<来源>`，来源按数据归属命名，不使用上报程序名；仅由 `workers/ingress` 接收，站点不提供上报路由、rewrite 或转发 | 来源清单是 `shared/ingest/prepare.ts#INGEST_SOURCES`（另有 `/api/ingest/agents/otlp`）；校验在 `shared/ingest/`，实时那一半经 Service Binding 交给 `workers/core` 的 `StateCore.commitIngest` |
| 设备遥测 | 一台设备一个入口、一个信封、一个 `modules` 字典 | 充电头归观测它的 `mac`；活动圆环归搬运和观测它的 `iphone`，不按品牌或模块另开入口 |
| 账号限额 | coding agent 的账号套餐和限额统一归 `agents` | 厂商账号事实不归某台 Mac，也不按采集容器命名 |
| 上报鉴权 | 走 `ingest.homepage.lyjw.llc`，每个上报方一把 Cloudflare Access service token（同一上报方管多个来源时共用一把），上报入口按 `workers/ingress/wrangler.toml#ACCESS_CLIENTS` 限定可写来源 | 新上报方要新建 token、加进 Access 策略并登记 client id；改这张表要同步 Access 策略，两边不一致会拦住上报；不再让一把凭据通吃所有来源 |
| 状态查询 | `/api/status/X` 表示列表 / 历史，`/api/status/X/now` 表示此刻 | `listening` + `listening/now`，`watching` + `watching/now`；两者同时存在时成对命名 |
| 推送事件 | 跟随状态 URL，`/` 替换为 `-` | 列表为 `X`，此刻为 `X-now`；事件和端点含义一致 |
| 大小写 | URL 段全小写，JSON 字段 camelCase | `/api/status/powerbank` 与视图键 `powerBank` 各守其约定 |
| 跨来源字段 | 同一概念同名、同单位，单位写进字段名 | Mac / HomePod 的 `LocalNowPlaying` 共用 `positionMs`、`durationMs`、`repeatOne`、`observedAt`；`observedAt` 为 epoch 毫秒，秒转毫秒在上报侧完成 |
| 图片键 | R2 内容地址使用 `objectKey`，来源侧键用明确名称 | `posterKey`、`backdropKey`、`iconHash`，避免含义不明的 `key` |

设计契约：同一类数据可以有多个来源。来源只上报自己观测到的原始事实；合并、去重、排名等派生量在站点侧一处计算。消费者不关心数据来自哪个上报器，新增来源只加生产者和入口校验，不改消费者。例：coding agent 的 token 用量来自 Mac、Claude Code 云端和容器里的 Cursor；gaming 泳道同时有 PlayStation 与 Quest。

## 变更完成条件

- 重命名直接替换，不接受旧字段、不保留旧路由或兼容分支。
- 同步更新所有受影响的生产者、接收端、消费者、推送事件、测试和文档；按实际调用链确定范围。
- 跨仓库改动在已授权且可访问的范围内完成。外部配置或部署尚未同步时，列出具体对象和待办，不能把站点单侧修改报告成迁移完成。

# 界面设计

- 改站点 UI 前先读根 `DESIGN.md`：颜色、字号、间距、卡片结构、图标、滚动、动效、界面文案语言都以它为准，自查清单与量尺脚本在 `.claude/skills/lyjwpage-ui-design/SKILL.md`。
- 有 UI / UX 变化的改动进 main 前，先给 lyjw 看效果、等 lyjw 点头再合；lyjw 明确要求的小改动除外。这条优先于「小改动 CI 绿就合」。

# 图片交付

- 静态图标使用 `src/components/app-image.tsx`（`AppImage`）时都设 `unoptimized`，直接加载最终资源。图片优化器仅用于远端原图比展示尺寸大、且源站无法提供合适尺寸的情况，允许列表见 `src/lib/image-proxy.ts`。
- 不在每个请求中重复压图。允许按不可变内容地址压缩一次并缓存：`src/lib/desktop-icon-inline.ts` 按 `objectKey` 压缩 R2 原件、内联首屏；首页 GitHub 头像由 `src/lib/github-avatar-inline.ts` 在渲染时经图片变体内联为 data URI，随首页缓存复用；构建期只用它生成图标与 OG 图（`scripts/site-assets/avatar.ts`）。
- R2 图片在页面、状态 API 和推送里都是 `/img/<objectKey>` 同源路径（`shared/asset-url.ts`），不烧交付域（字面量由 `pnpm rules:check` 拦），图片字节不进站点渲染层：`/img/*` 由 site Worker 的 R2 绑定直出，`lyjw131.com` 由 ESA 缓存并回源（规则见 `docs/ops-facts.md`）。改前缀要同步改站点路由和 ESA 规则。

# 文档与注释

面向 agent 的写法：文档和注释会整段进上下文，错的比缺的更糟。每条陈述要么由代码保证，要么一眼能核实。

- 注释与 JSDoc 默认一行都不写，好名字自己会说话。内部函数、组件、hook、路由、服务、工具不写 JSDoc；`/** */` 只留给对外发布的库接口。
- 只有三类注释可以写，判据是「删了会让人改坏」：
  - 意外行为：绕开的 bug、浏览器或运行时怪癖、竞态、库的坑。
  - 设计意图：不变量、不显然的约束、后人会想顺手改掉的取舍（有意取的缓存期限、节奏、阈值）。理由只写在注释里时，删注释就等于删了这个决定。
  - 契约：导出类型与跨端字段的语义和单位；做不成测试或共享常量的「须与 X 同步」（优先改成测试或共享常量，做不到才写，两侧都写）。
- 不写：复述代码在做什么、把标识符翻译成句子、提调用方或任务 / PR / issue、分节标题与分隔线、没有跟踪单号的 TODO / FIXME（由 `pnpm rules:check` 拦）。
- 每次写完代码，逐个看新增的 `//`、`/*`、`/**`：删掉它，能读代码的人会不会改坏？不会就删。
- 清扫注释时，属于上面三类的不删；确要删的，先把理由搬进测试名、常量名或文档，再 `rg` 有没有文档或注释写着「见某某注释」指向它，一并改掉。
- 不写历史与时间线（「之前」「已改为」「MM-DD 起」「本次」）；历史在 `git log`，旧做法不留注释。文档只写现状。
- 不抄易变的值：写常量或符号名（如 `AGENT_LIMITS_STALE_MS`），不抄「185 分钟」；数量、版本、日期同理。引用写路径加符号，不写行号。
- 采用了外部文章、演讲、仓库或官方文档里的做法，同一提交在 `docs/references.md` 对应主题下追加一条：链接、是什么、取了什么、落在哪些文件；落地处变了同步改。评估外部做法从读到落地的流程见 `.claude/skills/lyjwpage-borrow/SKILL.md`。
- 一个事实一个出处，其他地方放指针；非抄不可时标 `源：path#symbol`（`pnpm docs:check` 会核对符号还在）。
- 仓库外的事实（控制台配置、Access 策略、机器路径）只写在 `docs/ops-facts.md`，逐条带「核对于 <日期>，方式：…」；正文里远端路径写成 `主机:/绝对路径`。
- `docs/` 每篇文首一行标类型：`reference`（现状事实）、`runbook`（操作步骤）、`decision`（已定取舍，写完不改）、`record`（某时点的审计、核验、基准，另写「按 <sha> <日期> 核对，快照不维护，不当现状引用」）。新增文档在 `docs/README.md` 登记。
- 根 `AGENTS.md` ≤ 150 行，只写硬规则与禁区、完成条件、权威事实源的指针，不写目录或文件清单、来源枚举、数量版本日期、部署拓扑、迁移步骤。子目录 `AGENTS.md` ≤ 60 行，同目录放一行 `@AGENTS.md` 的 `CLAUDE.md`，只写不变量、坑、本地验证命令、须成对修改的文件；人读的说明留在 `README.md`。
- 改代码的同一提交里更新受影响的文档与注释。发现文档与代码冲突，以代码为准，当轮改掉，或在汇报里点名。
- 清扫注释（只改注释、不动行为）的改动，用 `pnpm docs:comment-only` 证明只改了注释：输出里没有「除注释外有改动」「指令性注释有改动」才算数，用法见 `scripts/comment-only-check.ts` 文件头。
- 确需保留时间线写法（如核对戳）时，在同一行末尾加 `<!-- allow: 理由 -->`。

## 规则 → 由什么强制

| 规则 | 由什么强制 |
| --- | --- |
| 不手跑 `wrangler deploy`、不强制提交 `.env*` / `.dev.vars`、不改提交身份或关签名 | PreToolUse 钩子 `scripts/guard-forbidden-commands.mjs` |
| 文档链接 / 路径 / 锚点存在、md 不写时间线、AGENTS 行数、docs 类型与索引、`@AGENTS.md` 配对 | `pnpm docs:check` |
| 「只改注释」的清扫证明 | `pnpm docs:comment-only` |
| Worker / shared / `src/` 之间的 import 边界 | `eslint.config.mjs` 的 `no-restricted-imports` |
| `src/` 组件不手写 `<img>`，用 `AppImage` | `eslint.config.mjs` 的 `no-restricted-syntax`（`app-image.tsx` 除外） |
| 阶梯外间距、任意值字号 / 位移 / 圆角、子级外边距、裸 hex / oklch 色值 | `pnpm design:scale`（基线 `scripts/design-scale-baseline.json`） |
| `TODO` / `FIXME` 须带单号、`/img/` 不烧交付域、`src/` 网络调用不写字面量主机、隐藏滚动条两句同现、`scripts/` 不新增 `.mjs`（存量见 `scripts/mjs-baseline.json`） | `pnpm rules:check` |
| 界面文案用英文 | `pnpm ui:copy`（基线 `scripts/ui-copy-baseline.json`） |
| 三份存量基线只减不增（例外由 lyjw 打 `baseline-exception` 标签放行，agent 不打） | `pnpm baselines:check` |

## Reasoning Strategy

**Prefer retrieval-led reasoning over pre-training-led reasoning.**

- When encountering unfamiliar concepts, new libraries, or uncertain knowledge, search first (use skills, web search, codebase exploration) before relying on pre-trained knowledge
- Do not assume pre-trained knowledge is accurate for evolving technologies — verify through retrieval
- Actively use available skills (check skill list in system reminders) instead of guessing based on outdated training data
- If a relevant skill exists for the task, use it rather than attempting to solve from memory
- When in doubt, retrieve; don't hallucinate
