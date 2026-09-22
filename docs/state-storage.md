# Worker 数据后端与首屏缓存

Worker 是唯一数据后端。上报、状态 API、Apple / GitHub 获取和缓存、WebSocket、在线人数均在 Cloudflare。Vercel 只在生成或后台重建首页时 GET `/api/home`；浏览器挂载后直接请求 Worker（第一轮合成一次 `/api/home`，之后各端点各自轮询），不存在 Vercel 状态代理。`lyjw131.com` 经 ESA 回源 `lyjw.me`（回源 Host 同为 `lyjw.me`），ESA 缓存首页 HTML 与静态 JS。

## 数据及权限

- `StateHub` 使用 SQLite Durable Object，`entries`、`fields`、`samples` 分别保存快照、字段和历史。SQLite 是唯一持久状态，DO 重启不丢数据。
- 上报先在普通 Worker 完成独立校验、归一化和 R2 HEAD，再由 StateHub 按对象队列串行合并权威状态；提交后普通 Worker 才广播和通知。每次请求有独立工作副本，存储批次由同步事务提交，返回 202 前已确认写入。
- TTL 读取时检查，闹钟每小时分批回收过期项；导入保留原始绝对过期时间，重试不覆盖目标已有值。
- `/api/status/*`、`/api/home`、`/api/lyrics`、`/api/motion-artwork` 在普通 Worker 聚合，只输出明确的公开模型。StateHub 先提供初始化屏障，并等待已经进入 `commitIngest()` 队列的提交，再按请求合并相邻只读批次；仍在普通 Worker 准备输入的上报尚未进入该边界。未知路径无需进入 DO。没有 HTTP 通用数据库读写端点，服务端凭据不进入 Vercel、HTML 或状态响应。
- `/api/ingest/*` 使用 `TELEMETRY_INGEST_SECRET`。临时 `/api/internal/storage/import` 使用独立 `STATE_IMPORT_SECRET`，不授予 Vercel，迁移后删除 Secret。
- 跨域活动脉搏（pulse）键为 `pulse:<domain>`（`coding` / `listening` / `watching` / `gaming` / `charging` / `activity`）。每域最多 600 条，TTL 7 天；同水平非空闲最多每 5 分钟再确认一次，空闲只留一条。身体活动 `activity` 例外：每个有效上报区间留一条，含明确终点 `until`，不向未来延续。公开出口是 `GET /api/status/pulse`（裁最近 24 小时、剥掉 `hint`）；`hint` 只留在库里和送去打分的那份里。
- API Worker 的 `LIVE_PUSH` 使用可休眠 WebSocket，`api.homepage.lyjw.llc/count` 返回 `connections`（包含后台页面）。独立 `online-counter` Worker 的 `ONLINE_COUNTER` 维护可见连接，按空闲超时清扫；`online.homepage.lyjw.llc/count` 返回 `online`。三个调频上报器并行读取两个计数口，各自失败时仅该端归零。

## 长期归档（D1）

