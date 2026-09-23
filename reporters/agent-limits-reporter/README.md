# agent-limits-reporter

把各 coding agent 的**账号限额**推给 lyjwpage 的小代理，跑在日本的 misaka-jp 上。

限额（套餐 + 用量窗口）从前和 token 用量一起由 MacTelemetryHub 从本机 TokenTracker
取来、塞进 `/api/ingest/mac` 的 `vibeCodingUsage`。Mac 合盖 / 睡眠 / 离线时限额就冻住。
限额是厂商账号侧的事实，跟哪台 Mac 无关，所以拆到这个容器里 24 小时跑。

Claude、Codex、Grok、Antigravity 的用量仍由 Mac 从本机日志上报。Cursor 的用量历史在云端，Mac 合盖时云端线程还在跑，所以这份历史跟限额一起由这个容器拉，用的是同一份 `accessToken`。

站点入口是 `POST /api/ingest/agents`（按数据是谁产生的命名，不是上报程序的名字）。
每轮都 POST，内容没变也发 —— 那一封就是心跳，站点靠它刷新 `limitsAt`。

## 它做什么

启动立即采集一轮，之后按页面人数选档：可见 5 分钟、仅后台开着 10 分钟、无人打开 60 分钟。每轮：

1. 需要的话刷新 Claude 的 OAuth
2. 五家自己打各家限额接口（参考了 TokenTracker 的读取逻辑，没有依赖它）
3. 按 MacTelemetryHub `AgentLimitsCollector` 的规则翻译成站点请求体
4. POST 到站点

每轮收尾并行读 `ONLINE_COUNTER_URL/count` 与 `SITE_URL/count`：`online`（有页面**可见**）大于 0 走快档；否则
`connections`（有页面**开着**，含后台标签页）大于 0 走中档，否则走闲档。与 server /
PlayStation 上报器采用同款人数分档逻辑，限额使用自己的 5 / 10 / 60 分钟。
计数超时、非成功响应、格式错误一律当 0，不触发上报失败重试。
只配 `SITE_INGEST_URL` 不配 `SITE_URL` 时读不到人头数，固定走 60 分钟。

长档每 5 分钟重查人数，发现更快档立即采集；人数减少不延后已经定好的下一轮。
只查公开计数口，不带 ingest 密钥，也不在这些检查里访问厂商限额接口。
`SITE_URL` 使用统一 API Worker，所有连接该 Worker 的页面都计入人数。

默认发 `claude` / `codex` / `grok` / `cursor` / `antigravity`。一家失败只影响那一行。

## 配置

