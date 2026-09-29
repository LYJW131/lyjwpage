# 上报入口

外部上报器的唯一入口，无状态。它在 Cloudflare Access 之后验明上报器身份，读出并校验报文，按来源收敛成命令，
再按数据层拆开写：实时那一半经 Service Binding 交给状态核心（[`workers/api`](../api/README.md)），
可滞后层、长期归档和 Apple Music 凭据自己写。GitHub Actions 的部署通知也从这里进。

拆出来的理由只有一条：校验和拆分的规则经常改，而状态核心带着 Durable Object 和所有页面的 WebSocket。
改校验只发布这个 Worker，状态核心不重启、推送连接不断。

## 代码职责

- `src/index.ts`：入口，`Sentry.withSentry` 包一层；`src/worker.ts` 是全部路由、回执与拆分。
- `src/access-auth.ts`：验 Access 签的 JWT，按 `[vars.ACCESS_CLIENTS]` 查这把 service token 许不许做这件事。
- 根目录 `shared/ingest/`：各来源的 prepare（收敛、逐字段校验、Emby 的 R2 HEAD），产出能结构化复制的命令。
  状态核心只 `import type` 这里的命令类型；采集 Worker 自己组的 PlayStation 信封也过这一份。
- `src/lag-ingest.ts`：可滞后层那一半（KV `LAG`，格式见 `shared/lag.ts`），布局变了才请状态核心失效首屏。
- `src/ingest-archive.ts`：长期归档那一半（D1 `HISTORY`），训练、圆环日读数、落地节点小时汇总、限额快照。
- `src/env.ts`：绑定与变量；`src/sentry.ts`：Sentry 配置。

## 端点

| 方法 | 路径 | Access 权限 | 用途 |
| --- | --- | --- | --- |
| POST | `/api/ingest/<来源>` | `ingest:<来源>` | `mac`、`iphone`、`homepod`、`emby`、`playstation`、`server`、`agents` |
| POST | `/api/ingest/agents/otlp` | `ingest:agents-otlp` | Claude Code 云端线程的内置遥测（OTLP/HTTP JSON 指标，可 gzip） |
| POST | `/api/internal/site-deployed` | `internal:site-deployed` | 站点新部署接管了生产域名，见下文「部署通知」 |
| GET | `/` | 无（Access 在前面挡着） | `{ ok, service: "ingest" }`，只报存活 |

其余路径一律 404。公开读取、`/ws`、`/count` 都在 `api.homepage.lyjw.llc`，不在这里。

### 回执

回执是对上报器的契约，和这条路还在 api Worker 里时逐字一致，检查顺序也一样：

| 状态 | 正文 | 什么时候 |
| --- | --- | --- |
| 202 | `{ ok: true, data }` | 整封收下。`data` 是状态核心各来源 commit 的回执（Mac 的 `desktopIconAvailable`、Emby 的 `missingImages`……），落地节点是 `{ id }` |
| 200 | `{}` | 只在 OTLP 路由：成功时换成 exporter 要的 ExportMetricsServiceResponse |
| 403 | `{ ok: false, error: "预览 Worker 不接收上报" }` | 预览版本（见「配置」） |
| 405 | `{ ok: false, error: "只接受 POST" }` | 方法不对 |
| 404 | `{ ok: false, error: "没有这个上报来源：<来源>" }` | 来源不认识，在鉴权之前判 |
| 401 / 403 / 503 | `{ ok: false, error }` | 没有合法的 Access JWT / 这把凭据不能写这个来源 / 暂时验不了 JWT |
| 415 | `{ ok: false, error: "不支持的压缩：<编码>" }` | 只在 OTLP 路由：`Content-Encoding` 不是 `identity` / `gzip` |
| 400 | `{ ok: false, error: "无法读取上报数据" }` | 读不出请求体（含解压失败、解压后超过 4 MiB） |
| 503 | `{ ok: false, error: "状态存储初始化中" }` | 状态核心还没初始化；报文是 JSON 但校验不过时也先回这个（不是 JSON 直接 400） |
| 400 | `{ ok: false, error: "上报数据无效或处理失败" }` | 报文不是 JSON、校验不过、状态核心拒收或调不通、写 KV 失败 |

`mac` 与 `agents` 的 202 `data` 另带入口自己判下的两件事，两个键总在，空数组就是没有：

- `ignored`（只有 `mac`）：信封里不认识的模块名，含改名前的 `vibeCodingUsage` / `vibeCodingNow` / `vibeCodingYear`；不影响别的模块。
- `rejected`：`[{ module, error }]`，三份 coding 数据（`codingUsage` / `codingActivity` / `codingTokenBuckets`，契约见
  `shared/coding-usage.ts`）里校验不过的那几份。坏的只丢它自己，原因带路径（如 `agents[0].days[2].totalTokens 小于四列之和`），
  别的模块、存活、限额照常收下，另记一行 `[ingest] rejected` 警告进 Sentry Logs。`agents` 那封里被拒的不算「带了」：
  限额和 coding 数据一份可收的都没有时整封 400（原因只进日志）。