- 归档库 `lyjwpage-history`，Worker 里的绑定叫 `HISTORY`。活动曲线在 `pulse_samples(domain, t, level, hint, until_at, power_w)`，主键 `(domain, t)`；展示状态变更在 `state_changes`。迁移 `0002_pulse_activity_intervals.sql` 增加 `until_at`（其他域为 NULL），`0003_pulse_power.sql` 增加 `power_w`。StateHub 仍是唯一权威，这里只增不删：StateHub 的 pulse 每域只留 600 条 / 7 天（充电 6000 条），归档保留全部历史。
- cron 每分钟从 StateHub 一次取得六域有界快照与水位，普通 Worker 分批写 D1，再逐批向 StateHub 确认水位；上报不等待归档。每域水位存在 metadata 的 `pulse-archive:<domain>`，确认按 max 单调前进。只有 `INSERT OR IGNORE` 成功的批次会确认，失败留待下一分钟重放；每批最多 100 条，一域失败不阻塞其他域。
- 本地和夹具环境不写归档：`historyArchiveEnabled` 和读模型用同一套闸门，配了 `DEV_OVERRIDES` 或 `UPSTREAM_API_URL` 就停用，没有 `HISTORY` 绑定也停用。
- 归档暂时没有公开 HTTP 读路径，只作备份；公开的那份走 `GET /api/status/pulse`，从 StateHub 的 7 天序列里裁最近 24 小时，不读 D1。读归档的入口另开时再补这一节。
- 同一库还有一张 `state_changes(subject, t, at, state)`，迁移 `0005_state_changes.sql`。它记的是会被新快照盖掉的展示状态，不是 pulse 曲线。subject 覆盖前台应用、时区、Mac / HomePod 正在听、最近在听列表、正在看、续播列表、PSN 在线与电源、最近游玩、奖杯概览（账号进度、每款游戏的枚数、最近 40 枚解锁）、充电头和充电宝的结构变化、服务器快照、编码此刻 / 用量摘要 / 年图 / 限额、锻炼、活动圆环。序号是 `0005`：`0004` 留给先进入 main 的 pulse 归档修订，本分支不包含那份文件。
- 一条记录是变化之后的状态。比较时去掉时钟（`observedAt`、播放进度、推送时刻）和纯心跳；封面地址换新、充电瓦数的连续采样、原始 token 窗口、评分、凭据和存活探针都不进这张表。瓦数阶跃仍在 `pulse_samples.power_w`，充电头曲线仍留在 StateHub。在看更新没带条目详情时，存档用的是和直播同一份已解析标题，不把标题写成空。
- 上报路径上和快照一起写进 StateHub，写失败就让这封上报失败，上报器重试；没变化不追加。每个 subject 热数据最多 4000 条、TTL 7 天。cron 每分钟由普通 Worker 读取各 subject 的有界快照，分批 `INSERT OR IGNORE` 进 D1，再向 StateHub 确认水位（`state-journal:<subject>`，按 max 单调前进）。失败不推进水位线，下一分钟重放；一个 subject 失败不挡住其他 subject。
- 建表只在迁移里做，Worker 不会自己建：`pnpm --dir workers/api exec wrangler d1 migrations apply lyjwpage-history --remote`。Workers Builds 不跑 D1 迁移，必须在带 `HISTORY` 绑定的版本部署前先应用，否则第一趟 cron 就会在日志里报表不存在。`0005` 没应用时，状态变更仍留在 StateHub，cron 报错且不推进水位线，补上迁移后下一分钟继续。main 已经有 `0004` 时，这份 `0005` 接在它后面。
- 回滚就是从 `wrangler.toml` 删掉 `[[d1_databases]]`，两张归档随即停用，StateHub 与站点行为不变；库和已归档的数据留着，重新加回绑定后从水位线继续。两张表都没有公开读路径。

## 分段评分（pulse:assessments）