全部走环境变量。镜像里 `HOME=/data`，凭据落在挂卷上。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `SITE_URL` | ✅ | 上报 Worker 的源，如 `https://api.homepage.lyjw.llc`。上报端点和推送连接数的 `/count` 从它拼 |
| `SITE_INGEST_URL` | | 直接给完整端点，给了就不用 `SITE_URL` 上报；人头数仍只从 `SITE_URL` 读 |
| `TELEMETRY_INGEST_SECRET` | ✅ | 和站点同名变量对上，作 Bearer 鉴权。站点没配时才可留空 |
| `LIVE_INTERVAL_MS` | | 默认 `300000`（5 分钟），有可见页面；也是长档重查人数的间隔 |
| `OPEN_INTERVAL_MS` | | 默认 `600000`（10 分钟），只有后台页面 |
| `IDLE_INTERVAL_MS` | | 默认 `3600000`（60 分钟），无人打开；改长时同步放宽站点 `AGENT_LIMITS_STALE_MS` |
| `COUNT_TIMEOUT_MS` | | 默认 `2500`，每个计数请求的超时 |
| `CURSOR_NOW_FAST_INTERVAL_MS` | | 默认 `60000`，Cursor 在用时查最近用量事件的间隔；要小于站点灯的 5 分钟窗口 |
| `CURSOR_NOW_MAX_INTERVAL_MS` | | 默认 `240000`，没新事件时间隔翻倍拉长的上限 |
| `PUSH_TIMEOUT_MS` | | 默认 `30000` |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | | 宿主机出海要走代理时填（如 `http://user:pass@192.168.3.2:7893`）。**跑在 misaka-jp 上不用填**，那台本身就在日本。上报器自己的 fetch 靠镜像里的 `NODE_USE_ENV_PROXY=1` 认它，五个 CLI 各自也认。在墙内本地 build 时另外用 `--build-arg HTTPS_PROXY=…` |
| `CLAUDE_OAUTH_TOKEN_URL` | | 可选覆盖。默认从镜像里的 Claude Code 自动读取生产 OAuth 配置；覆盖时必须和 client ID 一起填 |
| `CLAUDE_OAUTH_CLIENT_ID` | | 同上。无需手抄；客户端常量不写进仓库 |
| `CLAUDE_BIN` | `claude` | 用来读取 OAuth 配置的 Claude Code 安装程序，可设绝对路径 |
| `AGENT_IDS` | | 逗号分隔。默认 `claude,codex,grok,cursor,antigravity` |
| `GROK_HOME` | | Grok 凭据目录，默认 `$HOME/.grok` |
| `CODEX_HOME` | | Codex 凭据目录，默认 `$HOME/.codex` |
| `CURSOR_AUTH_TOKEN` | | 直接注入 Cursor JWT。没有就读 `$XDG_CONFIG_HOME/cursor/auth.json`（默认 `/data/.config/cursor/auth.json`） |
| `ANTIGRAVITY_PLAN_LABEL` | | Antigravity 的订阅名，如 `Google AI Pro`。配额接口不带订阅（IDE 里那句来自 Windsurf 那套 language server 问 aicode.googleapis.com 的 gRPC，CLI 从不显示；`loadCodeAssist` 回的 free-tier 是 Code Assist 档位不是订阅），只能人工指定；空 = 不渲染套餐 |
| `ANTIGRAVITY_QUOTA_URL` | | 可选覆盖。默认 `https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary` |
| `ANTIGRAVITY_OAUTH_CLIENT_ID` | | 可选。不填时上报器启动会从镜像里的 `agy` 二进制扫出候选、刷新时逐对试，登录完就够。填了就直接用。**不写进仓库** |
| `ANTIGRAVITY_OAUTH_CLIENT_SECRET` | | 同上 |
| `AGY_BIN` | | 扫 OAuth 常量用的 `agy` 路径，默认 `agy`（镜像里在 `/usr/local/bin`） |
| `DRY_RUN` | | `1` 时不 POST，把请求体 JSON 打到 stdout 然后退出 |
| `LIMITS_FIXTURE` | | `{ "<id>": <该家原始 HTTP 响应体> }`。有它就不出网、不读凭据 |

## 登录

**凭据在容器里自己登录，不要拷 Mac 上那份。** 两份 refresh token 各自刷新会互相作废。

下面这些命令都在 compose 文件那一层跑（机器上是 `/opt/lyjwpage`，仓库里是 `reporters/`）。
先把卷目录建出来并交给容器里的 `node` 用户（uid 1000），不然登录时写不进去：

```bash
mkdir -p agent-limits-reporter/data && sudo chown 1000:1000 agent-limits-reporter/data
```

登录一次，凭据就在 `./data` 卷里（`/data/.claude`、`/data/.codex`、`/data/.grok`、`/data/.gemini`、`/data/.config/cursor`）。

```bash
docker compose run --rm agent-limits-reporter claude
docker compose run --rm agent-limits-reporter codex login --device-auth
docker compose run --rm agent-limits-reporter grok login --device-auth
docker compose run --rm agent-limits-reporter agy
docker compose run --rm agent-limits-reporter agent login   # cursor-agent，见下面
```

Grok 的包是 `@xai-official/grok`，命令是 `grok`，无浏览器的环境用 `--device-auth`（`--device-code` 是别名）。