大小按实际读到的字节限制（`STORAGE_MAX_BYTES`，4 MiB），不信 `Content-Length`；超过也回 400，没有 413。
202 表示实时那一半已经在状态核心落库、可滞后层和凭据已经写完；推送与首屏失效由状态核心在自己的 `waitUntil` 里做，
归档在这边的 `waitUntil` 里做，失败只记日志，不让上报器重发。

## 鉴权

上报走 `https://ingest.homepage.lyjw.llc/api/ingest/<来源>`。这个域名整站挂在 Cloudflare Access 应用「lyjwpage ingest」后面，
策略只放行登记过的 service token：每个来源一把（`lyjwpage-mac`、`-iphone`、`-emby`、`-server`、`-agents`、
`-home-assistant`、`-claude-cloud`、`-github-actions`），上报器带 `CF-Access-Client-Id` / `CF-Access-Client-Secret` 两个头。
Access 在边缘核对，不对直接回 401；放行的请求带着 Access 签的 JWT（`Cf-Access-Jwt-Assertion`）到 Worker，
`src/access-auth.ts` 再验一遍签名、受众（`ACCESS_AUD`）、签发方（`ACCESS_TEAM_DOMAIN`）和时效 —— workers.dev 那条路不过 Access，
拿不出合法 JWT。验过之后按 JWT 里的 `common_name`（client id）查 `wrangler.toml` 的 `[vars.ACCESS_CLIENTS]`，只许写登记的来源，
越权回 403。新增或轮换 token 在 Zero Trust 控制台做，新 token 要加进策略，再把 client id 登记进那张表。不接受 Bearer 密钥。

## 拆分

prepare 之后，一封上报按数据层拆开（`src/worker.ts` 的 `commitIngest`）：

1. **实时那一半**经 Service Binding 调状态核心的 `StateCore.commitIngest(command)`（契约 `shared/state-core.ts`）。
   StateHub 串行提交，回 `{ ready, ok, data | error }`；推送、Apple 目录补充和首屏失效在状态核心里派发。
   落地节点（`server`）整封在可滞后层，不去状态核心。
2. **长期归档**进 D1 `HISTORY`（`src/ingest-archive.ts`），排在可滞后层之前，按自然键幂等，失败只记日志。
3. **可滞后层**直接写 KV `LAG`（`src/lag-ingest.ts`）：落地节点读数、限额、常驻上报器账本、Mac 时区、iPhone 圆环读数与训练列表。
   布局变了才失效首屏 —— 失效要 `REVALIDATE_SECRET`，只在状态核心上，所以请它代发（`StateCore.revalidate`）。
4. **Apple Music user token**（Mac 的 `appleMusicCredentials` 模块）写凭据 KV `CREDENTIALS`，写完才回 202。

状态核心拒收时后三步都不做，回 400。唯一的例外是 iPhone：训练收下、圆环被拒（prepare 记下 `failure.stage = beforeActivity`，
状态核心已经落了训练区间）时，可滞后层和归档照同样的口径写训练列表，再回 400，上报器整封重发。

校验不过时才问一次状态核心 `ready()`：未初始化回 503 的优先级高于校验 400，和从前同一个 Worker 里时一样；
请求体不是 JSON 在这之前就回 400，不问 `ready()`；好报文直接提交，由 `commitIngest` 自己判初始化。

### Claude Code 云端线程用量

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

