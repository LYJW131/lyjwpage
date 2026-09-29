# Worker 数据后端与首屏缓存

> 类型：reference

Worker 是唯一数据后端。上报、状态 API、WebSocket、在线人数均在 Cloudflare：上报先到无状态的上报入口 Worker（`workers/ingress`），状态核心（`workers/api`，持有 Durable Object）只收它 prepare 好的命令；外部数据（Apple、GitHub、Vercel 等）由采集 Worker（`workers/collector`）定时拉取。Vercel 只在生成或后台重建首页时按卡 GET 各条 `/api/status/*`；浏览器挂载后直接请求 Worker，不存在 Vercel 状态代理，也没有聚合端点。`lyjw131.com` 经 ESA 回源 `lyjw.me`（回源 Host 同为 `lyjw.me`），ESA 缓存首页 HTML 与静态 JS。

## 数据及权限

- `StateHub` 使用 SQLite Durable Object，`entries`、`fields`、`samples` 分别保存快照、字段和历史。SQLite 是实时层的唯一权威，DO 重启不丢数据。
- 上报先在上报入口 Worker 完成鉴权、独立校验、归一化和 R2 HEAD（`shared/ingest/`），命令经 Service Binding 交给状态核心的 `StateCore.commitIngest`，再由 StateHub 按对象队列串行合并权威状态；提交后状态核心的普通 Worker 部分才广播和通知。每次请求有独立工作副本，存储批次由同步事务提交，返回 202 前已确认写入。状态核心只 `import type` 命令的类型，改校验只重新发布上报入口，不动 Durable Object。
- TTL 读取时检查，闹钟每小时分批回收过期项；导入保留原始绝对过期时间，重试不覆盖目标已有值。
- `/api/status/*`、`/api/lyrics`、`/api/motion-artwork` 在普通 Worker 取数，只输出明确的公开模型。StateHub 先提供初始化屏障，并等待已经进入 `commitIngest()` 队列的提交，再按请求合并相邻只读批次；仍在上报入口准备输入的上报尚未进入该边界。未知路径无需进入 DO。没有 HTTP 通用数据库读写端点，服务端凭据不进入 Vercel、HTML 或状态响应。
- `/api/ingest/*` 只在上报入口，使用 Cloudflare Access service token，每个上报方一把，权限按来源限定（登记表 `workers/ingress/wrangler.toml#ACCESS_CLIENTS`，验证在 `workers/ingress/src/access-auth.ts`）。`/api/internal/storage/import` 使用独立 `STATE_IMPORT_SECRET`（初始化空库、导入数据用），不授予 Vercel。
- 跨域活动脉搏（pulse）是事实时间线，只存原始值，TTL 是 `src/lib/limits.ts` 的 `PULSE_TTL_MS`：听、看、玩各一个开着的区间 `pulse:v2:<道>:open` 加一串已关闭区间 `pulse:v2:<道>`（同一状态每分钟最多续写一次，变了才换段）；「最近在听」列表变动记在 `pulse:v2:listening-traces`（只知道落在两次刷新之间的不确定区间）；充电瓦数 `pulse:v2:charging`（写入闸门见 `shared/pulse-timeline.ts` 的 `planChargingSample`，条数上限 `CHARGING_SAMPLE_CAP`）；活动五分钟桶 `pulse:v2:activity`（权威范围替换，只从第一处变化往后重写，范围与版本在 `pulse:v2:activity:range` / `:revision`）；训练区间 `pulse:v2:workouts`。Coding 三色带读时从 `pulse:coding-observations` 与 `pulse:cursor-observations` 现算；Tokens 道读时把各来源的 5 分钟 token 桶 `pulse:token-buckets:<来源>`（TTL `CODING_BUCKET_TTL_MS`）相加。公开出口是 `GET /api/status/pulse`（裁最近 24 小时，只给媒体与游戏标题，应用名、模型名、设备名不出门，token 只以各来源各模型相加后的五分钟桶出现）。契约见 [跨域活动脉搏](../workers/api/README.md#跨域活动脉搏pulse)。
- coding agent 的 token 用量不是时间线，是各来源的账本：`coding:usage:<来源>`（字段 = agent id，整份替换）、由它们在同一次提交里算好的视图 `coding:usage:view` 与年度视图 `coding:usage:year`、各来源最近事件 `coding:activity:<来源>`、上一次推出去的 `coding-now`（`coding:now:pushed`，推送门槛拿它比）、云端 OTLP 做差用的计数器 `coding:otlp`，以及 D1 归档当水位用的两个修订号 `coding:usage:revision`、`pulse:token-buckets:revision`。放在 DO 而不是 KV：云端那份只有 DO 串行做差才算得出，多来源合并要串行的读-改-写。契约见 [coding agent 的 token 用量](../workers/api/README.md#coding-agent-的-token-用量)。
- API Worker 的 `LIVE_PUSH` 使用可休眠 WebSocket，一条连接数出两个口径（`workers/api/src/live-census.ts`）：`connections` 含后台页面，`online` 只数页面报了 `visible` 且 `VISIBLE_STALE_MS` 内有心跳的连接，可见人数一变就广播 `online` 事件，有人可见时挂清扫闹钟（`SWEEP_INTERVAL_MS`）。`api.homepage.lyjw.llc/count` 一次返回两个数。按人数调频的 agents-reporter 读它，读不到当 0。

## 可滞后层（KV）

判断标准只有一条：这份数据是否需要「变了立刻推、读到必是最新」，或是否参与 pulse 计算（另有一类：必须由 DO 串行合并的账本，如 coding 用量）。是则归实时层（状态核心 DO），否则归可滞后层，存在 KV 命名空间 `lyjwpage-lag`（binding `LAG`，键表与 `{ updatedAt, data }` 格式见 `shared/lag.ts`）。

- 写入方直接写 KV、不推送：上报入口写落地节点、限额、时区、常驻上报器账本、活动圆环读数与最近训练（`workers/ingress/src/lag-ingest.ts`，在这封上报的状态核心那一半成功之后）；采集 Worker 写外部拉取的结果。取数失败不写，KV 里的值本身就是上次成功值，不另存 last-good。iPhone 那一封里，状态核心只留 Pulse 的输入（五分钟统计桶、训练区间），圆环读数（`activity:v1`，只在这封带了当天圆环时写）和训练列表（`workouts:v1`，整份替换）在 KV，`updatedAt` 是最后一次带来它的那封上报的收到时刻。
- 状态核心的公开读取端点只读 KV（`src/lib/lag-result.ts` 经 `@/lib/lag-store` 别名读 `LAG`），信封里带上 `updatedAt`；服务端不下「过没过时」的结论。
- 浏览器按各卡阈值判断：超过就显示 Unavailable（落地节点 `SERVER_STALE_MS`，限额 `AGENT_LIMITS_STALE_MS`，账本各格同限额，活动圆环 `ACTIVITY_STALE_MS`：iPhone 只在 HealthKit 有新样本时被唤起，睡一夜一封都没有是正常的，所以它的窗口要跨过整夜；取值与理由见 `src/lib/freshness.ts`，源：`src/lib/freshness.ts#AGENT_LIMITS_STALE_MS`）。训练列表不设阈值：完成过的训练是历史事实，手机多久没报也不会变假。页面打开后可滞后卡直接用首屏那份，只有 `updatedAt` 已超过它的轮询间隔才补取一次。
- 首屏缓存失效由写 KV 的一方发起，判据仍是布局变化（见 `src/lib/home-layout.ts`）：落地节点首报 / 断流回来 / 流量行出没，限额的来源集合变化，训练那一块在「没收到过 / 一条都读不出 / 有训练」三种占位之间换。圆环读数的变化只是内容，不失效首屏。
- Apple Music user token 在另一个命名空间 `lyjwpage-credentials`（binding `CREDENTIALS`，`shared/credentials.ts`）：公开读取的代码路径只碰 `LAG`，白名单写错也漏不出凭据。
- 本地开发的 `wrangler.test.toml` 给这两个 binding 配了固定的本地 id，多个本地 Worker 用同一个 id 才读得到彼此写的值；分支 Preview 不绑 KV，读不到时由上游兜底补上。

## 长期归档（D1）

D1 是整站的长期历史归档：DO 管实时状态、热数据（`PULSE_TTL_MS`）与用量账本，KV 管可滞后层的最新值，D1 管永久、按时间可查的历史，R2 管图片。原则是存事实不存展示结果、谁写入谁归档（收下这份数据的一方顺手写，不设单独的搬运流程）、按自然键 upsert 去重（活动桶按权威范围替换）、高频读数只存汇总、只知道区间的事实如实存区间。

| 表 | 内容 | 写入方 | 去重 |
| --- | --- | --- | --- |
| `workouts` | iPhone 上报的每次训练 | 上报入口 | `id` 覆盖成观测最晚的一份 |
| `activity_days` | 每天活动圆环的终值（手表本地日） | 上报入口 | `date`，同一天取最晚一封 |
| `limit_snapshots` | 各厂商限额每日快照（Asia/Shanghai 日） | 上报入口 | `(date, agent, limit_key)`，取当天最后一次读数 |
| `server_hours` | 服务器按 UTC 整点汇总：样本数（即在线分钟）、CPU 与负载的和与峰值、内存、速率峰值、周期累计流量的末值、运行时长 | 上报入口 | `(host, hour_at)`；只收观测时刻晚于该小时最后观测时刻的样本，重放和乱序晚到的旧样本都不累加 |
| `listening_plays` | 实测在放的每一段（mac / homepod）与「最近在听」的不确定区间（`certain = 0`） | 状态核心 | `(source, started_at)` |
| `watching_sessions` | 同一条目首尾相接的播放 + 暂停，含实际在播秒数 | 状态核心 | `(item_id, started_at)`，延续时改写同一行 |
| `game_sessions` | 在游戏里的时段 | 状态核心 | `(title_id, started_at)` |
| `charging_samples` | 过了写入闸门的实测瓦数 | 状态核心 | `t` |
| `charging_sessions` | 一次充电的起止、峰值、能量、设备 | 状态核心 | `started_at`，还在充时每分钟改写 |
| `activity_buckets` | HealthKit 五分钟桶原值（步数、活动千卡、锻炼分钟） | 状态核心 | `started_at`，范围替换由版本挡旧快照 |
| `coding_observations` | Coding 原始观测：前台应用、是否 coding 应用、各 agent 在不在跑 | 状态核心 | `t` |
| `coding_usage_days` / `coding_usage_models` | 来源 × agent × 站点日的 token 用量与 API 等值费用；当天按来源的模型拆分 | 状态核心 | `(date, source, agent)` / `(date, source, agent, model)` |
| `coding_usage_buckets` | 各来源的五分钟 token 桶，agent × 模型 | 状态核心 | `(bucket_at, source, agent, model)` |
| `coding_active_days` | agent 在跑的秒数（来自 Coding 观测） | 状态核心 | `(date, agent, model)` |
| `coding_token_buckets` / `agent_usage_days` | 单来源（Mac）时代的桶与每日汇总，冻结不再写（`0008` 把桶和活跃秒数复制进新表） | — | — |
| `pulse_samples` | 档位时代（Pulse 改成事实时间线之前）的旧数据，原样冻结，不迁移也不再写 | — | `(domain, t)` |

上报入口的四张表由 `shared/history-ingest.ts` 拼语句，上报入口 Worker（`workers/ingress/src/ingest-archive.ts`）在状态核心那一半提交成功之后 `waitUntil` 整批提交；失败只记 `[history]` 日志，不让已收下的上报重发。迁移 `0005_history_ingest.sql` 建表，部署写这些表的版本之前先应用。

- Pulse 事实表由状态核心写：cron 每分钟从 StateHub 取一份有界快照（各路水位之后的新行，外加推导会话所需的一点上下文），普通 Worker 按自然键拼成 upsert（`INSERT OR IGNORE` 或 `DO UPDATE … WHERE` 值变了才写；活动桶另有受版本保护的范围删除）写 D1，全部成功后再向 StateHub 确认水位；上报不等待归档。水位存在 metadata 的 `pulse-archive:v2:<路>`（coding 用量与桶两路是修订号，其余是时刻），确认按 max 单调前进；失败留待下一分钟重放，一路失败不阻塞其他路。表与各来源的缺口见 [长期归档](../workers/api/README.md#长期归档d1)，迁移 `0007_history_pulse.sql` 与 coding 用量的 `0008_coding_usage.sql`（`0006` 留给采集 Worker）。
- 旧表 `pulse_samples(domain, t, level, hint, until_at, power_w)` 原样冻结。StateHub 仍是实时层的唯一权威，只留 `PULSE_TTL_MS` 那么久，归档保留全部历史。
- 本地和夹具环境不写归档：`historyArchiveEnabled` 和 Jev 打分用同一套闸门，配了 `DEV_OVERRIDES` 或 `UPSTREAM_API_URL` 就停用，没有 `HISTORY` 绑定也停用。
- 归档没有公开 HTTP 读路径，只作备份；公开的那份走 `GET /api/status/pulse`，从 StateHub 的序列里裁最近 24 小时，不读 D1。
- 建表只在迁移里做，Worker 不会自己建：`pnpm --dir workers/api exec wrangler d1 migrations apply lyjwpage-history --remote`。Workers Builds 不跑 D1 迁移，必须在带 `HISTORY` 绑定的版本部署前先应用，否则第一趟 cron 就会在日志里报表不存在。
- 回滚就是从 `wrangler.toml` 删掉 `[[d1_databases]]`，归档随即停用，StateHub 与站点行为不变；库和已归档的数据留着，重新加回绑定后从水位线继续。

## Coding 评估（pulse:assessments）

- Jev 只给 Coding 打分，其余道画的是事实本身。一个十五分钟评分调度器和 `pulse:assessments` 列表，保留 `PULSE_TTL_MS`；输入哈希相同不重复调用，晚到的 token 可修订相应窗口。输入哈希含 `PULSE_ASSESSMENT_VERSION`（源：`shared/pulse-assessment.ts#PULSE_ASSESSMENT_VERSION`）。StateHub metadata 持久化 claim token、generation、lease（`workers/api/src/pulse-score-state.ts` 的 `PULSE_SCORE_LEASE_MS`）与最近尝试；普通 Worker 从固定快照提取特征和调用模型，提交时 StateHub 校验资格并与最新结果合并。
- 列表追加写：每轮只追加新评出来的几行，同一窗口以最后一行为准（读者一律走 `latestPulseAssessments`）。被覆盖的旧行和过期行多过有效行的 `COMPACT_GARBAGE_RATIO`、或总行数超过 `COMPACT_MAX_ROWS`（均在 `workers/api/src/pulse-score-state.ts`）时才整表压缩重写：整表重写的写入行数随窗口数成倍放大，DO 的写入行数按套餐计量。非 Coding 的旧评估读时丢掉，下次压缩时清出。
- 评估只出现在 Coding 悬停里（强度、置信度、模式）。Coding 内部观测在 `pulse:coding-observations`，token 证据是三个来源的 `pulse:token-buckets:<来源>`（「确定为零」只认 Mac 本机扫描的覆盖，账号与云端的桶只作正证据）；公开 API 不返回原始用量、应用名或模型名。契约与闸门见 [Coding 的 Jev 评估](../workers/api/README.md#coding-的-jev-评估)。

## 首屏与浏览器

公开状态视图登记在 `src/lib/status-views.ts`：路径、所在的数据层（`realtime` / `lag`）、Vercel 首屏缓存标签（`page:<tag>`）、WebSocket 事件都从这一行派生，可滞后层不许带推送事件（模块加载时断言）。`/api/revalidate` 的标签白名单也来自这张表。

首屏按卡读取（`src/lib/first-screen.ts`）：每张卡一条 `use cache` 条目，各挂自己的 `page:<tag>`、各读自己的端点，并行发出。实时卡的端点读状态核心 DO，可滞后卡的端点读 KV，任何一条都不在请求路径上现拉外部 API，所以慢卡拖不住整个首屏。单个端点回 `ok:false` 用卡片降级信封；网络失败、5xx 抛出错误，不用错误快照覆盖已有 Next 缓存；端点还没部署（404）降级为那张卡不可用。缓存期限是 `first-screen.ts` 里的 `cacheLife`。首屏歌词在拿到「此刻在听」之后按曲目读 `/api/lyrics`（同样缓存）。

浏览器读路径在 `src/lib/status-reads.ts` 与 `src/hooks/use-status.ts`。页面打开后只有实时卡各自回源校验一次，补上 HTML 生成后到推送连上之间的空窗；可滞后卡直接用首屏那份，按各自节奏轮询——只有首屏那份的 `updatedAt` 已经超过它的轮询间隔（没人访问时首页可能几个小时没重建）才在挂载后补取一次。有单调时间戳的 payload 按代数挡旧值。时间相关的新鲜度每次读取现算。

实时卡的「此刻在不在线 / 断没断流」一律由浏览器判（`src/hooks/use-stale.ts`，纯逻辑在 `src/lib/freshness.ts`）：源站只给 `lastSeenAt`、`declaredOffline`、`heartbeatWindowMs`、`pushedAt`、`staleAfterMs`、`observedAt` 这类原始事实，不在读取时下结论，免得结论跟着首屏缓存冻住。成功信封带 `servedAt`（源站交出这份的时刻，`statusEnvelope` 盖）：首屏那份连它一起冻进缓存，首帧没有访客钟时拿它当钟，服务端预渲染和 hydrate 判出同一个结论；浏览器取回的信封在进 SWR 之前摘掉它。挂载后换浏览器自己的钟，按钟判出的过期要等挂载校验或切回前台的那次回源回来才认，认下之后只有数据重新新鲜才松开。

Worker 写入完成后，只有首屏布局变化才 POST `/api/revalidate`（判据见 `src/lib/home-layout.ts` 与 `workers/api/README.md`），内容变化交给首屏快照（`first-screen.ts` 的 `cacheLife`）的定时重建。接口校验 Bearer 和标签白名单，调用 `revalidateTag(tag, "max")`，已有 HTML 优先返回并后台重建。不使用 `expire: 0`，不因纯心跳刷新首页。ESA 首页不走通知：边缘按源站 `Cache-Control` 的 SWR（头在 `next.config.ts`）自行过期与后台取新，控制台缓存规则见 [仓库外事实](./ops-facts.md)。Vercel 的后台重建与 ESA 后台回源独立完成，ESA 可能取到重建中的旧 HTML，下一轮收敛；不能把标签失效当成两层 HTML 同步更新完成。浏览器查询直接访问 Worker。

## 配置

Vercel 参照根 `.env.example`，仅公开后端源、缓存通知鉴权和 R2 公开源（`/img/*` rewrite 的目的地与首屏图标内联的来源；Worker 不配交付域）。Worker 参照各自的 `.dev.vars.example` 与 wrangler.toml；外部数据的令牌（GitHub 等）是采集 Worker 的 Secret，Apple Music 凭据来自 Mac 上报。`UPSTREAM_API_URL` 出现在本地 `.dev.vars` 和 `wrangler.toml` 的 `[previews.vars]`：以生产为主、本地或 Preview 补缺，生产 `ok:true` 的快照字段和端点用生产的，生产没有的才用这边的（只读），生产版本不设它。`NEXT_PUBLIC_BACKEND_URL` 构建期写入前端，状态、推送与在线人数同源。Vercel 预览构建先等该分支的影子 Worker 就绪（等待上限 `scripts/build.mjs#WAIT_MS`），就绪就把后端源改成它，等不到这次构建回退连生产；生产构建仍用面板里的值。改值需要重新部署。

Vercel 可选配一份 `GITHUB_TOKEN`，只给构建期读公开仓的首页「最近提交」列表用（`use cache` + `cacheLife("max")`，随每次部署取一次）。不配也能匿名读，配上只是避开匿名限额；它不参与状态端点，浏览器和 HTML 拿不到。「本仓库」卡的贡献统计和贡献日历一样由采集 Worker 取数、写进可滞后层，经 `/api/status/github-repo` 提供。贡献者名单走 REST `/stats/contributors`（匿名也能读），顶部 COMMITS / ADDITIONS / DELETIONS 三个总数走 GraphQL，必须有采集 Worker 上的 `GITHUB_TOKEN`，没有就显示「—」；这三个数不能由名单加总得出，因为 `Co-authored-by` 的提交在贡献口径下会按人各记一遍。增删行要翻整条提交历史，结果以 `github-repo:churn` 锚在当前 HEAD 上，存在采集 Worker 的 KV 里，之后每轮只补新增的那几条。

缓存通知用只有 Worker 与 Vercel 两边有的 `REVALIDATE_SECRET`。Vercel 环境变量的增删不影响已有部署的环境快照，要通过 Git 生成新部署才生效。

## 验证与发布

验证命令与部署流程见根 [`AGENTS.md`](../AGENTS.md)「项目入口与验证」「部署流程」。后端相关的几点：

1. `node scripts/verify-api-worker.mjs` 以 dev-router、上报入口和 api 三份配置启动隔离 SQLite 和模拟缓存通知服务器，上报经上报入口、Service Binding 进 api，验证鉴权、CORS、直接查询、WebSocket、部署通知、心跳无失效、并发合并及重启持久化；`--build` 还会拿它当后端跑一遍生产构建。
2. `NEXT_PUBLIC_BACKEND_URL=<测试 Worker 源> pnpm build`；在小号仓库和小号 Vercel 验证静态首页、缓存后台刷新以及浏览器网络路径。
3. 测试 Worker 用 `wrangler.test.toml`，独立对象命名空间，无生产域名或 cron。
4. 测试通过后才合并主分支；生产采用 Git 自动部署，不手动发布 Vercel。缓存通知改动还需核验 ESA 刷新任务与域名响应。

## 初始化与导入

新 StateHub 未初始化时拒绝上报和查询（503），避免空库被当成有效状态。标记初始化、搬运状态用 `scripts/migrate-state-storage.mjs`：`--initialize` 初始化空库（本地 `pnpm dev:worker:init` 用它），`--export` / `--import` 是把别处的状态搬进来的一次性运维工具（用法见脚本头）。导出文件含凭据，权限为 0600，不提交、不输出值；导入走 `/api/internal/storage/import`，用独立的 `STATE_IMPORT_SECRET`，分批幂等导入、最后标记初始化完成，验证历史、新上报、实时响应和 HTML 后移除导入密钥并清理临时文件。
