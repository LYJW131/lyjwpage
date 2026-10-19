# 上报入口

外部上报器的唯一入口，无状态。它在 Cloudflare Access 之后验明上报器身份，读出并校验报文，按来源收敛成命令，
再按数据层拆开写：实时那一半经 Service Binding 交给状态核心（[`workers/core`](../core/README.md)），
可滞后层、长期归档和 Apple Music 凭据自己写。GitHub Actions 的部署通知与手动跑采集也从这里进。

拆出来的理由只有一条：校验和拆分的规则经常改，而状态核心带着 Durable Object 和所有页面的 WebSocket。
改校验只发布这个 Worker，状态核心不重启、推送连接不断。

## 代码职责

- `src/index.ts`：入口；`src/worker.ts` 是全部路由、回执与拆分。
- `src/access-auth.ts`：验 Access 签的 JWT，按 `[vars.ACCESS_CLIENTS]` 查这把 service token 许不许做这件事。
- 根目录 `shared/ingest/`：各来源的 prepare（收敛、逐字段校验、Emby 的 R2 HEAD），产出能结构化复制的命令。
  状态核心只 `import type` 这里的命令类型；PlayStation 上报器通过 `/api/ingest/playstation` 交入原始信封，由本入口 prepare。
- `src/lag-ingest.ts`：可滞后层那一半（KV `LAG`，格式见 `shared/lag.ts`），布局变了才请状态核心失效首屏。
- `src/ingest-archive.ts`：长期归档那一半（D1 `HISTORY`），训练、圆环日读数、落地节点小时汇总、限额快照。
- `src/env.ts`：绑定与变量。

## 端点

| 方法 | 路径 | Access 权限 | 用途 |
| --- | --- | --- | --- |
| POST | `/api/ingest/<来源>` | `ingest:<来源>` | 来源清单是 `shared/ingest/prepare.ts#INGEST_SOURCES` |
| POST | `/api/ingest/agents/otlp` | `ingest:agents-otlp` 或 `ingest:mac-otlp` | Claude Code 与 Devin CLI 的内置遥测（OTLP/HTTP JSON 指标，可 gzip），按权限分来源 |
| POST | `/api/internal/site-deployed` | `internal:site-deployed` | 站点新部署接管了生产域名，见下文「部署通知」 |
| POST | `/api/internal/collector-refresh` | `internal:collector-refresh` | 立刻跑一遍采集任务，见下文「手动跑采集」 |
| GET | `/` | 无（Access 在前面挡着） | `{ ok, service: "ingest" }`，只报存活 |

其余路径一律 404。公开读取与 `/ws` 在站点域名上，由 site Worker 转交 core，都不在这里。

### 回执

回执是对上报器的契约，检查顺序就是下表从上到下：

| 状态 | 正文 | 什么时候 |
| --- | --- | --- |
| 202 | `{ ok: true, data }` | 整封收下。`data` 是状态核心各来源 commit 的回执（Mac 的 `desktopIconAvailable`、Emby 的 `missingImages`……），落地节点是 `{ id }` |
| 200 | `{}` | 只在 OTLP 路由：成功时换成 exporter 要的 ExportMetricsServiceResponse |
| 403 | `{ ok: false, error: "预览 Worker 不接收上报" }` | 预览版本（见「配置」） |
| 405 | `{ ok: false, error: "只接受 POST" }` | 方法不对 |
| 404 | `{ ok: false, error: "没有这个上报来源：<来源>" }` | 来源不认识，在鉴权之前判 |
| 401 / 403 / 503 | `{ ok: false, error }` | 没有合法的 Access JWT / 这把凭据不能写这个来源 / 暂时验不了 JWT |
| 415 | `{ ok: false, error: "不支持的压缩：<编码>" }` | 只在 OTLP 路由：`Content-Encoding` 不是 `identity` / `gzip` |
| 400 | `{ ok: false, error: "无法读取上报数据" }` | 读不出请求体（含解压失败、解压后超过 `STORAGE_MAX_BYTES`） |
| 503 | `{ ok: false, error: "状态存储暂时不可用，请重试" }` | 状态核心的 Durable Object 正在重置（发布新版本）、过载或连接断开（回执带 `retryable`，或 RPC 抛出带 `retryable` 的错）；归档与 KV 都不写，上报器整封重发 |
| 400 | `{ ok: false, error: "上报数据无效或处理失败" }` | 报文不是 JSON、校验不过、状态核心拒收、写 KV 失败 |