`codex login` 一启动就把旧的 `auth.json` 删掉，中途取消或设备码过期等于把 codex 这份登录态弄没了，只能重登；
其余四家不受影响。设备码 15 分钟有效。

Claude 在 Linux 上把 OAuth 写到 `/data/.claude/.credentials.json`。登录后，上报器在到期前 5 分钟内的采集轮次（或 usage 接口回 401 时）自动续期并原子写回。默认从镜像中 Claude Code 的生产配置对象读取 token 端点和 client ID，不需要手抄环境变量；扫描规则按 Claude Code 2.1.261 的原生安装包验证，只接受唯一的生产配置，无法识别会明确报错。

刷新与该版本 CLI 一样使用 JSON 的 `grant_type=refresh_token`，带上凭据已有的 scopes，不请求额外权限；返回的新 access token、轮换 refresh token 和有效期会保存到原文件，保留套餐及其它顶层字段，文件权限为 `0600`。同进程的并发刷新共用一个请求。不要在上报器续期时同时运行交互式 Claude Code 登录或另一个共享同一凭据卷的实例，以免各自轮换凭据。

CLI 升级改变配置结构时，可更新扫描规则，或成对填写 `CLAUDE_OAUTH_TOKEN_URL` / `CLAUDE_OAUTH_CLIENT_ID` 暂时覆盖。日志不会输出令牌；撤销登录或 refresh token 本身失效仍需重新登录。

Codex / Grok 的 token 由上报器自己刷新写回（`auth.json`）。

## cursor / antigravity

五个 CLI 仍装进镜像，**只为登录一次**。限额运行时直打接口，不再调 `/usage`。

**cursor。** Linux 上 `agent login` 把 JWT 写到 `/data/.config/cursor/auth.json` 的 `accessToken`（也可
用 `CURSOR_AUTH_TOKEN` 直接注入）。限额打 `api2.cursor.sh` 的
`DashboardService/GetCurrentPeriodUsage`、`GetPlanInfo`、`GetHardLimit`（Connect RPC，Bearer JWT），
收成四扇窗口：`cursor.primary` 总额、`secondary` Cursor 自家模型（Auto / Composer / Cursor Grok）、
`tertiary` 其他厂商模型、`quaternary` Grok Bot 周额度。Grok Bot 只有网页接口
`https://cursor.com/api/dashboard/get-sand-usage-status`，凭据是下面那份会话 cookie；它拿不到只少这一扇。
用量历史用同一份 JWT 拼 `WorkosCursorSessionToken`，分页打
`https://cursor.com/api/dashboard/get-filtered-usage-events`，按 `Asia/Shanghai` 收成日桶。平时只拉上海时间
昨天 0 点以来的事件、整天替换这两天；每 6 小时（或换账号、账本还没全量过时）整段历史重拉一次核对，
那一次的问题和费用完整性记进账本，增量轮次沿用。
账本在数据卷的 `cursor-usage.json`（只有聚合，没有 token）。每条请求按公开 API 价估一次费用：价目跟
Mac 上的 ccusage 一样在线取 `https://models.dev/api.json`（只认官方厂商，6 小时内复用），取不到沿用上一份，
一份都没有时用编译进镜像的快照；Composer、Auto、Bugbot 这类没有公开价的记 0 并把当天标成不完整。拉失败不挡限额心跳，这一轮不带
`cursorUsage`，站点留着上一份。上报器不刷新这份 token，401 / 403 时限额那一行带
`Cursor session expired — run \`agent login\` to re-authenticate.`。

Cursor 那盏「在用」的灯（`src/cursor-now.ts`）取最新一条用量事件的时刻和模型，变了才带 `cursorNow`。
IDE、CLI、云端 agent、Bugbot / Grok Bot 都会出现在这里，不管在哪台机器上跑。闲着时不单独查，限额那一轮
拉用量时顺手看；看到 5 分钟内有事件才起快循环：有新事件就每分钟查一次最近 10 分钟，没有就 1 → 2 → 4 分钟
拉长，超过 5 分钟没新事件或没人开着页面就停，交回限额那一轮。快循环那几封只带 `cursorNow`，不带限额。