端点要用 `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`（原样使用）；通用的 `OTEL_EXPORTER_OTLP_ENDPOINT` 会被自动拼上 `/v1/metrics`。
只认 JSON（可 gzip），不认 protobuf；只在这条路由解压，按解压后的字节数限制大小。
鉴权要求专属 `ingest:agents-otlp` 权限，`ingest:agents` 不能写此端点，云端凭据也不能写限额或设备上报。
生产使用独立 service token `lyjwpage-claude-cloud`，已加入 `lyjwpage ingest` 应用的 Service Auth 策略，client id 登记在
`[vars.ACCESS_CLIENTS]`，仅授予 `["ingest:agents-otlp"]`；Client Secret 只放云端环境，不用配置 Worker secret。
请求头格式见 [Cloudflare service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)。
收下之后怎么记账、怎么点亮 Claude 那盏灯，见 [api README](../api/README.md#claude-code-云端线程用量)。

## 部署通知

`.github/workflows/purge-esa.yml` 在 `lyjw.me` 与 `lyjw131.com` 的 `/api/version` 都答出这次部署的 sha 之后，
用 `lyjwpage-github-actions` 那把 service token（仓库 secret `ACCESS_CLIENT_ID` / `ACCESS_CLIENT_SECRET`）调
`POST https://ingest.homepage.lyjw.llc/api/internal/site-deployed`。请求体不读 —— 推什么版本由域名上那次部署自己回答。

1. 请状态核心 `StateCore.broadcastVersion()` 向所有连着的页面广播不带数据的 `version` 事件，页面重问 `/api/version`
   并弹出更新提示；回执 `{ ok: true, delivered }` 里是送达的连接数。
2. 在 `waitUntil` 里请采集 Worker `Collector.refresh(["vercel-deployments", "cloudflare-deployments"])` 立刻重拉部署列表
   （契约 `shared/collector.ts`），不等下一次 cron；失败只记日志，不拖慢回执（工作流的 curl 只等 15 秒）。

## 配置

公开变量与绑定全在 `wrangler.toml`，没有 secret：

- `[vars]`：`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`、`[vars.ACCESS_CLIENTS]`（见「鉴权」）；`EMBY_PUBLIC_URL`（Emby 条目的
  「在 Emby 里打开」链接，prepare 时拼进条目）；`SENTRY_DSN`。
- `CORE`：状态核心的具名 entrypoint `StateCore`；`COLLECTOR`：采集 Worker 的具名 entrypoint `Collector`。
- `IMAGES`：上报器直传图片的 R2 桶，只 HEAD；`LAG`、`CREDENTIALS`：可滞后层与共享凭据 KV，和 api、采集 Worker 同一份；
  `HISTORY`：D1 `lyjwpage-history`，表结构归 `workers/api/migrations`，这里只写。
- `CF_VERSION_METADATA`：Sentry 取 release（Worker 版本 ID）。

Sentry 沿用 `api-worker` 项目（同一个 DSN），每个事件带 `worker: ingress` 标签；排查上报问题在那个项目里按 `worker:ingress`
过滤。日志只收 warn / error，`[ingest]` 拒收、`[auth]` 越权原样进 Sentry Logs。

发布走 Cloudflare Workers Builds 原生 Git 集成：构建 `pnpm --dir workers/ingress typecheck`，部署
`pnpm --dir workers/ingress exec wrangler deploy`，监视路径与「预览构建和非生产分支构建都关掉」的理由见
[原生部署配置](../../docs/workers-builds.md)。`CORE` 指向生产状态核心，预览版一收就写进生产；`[previews.vars]` 的
`PREVIEW_WORKER` 是最后一道闸：预览版本只会拒收（上报 403、部署通知 404）。

### 上线与域名

自定义域名 `ingest.homepage.lyjw.llc` 写在本目录的 `wrangler.toml`，api 那份不再列它。Workers Builds 不是交互终端，
`wrangler deploy` 遇到挂在别的 Worker 上的自定义域名会直接接管（`override_existing_origin`），所以域名跟着这份配置走，
api 以后怎么重建都不会把它要回去。Access 应用按主机名挂，跟着域名走。

状态核心的 RPC（`ready`、`commitIngest`、`broadcastVersion`）要先于这个 Worker 接流量上线。改动契约照「只加不改」：
先加 RPC、上线，再让调用方用。

## 本地开发

`pnpm dev:worker`（仓库根目录）以多配置方式把这个 Worker 和 dev-router、api、采集 Worker 一起起在 8788；dev-router 把
`/api/ingest/*` 与 `/api/internal/site-deployed` 转到这里，其余给 api。本地用 `wrangler.test.toml`：Service Binding 按生产名字
（`api`、`collector`）找到本地那两个，KV 与另外两份测试配置同 id，没有 D1（归档跳过）。

本地没有 Access：先 `node scripts/dev-access.mjs init` 生成测试钥匙（写在本目录 `.dev.vars.access-key.json`，已被 gitignore），
把它打印的 `ACCESS_DEV_JWKS=` 那一行填进本目录的 `.dev.vars`（参照 `.dev.vars.example`；wrangler 按配置文件所在目录读
`.dev.vars`，所以不是 api 那份）。推的时候带 `node scripts/dev-access.mjs header` 打出的 `Cf-Access-Jwt-Assertion` 头（10 分钟有效）：

```sh
curl -X POST http://localhost:8788/api/ingest/homepod -H "$(node scripts/dev-access.mjs header)" \
  -H 'content-type: application/json' -d '{"entityId":"media_player.local","state":"playing","title":"test"}'
```

本地测试钥匙只在 `ACCESS_TEAM_DOMAIN` 是 `https://access.local.invalid` 时才被认，线上误配也不生效。

## 验证

```sh
pnpm --dir workers/ingress typecheck
pnpm --dir workers/ingress test
node scripts/verify-api-worker.mjs
```

单测覆盖鉴权与权限表、路由、回执契约、拆分（落地节点绕过状态核心、iPhone 部分收下）、OTLP gzip、部署通知的转发，
以及各来源的命令都能结构化复制。集成脚本和 `pnpm dev:worker` 一样用 dev-router 把上报路由到这个 Worker，
经 Service Binding 打隔离的 api，从上报一路验到公开读取、WebSocket 推送和首屏失效。