`mac` 与 `agents` 的 202 `data` 另带入口自己判下的两件事，两个键总在，空数组就是没有：

- `ignored`（只有 `mac`）：信封里站点不认识的模块名（包括站点不收的旧模块名），原样回给上报器；不影响别的模块。
- `rejected`：`[{ module, error }]`，三份 coding 数据（`codingUsage` / `codingActivity` / `codingTokenBuckets`，契约见
  `shared/coding-usage.ts`）里校验不过的那几份。坏的只丢它自己，原因带路径（如 `agents[0].days[2].totalTokens 小于四列之和`），
  别的模块、存活、限额照常收下，另记一行 `[ingest] rejected` 警告日志。`agents` 那封里被拒的不算「带了」：
  限额和 coding 数据一份可收的都没有时整封 400（原因只进日志）。

大小按实际读到的字节限制（`STORAGE_MAX_BYTES`），不信 `Content-Length`；超过也回 400，没有 413。
202 表示实时那一半已经在状态核心落库、可滞后层和凭据已经写完；推送与首屏失效由状态核心在自己的 `waitUntil` 里做，
归档在这边的 `waitUntil` 里做，失败只记日志，不让上报器重发。

## 鉴权

上报走 `https://ingest.homepage.lyjw.llc/api/ingest/<来源>`。这个域名整站挂在 Cloudflare Access 应用「lyjwpage ingest」后面，
策略只放行登记过的 service token：每个上报方一把（token 清单见 [仓库外事实](../../docs/ops-facts.md)），同一上报方管多个来源时共用一把，
上报器带 `CF-Access-Client-Id` / `CF-Access-Client-Secret` 两个头。
Access 在边缘核对，不对直接回 401；放行的请求带着 Access 签的 JWT（`Cf-Access-Jwt-Assertion`）到 Worker，
`src/access-auth.ts` 再验一遍签名、受众（`ACCESS_AUD`）、签发方（`ACCESS_TEAM_DOMAIN`）和时效 —— workers.dev 那条路不过 Access，
拿不出合法 JWT。验过之后按 JWT 里的 `common_name`（client id）查 `wrangler.toml` 的 `[vars.ACCESS_CLIENTS]`，只许写登记的来源，
越权回 403。新增或轮换 token 在 Zero Trust 控制台做，新 token 要加进策略，再把 client id 登记进那张表。不接受 Bearer 密钥。

## 拆分

prepare 之后，一封上报按数据层拆开（`src/worker.ts` 的 `commitIngest`）：