站点读出口才把这份日桶并进 Mac 的合计和年度图。旧 Mac 的合计里已经有 Cursor，锚定日按字段做差，
之后的日子整段补上；新 Mac 在用量信封里带 `omittedSources: ["cursor"]`，整份日桶另加。
所以先更新 Worker 和这个容器，再装新的 Mac 上报器。顺序反了的话，新 Mac 不再把 Cursor 算进合计，
而旧 Worker 还不认识这份日桶，Cursor 会从总数里消失，直到 Worker 更新。

**antigravity。** 登录态在 `/data/.gemini/antigravity-cli/antigravity-oauth-token`。上报器打
`daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary`（Antigravity 实际使用的后端端点）。到期前 5 分钟或接口回 401 时向
`oauth2.googleapis.com/token` 刷新并原子写回。刷新要的 client_id / client_secret 是 `agy` 二进制里的常量，
token 文件里没有，而且 `agy` 自己每次跑都只在内存里刷、不写回文件 —— 所以光读文件永远是过期的。
镜像里本来就装着 `agy`，上报器启动时把它扫一遍捞出候选（各两个，IDE 一套 CLI 一套，分不清谁配谁），
刷新时逐对试，错的那对 Google 回 401 invalid_client，试对了记在内存里。**登录完 `agy` 就够了，
不用手抄任何常量**；要跳过扫描就填 `ANTIGRAVITY_OAUTH_CLIENT_ID` / `SECRET`，仍然不进仓库。

cursor-agent（自带一个 node）和 agy 都是 glibc 二进制，alpine 加 `gcompat` 实测跑不起来（缺 `fcntl64` /
`__open`），所以运行段是 `node:24-bookworm-slim`。agy 不走它的安装脚本（脚本按 libc 选清单，musl 那份不存在），
Dockerfile 按 `linux_<arch>` 的清单自己下载、校验 sha512。装不上时 build 不会失败（`|| true`），只是那一家
登录不了，登录时看 `docker compose run` 的报错。

## DRY_RUN

不 POST，把即将发给站点的请求体打到 stdout，对照现在 `/api/status/vibecoding` 里的 limits。

用一份假的各家 HTTP 响应（不碰本机凭据）：

```bash
DRY_RUN=1 LIMITS_FIXTURE=./fixture.json HOME=/tmp/empty \
  node dist/index.js
```

`LIMITS_FIXTURE` 的形状是 `{ "<id>": <该家原始 HTTP 响应体> }`：claude 是 `/api/oauth/usage`，
codex 是 `wham/usage`，grok 是 `/v1/billing`，antigravity 是 `retrieveUserQuotaSummary`，
cursor 是 `{ period, plan, hardLimit, sand }`：三份 DashboardService 响应加 Grok Bot 那份（可省）。有它就不出网、不读凭据。

## 在 misaka-jp 上跑

部署单元是上一层的 [`reporters/compose.yaml`](../compose.yaml)，和 `server-reporter` 同一个 project：
机器上 `/opt/lyjwpage` 放 `compose.yaml`，`agent-limits-reporter/` 下只有 `.env` 和 `data/` 卷。
镜像由 [`build-reporters.yml`](../../.github/workflows/build-reporters.yml) 在 GitHub Actions 上构建
（只出 `linux/amd64`），这个目录有改动合进 main 就推 `ghcr.io/lyjw131/agent-limits-reporter:latest` 和
`sha-<短哈希>`。机器上只拉镜像，不放源码、不 build。
从前在 misaka-jp（1C2G）上现场 build 这个装了五个 CLI 的镜像，冷 build 约 10 分钟。

一个 project 里两个服务，所以**不点名服务的命令会同时动两个容器**。只动限额这个就写服务名：
`docker compose pull agent-limits-reporter && docker compose up -d --no-deps agent-limits-reporter`。