- 六域共用一个五分钟评分调度器和 `pulse:assessments` 列表，保留七天；输入哈希相同不重复调用，晚到事实可修订相应窗口。输入哈希含 `PULSE_ASSESSMENT_VERSION`。StateHub metadata 持久化 claim token、generation、180 秒 lease 与最近尝试；普通 Worker 从固定快照提取特征和调用模型，提交时 StateHub 校验资格并与最新结果合并。
- 曲线读取分段评分，24 小时摘要从相同评分按已观测时长加权计算，不再有 `pulse:scores` 或独立总评模型调用。原始状态继续用于 D1 归档，评分不混入原始表。
- Coding 内部观测在 `pulse:coding-observations`，窗口 token 报告在 `pulse:coding-token-usage`；公开 API 不返回原始用量、应用名或模型名。契约与闸门见 [统一评分](../workers/api/README.md#pulse-统一五分钟评分)。
- Listening 另有 `pulse:listening-plays`：「最近在听」列表每次变动（只比条目 id 和顺序，封面地址换新不算）记一条 `{t, since, hint}`，保留 2000 条 / TTL 7 天。它不是阶跃序列、不进 `pulse_samples`、不进公开出口，只作为 Mac / HomePod 之外设备的播放证据进入 listening 窗口的评分输入；一条最多认领一个评分窗口那么长的已观测时间。同一变化的 id 和标题另记在 `state_changes` 的 `listening` subject 里，评分仍只读这份热列表。

## 首屏与浏览器

公开状态视图登记在 `src/lib/status-views.ts`：路径、Vercel 首屏缓存标签（`page:<tag>`）、WebSocket 事件、KV 读模型策略都从这一行派生。`/api/revalidate` 的标签白名单也来自这张表。

`cachedHomeSnapshot`（`src/lib/home-snapshot.ts`）一次读取公开聚合快照；单个数据源不可用使用卡片降级信封。网络失败抛出错误，不用错误快照覆盖已有 Next 缓存。`use cache`，cacheLife 为 stale 300、revalidate 600、expire 7 天；所有状态标签使用 `page:` 前缀。

浏览器读路径在 `src/lib/status-reads.ts`。打开页面后 15 秒内、各卡第一次取数合成一次 `/api/home`（5 秒超时，失败 / 字段缺失 / 字段 `ok:false` 回源；带 `since` 的增量请求也吃，其他查询参数不吃）。有单调时间戳的 payload 按代数挡旧值；收过推送或失效通知的路径不再吃这份聚合。之后各端点各自轮询。时间相关的新鲜度每次读取现算。

Worker 写入完成后，只有展示变化才 POST `/api/revalidate`。接口校验 Bearer 和标签白名单，调用 `revalidateTag(tag, "max")`，已有 HTML 优先返回并后台重建。不使用 `expire: 0`，不因纯心跳刷新首页。ESA 首页不走通知：控制台缓存规则「首页遵循源站缓存」让边缘按源站 `Cache-Control` 的 SWR（`max-age=300, stale-while-revalidate=86400`，见 `next.config.ts`）自行过期与后台取新；`/` 无文件后缀，没有这条规则会被判 DYNAMIC、每次回源。Vercel 的后台重建与 ESA 后台回源独立完成，ESA 可能取到重建中的旧 HTML，下一轮收敛；不能把标签失效当成两层 HTML 同步更新完成。浏览器查询直接访问 Worker。

## 配置

Vercel 参照根 `.env.example`，仅公开后端源、缓存通知鉴权和 R2 公开源（`/img/*` rewrite 的目的地与首屏图标内联的来源；Worker 不配交付域）。Worker 参照 `workers/api/.dev.vars.example` 与 wrangler.toml；状态数据用的 GitHub Token 使用 Worker Secret，Apple Music 凭据来自 Mac 上报。`UPSTREAM_API_URL` 只存在于本地 `.dev.vars`：本地 Worker 以生产为主、本地补缺，生产 `ok:true` 的快照字段和端点用生产的，生产没有的才用本地的（只读），生产配置不设它。`NEXT_PUBLIC_BACKEND_URL` 与 `NEXT_PUBLIC_ONLINE_COUNTER_URL` 构建期写入前端，分别提供状态/推送源与独立在线人数源，改值需要重新部署。

Vercel 可选配一份 `GITHUB_TOKEN`，只给构建期读公开仓的首页「最近提交」列表用（`use cache` + `cacheLife("max")`，随每次部署取一次）。不配也能匿名读，配上只是避开匿名限额；它不参与状态端点，浏览器和 HTML 拿不到。「本仓库」卡的贡献统计和贡献日历一样由 Worker 取数、缓存并经 `/api/home` 与 `/api/status/github-repo` 提供。贡献者名单走 REST `/stats/contributors`（匿名也能读），顶部 COMMITS / ADDITIONS / DELETIONS 三个总数走 GraphQL，必须有 Worker 上的 `GITHUB_TOKEN`，没有就显示「—」；这三个数不能由名单加总得出，因为 `Co-authored-by` 的提交在贡献口径下会按人各记一遍。增删行要翻整条提交历史，结果以 `github-repo:churn` 锚在当前 HEAD 上存 30 天，之后每轮只补新增的那几条。

迁移后从 Vercel 移除 `REDIS_URL`、R2 写入凭据及旧推送地址；保留 `TELEMETRY_INGEST_SECRET` 用于缓存通知。环境变量删除不影响已有部署的环境快照，必须在清理后通过 Git 生成新部署。删除项目变量不等于撤销原始凭据，源 Redis 可在回退观察期继续保留。

## 验证与发布

1. `pnpm test`、`pnpm typecheck`、`pnpm exec tsc --noEmit -p workers/api/tsconfig.json`。
2. `node scripts/verify-api-worker.mjs` 启动隔离 SQLite 和模拟缓存通知服务器，验证鉴权、CORS、直接查询、WebSocket、心跳无失效、并发合并及重启持久化。
3. `NEXT_PUBLIC_BACKEND_URL=<测试 Worker 源> pnpm build`；在小号仓库和小号 Vercel 验证静态首页、缓存后台刷新以及浏览器网络路径。
4. 测试 Worker 用 `wrangler.test.toml`，独立对象命名空间，无生产域名或 cron。fork 的生产 Worker workflow 有仓库身份限制。
5. 测试通过后才合并主分支。生产采用 Git 自动部署，不手动发布 Vercel。腾讯云 EdgeOne 已退役，Vercel 提供源站，ESA 加速 `lyjw131.com`。缓存通知改动还需核验 ESA 刷新任务与域名响应。

## 生产导入顺序

新 StateHub 未初始化时拒绝上报和查询（503），避免空库被当成有效状态。保留源 Redis，暂停旧写侧后等待在途请求完成，运行 `scripts/migrate-state-storage.mjs --export <私有文件>`。导出文件含凭据，权限为 0600，不提交、不输出值。

给目标 Worker 临时设置独立 `STATE_IMPORT_SECRET`，配置 `STATE_SERVICE_URL`、`STORAGE_PREFIX` 后运行 `--import <私有文件>`，分批幂等导入、最后标记初始化完成。空的独立测试环境可用 `--initialize`。验证历史、新上报、实时响应和 HTML 后，移除导入密钥并清理临时文件。

部署前保留旧版本和源 Redis 作为回退点。切换失败时回退 Worker 和 Vercel 到同一套旧版本；测试阶段不触碰源数据或生产路由。迁移过程需覆盖从暂停写入到激活新对象的短暂重试窗口。