1. **实时那一半**先请采集 Worker 补全「正在听」：Mac 的 `appleMusic` 模块与 HomePod 的报文经 `COLLECTOR.enrichTrack`
   查 Apple 目录与动态封面（`shared/command-enrichment.ts#enrichCommand`，规则见 [collector README](../collector/README.md#apple-music)），
   补好的命令再经 Service Binding 调状态核心的 `StateCore.commitIngest(command)`（契约 `shared/state-core.ts`）。
   采集 Worker 调不通时只记一行 `[enrichment]` warn，命令不带补全原样提交，状态核心沿用同一曲目已存的补全（没有就是未补全）。
   StateHub 串行提交，回 `{ ready, ok, data | error }`；推送和首屏失效在状态核心里派发。收下之后在 `waitUntil` 里
   请采集 Worker 预热歌词、重查写入时没查出的段（`COLLECTOR.followUpTrack`）。
   落地节点（`server`）整封在可滞后层，不去状态核心。
2. **长期归档**进 D1 `HISTORY`（`src/ingest-archive.ts`），排在可滞后层之前，按自然键幂等，失败只记日志。
3. **可滞后层**直接写 KV `LAG`（`src/lag-ingest.ts`）：落地节点读数、限额、常驻上报器账本、Mac 时区、iPhone 圆环读数与训练列表。
   布局变了才失效首屏 —— 失效走 `SITE_CACHE` Service Binding，只在状态核心上，所以请它代发（`StateCore.revalidate`）。
4. **Apple Music user token**（Mac 的 `appleMusicCredentials` 模块）写凭据 KV `CREDENTIALS`，写完才回 202。

状态核心拒收时后三步都不做，回 400；它暂时不可用（Durable Object 重置、过载、连接断开）同样三步都不做，回 503 让上报器整封重发。唯一的例外是 iPhone：训练收下、圆环被拒（prepare 记下 `failure.stage = beforeActivity`，
状态核心已经落了训练区间）时，可滞后层和归档照同样的口径写训练列表，再回 400，上报器整封重发。

入口不问状态核心 `ready()`：请求体不是 JSON、校验不过都直接回 400，好报文直接提交。

### OTLP 用量：Claude Code 云端线程与 Devin CLI

这条路由按指标名认 agent：`claude_code.token.usage` / `claude_code.cost.usage` 记到 `claude`，
`devin.token.usage` 记到 `devin`（`shared/ingest/agents-otlp.ts#METRICS`），其余指标不读。

#### Claude Code 云端线程

Mac 的 ccusage 只扫本机会话记录，看不到云端线程。云端环境打开 Claude Code 内置遥测，
每分钟把指标推到 `/api/ingest/agents/otlp`。这组变量**只配在云端环境设置里**，不进仓库里 Claude Code 的
项目级 settings 文件，也不配在本机：本机会话已经由 ccusage 统计，再走遥测会重复计数。

```sh
CLAUDE_CODE_ENABLE_TELEMETRY=1
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=none
OTEL_EXPORTER_OTLP_PROTOCOL=http/json
OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative
OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=https://ingest.homepage.lyjw.llc/api/ingest/agents/otlp
OTEL_EXPORTER_OTLP_HEADERS="CF-Access-Client-Id=<ACCESS_CLIENT_ID>,CF-Access-Client-Secret=<ACCESS_CLIENT_SECRET>"
OTEL_METRIC_EXPORT_INTERVAL=60000
```

`OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative` 不能省：Claude Code 默认发 delta，状态核心不收 delta 的点
（没法去重，重发会重复计数），只记一行 `[otlp] delta temporality points skipped` 的 warn。
端点要用 `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`（原样使用）；通用的 `OTEL_EXPORTER_OTLP_ENDPOINT` 会被自动拼上 `/v1/metrics`。
只认 JSON（可 gzip），不认 protobuf；只在这条路由解压，按解压后的字节数限制大小。
鉴权要求专属 OTLP 权限，`ingest:agents` 不能写此端点，云端凭据也不能写限额或设备上报。
生产使用独立 service token `lyjwpage-claude-cloud`，已加入 `lyjwpage ingest` 应用的 Service Auth 策略，client id 登记在
`[vars.ACCESS_CLIENTS]`，仅授予 `["ingest:agents-otlp"]`；Client Secret 只放云端环境，不用配置 Worker secret。
请求头格式见 [Cloudflare service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)。
收下之后怎么记账、怎么点亮 Claude 那盏灯，见 [core README](../core/README.md#otlp-用量claude-code-云端线程与-devin-cli)。

#### OTLP：按凭据分来源

同一个入口收云端和 Mac 两边的遥测。验过 JWT 之后按这把凭据在 `[vars.ACCESS_CLIENTS]` 里持有的权限定来源：`ingest:agents-otlp`
记进 `agents-otlp`（云端环境），`ingest:mac-otlp` 记进 `mac-otlp`（Mac），两个都有时取前者（`src/worker.ts#OTLP_SOURCES`）。
payload 里的 `os.type`、`service.name` 和资源属性是客户端自报的，不用来分来源。

#### Devin CLI（Mac）

Devin CLI 的用量以前由 agents-reporter 拉 tokens.ci 的公开主页，现在由 Mac 上的 Devin CLI 自己推。Mac 的 ccusage
不统计 Devin，所以配在本机不会重复计数。Devin 只发 delta 指标，没有改成累计的开关，状态核心按窗口去重
（见 core README）。它的 `otel` 配置里没有协议项，JSON 要靠环境变量 `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`
（不设就发 protobuf，这里回 400），放进 `~/.zshenv` 这类启动 Devin 的 shell 都会读的地方。

`~/.config/devin/config.json` 里加：

```json
"otel": {
  "enabled": true,
  "metrics_endpoint": "https://ingest.homepage.lyjw.llc/api/ingest/agents/otlp",
  "headers": { "CF-Access-Client-Id": "<ACCESS_CLIENT_ID>", "CF-Access-Client-Secret": "<ACCESS_CLIENT_SECRET>" },
  "metric_export_interval_ms": 60000
}
```

`metrics_endpoint` 原样使用，不拼 `/v1/metrics`。`endpoint` 与 `logs_endpoint` 都不写：日志事件带提示词和回复原文，
不配就不发。凭据用 Mac 那把 `lyjwpage-mac`（同一上报方共用一把，`[vars.ACCESS_CLIENTS]` 里它有
`["ingest:mac", "ingest:mac-otlp"]`，用量记进 `mac-otlp`），值从 Hub 设置里的钥匙串取，配置文件权限保持 600。

#### Devin CLI（云端）

云端线程里由 Claude 调度的 Devin CLI 推到同一个入口，用云端那把 `lyjwpage-claude-cloud`，记进 `agents-otlp`，站点标 Cloud。
`~/.config/devin/config.json` 只写端点、不写 headers；鉴权头由云端环境的 Network secret 在出口代理上加（配置见 [ops-facts](../../docs/ops-facts.md#claude-code-云端-routine)）。
Claude Code 不把 `OTEL_*` 传给它运行的命令，`OTEL_EXPORTER_OTLP_PROTOCOL=http/json` 要由启动 Devin 的 wrapper 自己设。

## 部署通知

`.github/workflows/purge-esa.yml` 在 `lyjw.me` 与 `lyjw131.com` 的 `/api/version` 都答出这次部署的 sha 之后，
用 `lyjwpage-github-actions` 那把 service token（仓库 secret `ACCESS_CLIENT_ID` / `ACCESS_CLIENT_SECRET`）调
`POST https://ingest.homepage.lyjw.llc/api/internal/site-deployed`。请求体不读 —— 推什么版本由域名上那次部署自己回答。
等待途中某个域名已答出更新的提交（这次 sha 是它的祖先）时，这一次不通知，由更新那次部署自己的工作流通知（`scripts/wait-site-version.ts#waitForSiteVersion`）。

1. 请状态核心 `StateCore.broadcastVersion()` 向所有连着的页面广播不带数据的 `version` 事件，页面重问 `/api/version`
   并弹出更新提示；回执 `{ ok: true, delivered }` 里是送达的连接数。
2. 在 `waitUntil` 里请采集 Worker 按 `workers/ingress/src/worker.ts#DEPLOYMENT_JOBS` 立刻重拉部署列表与仓库统计（首页「最近提交」读后者）
   （契约 `shared/collector.ts`），不等下一次 cron；失败只记日志，不拖慢回执（工作流的 curl 只等有限时间，见 `.github/workflows/purge-esa.yml`）。

## 手动跑采集

`POST https://ingest.homepage.lyjw.llc/api/internal/collector-refresh` 不等 cron，立刻把采集 Worker 的任务各跑一次，
默认是 `shared/collector.ts#ACTIVE_COLLECTOR_JOBS` 全部（含 `digest`）；查询串带 `job=<任务>`（可重复）只跑点名的几个。
请求体不读。任务逐个串行，每个单独一次 `Collector.refresh([任务])`（经 Service Binding 触发的采集 Worker 和这次请求共用等响应头的连接额度，并发扇出会让短预算任务耗在排队上）；`digest` 排在最后，它总结的是别的任务写出的视图。全部跑完才回（`pagespeed` 最慢）：

| 状态 | 正文 | 什么时候 |
| --- | --- | --- |
| 200 | `{ ok, outcomes }` | 采集 Worker 答了。`outcomes` 是各任务的 `CollectorJobOutcome`（`shared/collector.ts`），顺序同请求；有任务 `error`（含 RPC 抛错、点名了不认识的任务）时 `ok` 为 `false` |
| 405 / 401 / 403 | `{ ok: false, error }` | 不是 POST / 没有合法的 Access JWT / 这把凭据没有 `internal:collector-refresh` |
| 503 | `{ ok: false, error: "没有绑定采集 Worker" }` | 没绑 `COLLECTOR` |
| 404 | `Not found` | 预览版本 |

任务按手动方式跑（`scheduled: false`）：不看到期，真失败照常记 error 级日志、进 Workers Issues（见[采集 Worker README](../collector/README.md)）。
权限只授给 `lyjwpage-github-actions` 那把 token，平时在 GitHub Actions 里手动运行 `.github/workflows/collector-refresh.yml`
（输入 `jobs` 留空跑全部，或填空格分隔的任务名），结果表写在那次运行的摘要里，有任务失败时运行标红。

## 配置

公开变量与绑定全在 `wrangler.toml`，没有 secret：

- `[vars]`：`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`、`[vars.ACCESS_CLIENTS]`（见「鉴权」）；`EMBY_PUBLIC_URL`（Emby 条目的
  「在 Emby 里打开」链接，prepare 时拼进条目）。
- `CORE`：状态核心的具名 entrypoint `StateCore`；`COLLECTOR`：采集 Worker 的具名 entrypoint `Collector`（补全「正在听」、部署通知后重拉）。
- `IMAGES`：上报器直传图片的 R2 桶，只 HEAD；`LAG`、`CREDENTIALS`：可滞后层与共享凭据 KV，和 core、采集 Worker 同一份；
  `HISTORY`：D1 `lyjwpage-history`，表结构归 `workers/core/migrations`，这里只写。

日志与 Issues 在 Workers Observability 的服务 `ingress` 下；`[ingest]` 拒收、`[auth]` 越权是 warn 级日志，按消息前缀查。

发布走 Cloudflare Workers Builds 原生 Git 集成：构建 `pnpm --dir workers/ingress typecheck`，部署
`pnpm --dir workers/ingress exec wrangler deploy -c wrangler.toml`，监视路径与「预览构建和非生产分支构建都关掉」的理由见
[原生部署配置](../../docs/workers-builds.md)。`CORE` 指向生产状态核心，预览版一收就写进生产；`[previews.vars]` 的
`PREVIEW_WORKER` 是最后一道闸：预览版本只会拒收（上报 403、部署通知 404）。

### 上线与域名

自定义域名 `ingest.homepage.lyjw.llc` 写在本目录的 `wrangler.toml`，core 那份不列它。Workers Builds 不是交互终端，
`wrangler deploy` 遇到挂在别的 Worker 上的自定义域名会直接接管（`override_existing_origin`），所以域名跟着这份配置走，
core 以后怎么重建都不会把它要回去。Access 应用按主机名挂，跟着域名走。

状态核心的 RPC（`ready`、`commitIngest`、`broadcastVersion`）要先于这个 Worker 接流量上线。改动契约照「只加不改」：
先加 RPC、上线，再让调用方用。

## 本地开发

`pnpm dev:worker`（仓库根目录）以多配置方式把这个 Worker 和 dev-router、core、采集 Worker 一起起在 8788；dev-router 把
`/api/ingest/*`、`/api/internal/site-deployed` 与 `/api/internal/collector-refresh` 转到这里，其余给 core。本地用 `wrangler.test.toml`：Service Binding 按生产名字
（`core`、`collector`）找到本地那两个，KV 与另外两份测试配置同 id，没有 D1（归档跳过）。

本地没有 Access：先 `node scripts/dev-access.mjs init` 生成测试钥匙（写在本目录 `.dev.vars.access-key.json`，已被 gitignore），
把它打印的 `ACCESS_DEV_JWKS=` 那一行填进本目录的 `.dev.vars`（参照 `.dev.vars.example`；wrangler 按配置文件所在目录读
`.dev.vars`，所以不是 core 那份）。推的时候带 `node scripts/dev-access.mjs header` 打出的 `Cf-Access-Jwt-Assertion` 头（10 分钟有效）：

```sh
curl -X POST http://localhost:8788/api/ingest/homepod -H "$(node scripts/dev-access.mjs header)" \
  -H 'content-type: application/json' -d '{"entityId":"media_player.local","state":"playing","title":"test"}'
```

本地测试钥匙只在 `ACCESS_TEAM_DOMAIN` 等于 `src/access-auth.ts` 的 `DEV_ACCESS_ISSUER`（一个 `.invalid` 假地址）时才被认，线上误配也不生效。

## 验证

```sh
pnpm --dir workers/ingress typecheck
pnpm --dir workers/ingress test
node scripts/verify-core-worker.mjs
```

单测覆盖鉴权与权限表、路由、回执契约、拆分（落地节点绕过状态核心、iPhone 部分收下）、OTLP gzip、部署通知的转发，
以及各来源的命令都能结构化复制。集成脚本和 `pnpm dev:worker` 一样用 dev-router 把上报路由到这个 Worker，
经 Service Binding 打隔离的 core，从上报一路验到公开读取、WebSocket 推送和首屏失效。

## Quest 实时游戏状态

Discord Gateway 上报器只交 `meta_quest` 的 Playing 快照，入口 `/api/ingest/quest`，权限 `ingest:quest`。信封为 `{ version: 1, presence: { observedAt, discordStatus, playing } }`，收敛与字段约束见 `shared/ingest/quest.ts#prepareQuestReport`。没有游戏用 `playing: null`，未知 Gateway 状态不上报；Discord 资料、关联账号不采集。实时命令交 StateCore，查询与推送见 [core Worker](../core/README.md)。