2026-09-13 从群晖（dsm `/volume3/docker`）搬到 misaka-jp `/opt/lyjwpage`，和 `server-reporter` 同一台。
这台在日本，各家限额接口直连可达，**`.env` 里不再需要 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`**。
ssh 直连在 kex 阶段会被对面关掉，一律走 dsm 跳板：`ssh -J dsm misaka-jp`。

从固定间隔升级时，先将 API Worker 的新鲜度窗口更新为
`AGENT_LIMITS_STALE_MS=11100000`（185 分钟，三轮闲档加缓存余量），删除旧的
`AGENT_LIMITS_PUSH_INTERVAL_MS`。然后更新机器上的 `.env`：删除 `PUSH_INTERVAL_MS`、
`LIVE_PUSH_URL`，并设置 `ONLINE_COUNTER_URL=https://online.homepage.lyjw.llc`；按需设置三档间隔，
再重建容器。旧变量已移除。

`compose.yaml` 改了才需要送（跳板后面 sftp 用不了，`scp` 别想，走 ssh 管道）：

```bash
ssh -J dsm misaka-jp 'mkdir -p /opt/lyjwpage/agent-limits-reporter && cat > /opt/lyjwpage/compose.yaml' < reporters/compose.yaml
```

`.env` 单独送：

```bash
ssh -J dsm misaka-jp 'cat > /opt/lyjwpage/agent-limits-reporter/.env && chmod 600 /opt/lyjwpage/agent-limits-reporter/.env' < 本机那份.env
```

先登录五家（见上），再起：

```bash
ssh -J dsm misaka-jp 'cd /opt/lyjwpage && docker compose pull agent-limits-reporter && docker compose up -d --no-deps agent-limits-reporter'
```

合进 main 之后不用再手动换：`build-reporters.yml` 推完镜像会用部署密钥 ssh 过去自动 pull 并重建这一个服务（见 `reporters/misaka-deploy.sh`）。手动换还是上面那一句。

两个上报器一起换（第一次部署、或者两边都改了）：`cd /opt/lyjwpage && docker compose pull && docker compose up -d`。
要回退就把 `compose.yaml` 里的 `latest` 临时换成 Actions 推过的 `sha-<短哈希>`。

**换机器不用重登五家**：先停掉旧机器上的容器，再把旧机器的 `data/` 卷整个打包过来、
`chown -R 1000:1000 data`，登录态照用。两边同时跑会各自轮换同一份 refresh token、互相作废，
所以顺序是「旧的停 → 拷卷 → 新的起」，旧目录等新机器验过再删。

不映射任何端口。容器只出站连站点和各家限额接口。

不进容器直接跑也行（Node ≥ 20），在这个目录：`npm run build && node dist/index.js`。

## 和 TokenTracker 的关系

参考了 TokenTracker 的读取逻辑（Claude `/api/oauth/usage`、Codex `wham/usage`、Grok billing、
以及各家 token 刷新写回），**没有把 TokenTracker 装进容器**，也没有任何 git 依赖。
限额路径只用 Node 22 自带的 `fetch`。

## 容错

- 站点或限额接口连不上都只是这一轮作废，进程不退；下一轮照常重试。
- 同一个环节连续报错只在第一次和恢复时各写一句日志，中间每满 10 次再报一次。
- 整轮采集 / 上报失败时，下一次重试是 2 秒后，连着错才逐次翻倍退到 5 分钟（跑通一次就复位）；退避期间不查人数。单家失败仍照发错误行，成功上报后按三档等下一轮。
- 某个 agent「没配」（`configured: false`）这一行不发，站点按 id 留着上一次的值。
- 「配了但取不到」发空 `limits` 加非空 `limitsError`。不要把上一次的好值再发一遍。

在线人数已恢复独立 Worker：配置 `ONLINE_COUNTER_URL=https://online.homepage.lyjw.llc`（只填源）。
其 `/count` 的 `online` 判定快档；`SITE_URL/count` 的 `connections` 判定中档。两个查询独立超时、独立降为零。
