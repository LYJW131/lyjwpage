# 仓库外事实

> 类型：reference

只记不在仓库里的事实：Cloudflare、Vercel、阿里云 ESA、Sentry、GitHub 的控制台配置，Access 策略，机器与路径。仓库里查得到的事（代码、`wrangler.toml`、工作流）不在这里重复，只指到出处；与代码冲突以代码为准。

每条带「核对于 <日期>，方式：…」。「核对于 未记录」是从旧文档原样迁入、原文没写核对时间的条目，迁入时没有重新核对；其他文档里残留的同类描述，清扫时改成指向本文。改了控制台配置就来这里改对应一行，并更新核对时间。

## Cloudflare Access（Zero Trust）

| 事实 | 核对 |
| --- | --- |
| 应用「lyjwpage ingest」挂在 `ingest.homepage.lyjw.llc` 整站之前，策略只放行登记过的 service token；Worker 再验 JWT 并按 client id 限定可写来源，登记表是 `workers/ingress/wrangler.toml#ACCESS_CLIENTS`（以它为准） | 核对于 未记录，方式：迁自 `workers/ingress/README.md` |
| 每个上报方一把 token：`lyjwpage-mac`、`-iphone`、`-emby`、`-server`、`-agents`、`-home-assistant`（仅 HomePod）、`-claude-cloud`、`-github-actions`、`-playstation`、`-quest`；PlayStation 容器独立凭据只授予 `ingest:playstation`，Quest Discord 上报器独立凭据只授予 `ingest:quest` | 核对于 2026-09-30，方式：Access API 核对身份策略，Worker 来源权限按 `workers/ingress/wrangler.toml#ACCESS_CLIENTS`；PlayStation 容器上报沿用迁移核验 |
| 新增或轮换 token 在控制台做：新 token 先加进策略，再把 client id 登记进 `ACCESS_CLIENTS`；mac、iphone 轮换时在控制台重新生成 secret，再贴进 App 设置 | 核对于 2026-09-25，方式：迁自 [核验记录](./reporter-endpoints.md) |
| 原有 token 有效期到 2027-09-25，到期前在控制台续期；`lyjwpage-playstation` 与 `lyjwpage-quest` 配置为不自动到期 <!-- allow: 凭据到期日，是续期待办的锚点 --> | 核对于 2026-09-30，方式：原有 token 沿用 [核验记录](./reporter-endpoints.md)，PlayStation 与 Quest token 经 Access API 创建并核对 |
| 凭据放的位置（不记值）：server、agents 在 misaka-jp 的 `/opt/lyjwpage/<服务>/.env`（`ACCESS_CLIENT_ID` / `ACCESS_CLIENT_SECRET`）；emby 在 `dsm:/volume3/docker/emby-proxy/.env`（权限 600）；home-assistant 在 dsm 与 n100 的 Home Assistant secrets 文件（键 `lyjwpage_access_client_id` / `lyjwpage_access_client_secret`）；mac、iphone 在 App 设置里（secret 存钥匙串）；github-actions 在仓库 secret `ACCESS_CLIENT_ID` / `ACCESS_CLIENT_SECRET`；claude-cloud 只在云端环境设置里 | 核对于 2026-09-25，方式：迁自 [核验记录](./reporter-endpoints.md) 与 `workers/ingress/README.md` |

## 阿里云 ESA（`lyjw131.com`）

| 事实 | 核对 |
| --- | --- |
| 回源 `lyjw.me`，回源 Host 同为 `lyjw.me`；缓存首页 HTML 与带内容哈希的静态 JS | 核对于 未记录，方式：迁自 `docs/state-storage.md` |
| 缓存规则顺序敏感：①「PWA 核心文件绕过缓存」置首，匹配 `/sw.js`、`/offline.html`、`/manifest.webmanifest`、`/pwa/icon-192.png`、`/pwa/icon-512.png`，必须先于整站长效缓存规则；②「首页遵循源站缓存」（主机名等于本站、URI 路径等于 `/`）排在①之后，边缘按源站 `Cache-Control` 的 SWR 自行过期与后台取新（值在 `next.config.ts` 的 headers）；没有②，`/` 因没有文件后缀被判 DYNAMIC、每次回源 | 核对于 未记录，方式：迁自 `docs/telemetry-subsystems.md` 的「PWA 与边缘缓存规则」一节与 `workers/api/README.md` |
| 图片路径 `/img/*` 由 ESA 按静态后缀缓存，回源 `lyjw.me`（那边再 rewrite 到 R2 公开源）；对象带一年不可变缓存，地址即内容指纹，所以不需要主动刷新 | 核对于 未记录，方式：迁自根 `README.md` 的「图片」一节 |
| 新版本上线时 `.github/workflows/purge-esa.yml` 调 `PurgeCaches` 刷新首页 cachekey 并预热；站点 ID 与刷新 URL 见 `.github/workflows/purge-esa.yml#ESA_SITE_ID`，凭据是仓库 secret `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET`；日常上报不触发刷新 | 核对于 未记录，方式：迁自 `workers/api/README.md` |

## Vercel

| 事实 | 核对 |
| --- | --- |
| `lyjw.me` 站点在 Vercel，生产随 `main` 自动部署；预览构建把后端源改成该分支的影子 Worker，生产构建用面板里的值 | 核对于 未记录，方式：迁自 `docs/state-storage.md` 与 `docs/workers-builds.md` |
| 项目环境变量（只记名字）：`NEXT_PUBLIC_BACKEND_URL`（构建期写入前端，状态、推送、在线人数同源）、`REVALIDATE_SECRET`（只有 Worker 与 Vercel 两边有）、`R2_PUBLIC_BASE_URL`（`/img/*` rewrite 的目的地与首屏图标内联的来源，生产只配在 Vercel）、可选 `GITHUB_TOKEN`（构建期读最近提交）；参照根 `.env.example` | 核对于 未记录，方式：迁自 `docs/state-storage.md` |
| 主账号与小账号各有一个生产项目，Production 与 Preview 的 `NEXT_PUBLIC_BACKEND_URL` 都指向 API 域名 | 核对于 2026-09-07，方式：迁自 [核验记录](./reporter-endpoints.md) |

## Cloudflare 账号里的资源

| 事实 | 核对 |
| --- | --- |
| Workers：`api`（`api.homepage.lyjw.llc`）、`ingress`（`ingest.homepage.lyjw.llc`，域名写在 `workers/ingress/wrangler.toml`，一个域名只写在一份 `wrangler.toml`）、`collector`（无路由、无域名）。构建配置与监视路径见 [Workers 原生 Git 部署](./workers-builds.md) | 核对于 未记录，方式：迁自 `workers/ingress/README.md` 与 `workers/collector/README.md` |
| Durable Object 命名空间（api）：`StateHub` `08a6c22e048d4a9b915ba869ad40ffee`、`LivePushRoom` `7d366bc728244a71b06ce6cbd8267539`。它们经 transfer migration 保持 ID 与数据不变，不要对这些类另加创建或删除迁移 | 核对于 2026-09-07，方式：迁自 [核验记录](./reporter-endpoints.md) 与 `workers/api/README.md` |
| KV：`lyjwpage-lag`（binding `LAG`，可滞后层）、`lyjwpage-credentials`（`CREDENTIALS`，Apple Music user token） | 核对于 未记录，方式：迁自 `docs/state-storage.md` |
| KV：`lyjwpage-apple-cache`（binding `APPLE_CACHE`，只绑 api Worker 生产环境），命名空间 ID 是 `da83c6ece9694300b707cb87c915610c`，放 Apple 接口结果的缓存 | 核对于 2026-10-01，方式：Cloudflare API 创建并列出命名空间 <!-- allow: 核对戳 --> |
| 采集 Worker 自己的 KV `COLLECTOR_KV`，命名空间 ID 是 `0f9b584f71634776ba3bc081a7aa4498`，不保存 PSN 登录态；collector 没有 `PSN_NPSSO` secret | 核对于 2026-09-29，方式：Cloudflare API 核对 KV 中无 `auth` 键、Worker secret 列表无 PSN 项 |
| D1 `lyjwpage-history`（binding `HISTORY`）：Workers Builds 不跑迁移，部署带这个绑定的版本之前要先手动 apply，命令见 `workers/api/README.md` | 核对于 未记录，方式：迁自 `docs/state-storage.md` |
| R2 图片桶：上报器用只写该桶的访问密钥直传，上报入口以 `IMAGES` 绑定只做 HEAD；对外只以 `/img/<objectKey>` 同源路径出现 | 核对于 未记录，方式：迁自 `reporters/emby-reporter/README.md` 与 `workers/ingress/README.md` |
| Turnstile 组件「lyjwpage chat」（managed 模式，域名 `lyjw.me`、`lyjw131.com`、`localhost`），挡首页对话卡片发往 api Worker 的 `POST /api/chat`；site key 进站点环境变量 `NEXT_PUBLIC_TURNSTILE_SITE_KEY`（构建期内联），secret 是 api Worker 的 Secret `TURNSTILE_SECRET_KEY` | 核对于 2026-10-08，方式：Cloudflare API `challenges/widgets` 创建并列出 <!-- allow: 核对戳 --> |
| 首页对话的 Anthropic 用量独占 Console 工作空间 `lyjwpage-chat`（`wrkspc_01XtFZvJDphpQ4LT6X1fVQXF`），工作空间月花费上限 US$60；api Worker 的 Secret `ANTHROPIC_API_KEY` 是该空间里不过期的 key `lyjwpage-chat-prod` | 核对于 2026-10-09，方式：Claude Console 工作空间 Spend limits 页与 API keys 页 <!-- allow: 核对戳 --> |
| Workers 运行时在流式响应途中不把访客断开传给 api Worker：预览上用 HTTP/1.1 与 HTTP/2 客户端中途断开，`request.signal`（已开 `enable_request_signal`）与响应流的 `cancel()` 都没触发，`AnthropicEgress` 照样把 Anthropic 的流读到结束，这次调用到响应发完才记为 canceled；本地 workerd 会立刻传 | 核对于 2026-10-09，方式：预览部署加临时诊断日志，用 Workers Observability 查询 API 看日志，Anthropic Console 日志看 499 前的生成量 <!-- allow: 核对戳 --> |

## Sentry

| 事实 | 核对 |
| --- | --- |
| 组织的 cron 监控名额只有一个，给了 `api-minute-cron`；采集 Worker 每个任务的 `collector-<任务>` 监控随报到自动建出，因名额不足是停用状态，报到被丢弃，所以任务失败要看 `collector-worker` 项目里 tag `collector.job` 的 issue | 核对于 未记录，方式：迁自 `workers/collector/README.md` |
| 在线探测每分钟 HEAD `https://lyjw.me/api/version`，配在 Sentry 侧；站点卡片的「在线状态」读它 | 核对于 未记录，方式：迁自根 `README.md` |

## GitHub

| 事实 | 核对 |
| --- | --- |
| GitHub App `LYJW131`（slug `lyjw131`，App ID `5201294`，Client ID 写在 `.github/workflows/avatar-sync.yml`），机器人账号 `lyjw131[bot]`（用户 ID `338272049`）；权限为 Contents 读写、Issues 读写与 Metadata 只读，Webhook 关闭，只装在 `LYJW131/lyjwpage`；App 设为公开，因为私有 App 只有所有者能做用户授权，别的账号打开授权链接是 404。用户授权的回调地址登记了 `https://lyjw.me/github-callback`、`https://lyjw131.com/github-callback`、`http://localhost:3211/github-callback`（严格匹配），供首页对话让访客以自己的身份提 issue。`avatar-sync.yml`（由 collector 的 `avatar-watch` 任务触发）用它经 GraphQL `createCommitOnBranch` 往 main 提交 `.github/github-avatar.sha256`，触发 Vercel 重建以重新抓取构建期缓存的头像 | 核对于 2026-10-09，方式：GitHub App 设置页（General、Permissions、Advanced）与安装页 <!-- allow: 核对戳 --> |
| 凭据放的位置（不记值）：仓库 Actions secret `AVATAR_APP_PRIVATE_KEY`（App 私钥）；仓库 Actions variable `AVATAR_APP_ID` 存了 App ID，工作流没有使用 | 核对于 2026-10-05，方式：同上 |
| 同一 App 的 Client Secret（只有一把）在 api Worker 的 Secret `GITHUB_APP_CLIENT_SECRET`，本机另存于 `workers/api/.dev.vars`；轮换时两处一起换 | 核对于 2026-10-09，方式：GitHub App 设置页 Credentials 与 `wrangler secret list` <!-- allow: 核对戳 --> |
| collector 的 `avatar-watch` 用 fine-grained PAT `lyjwpage collector avatar-watch`（只授权 `LYJW131/lyjwpage`；Actions 读写、Contents 只读、Metadata 只读），存为 collector 的 secret `GITHUB_DISPATCH_TOKEN`，2027-10-06 到期；到期后任务每轮失败，Sentry `collector-worker` 按 tag `collector.job` 开 issue | 核对于 2026-10-05，方式：本机会话在浏览器生成后用 `wrangler secret list` 只核对名称 | <!-- allow: 令牌到期日是现状事实，不是时间线 -->
| `main` 没有分支保护和 ruleset，App 可以直接提交 | 核对于 2026-10-05，方式：`gh api` 查 `rulesets` 为空、`branches/main/protection` 返回 404 |

## 机器与部署位置

| 事实 | 核对 |
| --- | --- |
| misaka-jp（东京）：`server-reporter` 与 `agents-reporter` 两个容器在同一个 compose project，目录 `/opt/lyjwpage`（`compose.yaml`，各服务的 `.env` 与 `data/` 卷）。ssh 直连在 kex 阶段被对面关掉，一律 `ssh -J dsm misaka-jp`。合进 main 后 `.github/workflows/build-reporters.yml` 用只能执行 `/opt/lyjwpage/deploy.sh` 的部署密钥 ssh 过去换镜像（源 `reporters/misaka-deploy.sh`），密钥与地址在 GitHub environment `misaka-jp` | 核对于 2026-09-13，方式：迁自 [核验记录](./reporter-endpoints.md)、`reporters/agents-reporter/README.md` 与 `.github/workflows/build-reporters.yml` 的注释 |
| misaka-jp 上报节奏：运行中的 `agents-reporter` 按页面人数采用 5 / 10 / 60 分钟三档（`online` / `connections` / 无人），人数查询超时 2.5 秒；Cursor 活动快循环从 1 分钟退避到最多 4 分钟。运行中的 `server-reporter` 固定每 60 秒上报，推送超时 10 秒；其环境中虽有 `LIVE_INTERVAL_MS`、`OPEN_INTERVAL_MS`、`IDLE_INTERVAL_MS`，但服务配置不读取这些键 | 核对于 2026-09-30，方式：`ssh -J dsm misaka-jp` 只读检查两个运行容器的镜像、节奏变量白名单，并从容器内编译后的 `dist/config.js` 读取节奏字段；对照 `reporters/agents-reporter/src/cadence.ts` 与 `reporters/server-reporter/src/config.ts` <!-- allow: 核对戳 --> |
| dsm（群晖）：emby-reporter 在 compose 项目 `dsm:/volume3/docker/emby-proxy/`（`docker-compose.yml`），服务名 `emby-reporter`、容器名 `homepage-reporter`，`.env` 在项目根、权限 600；docker 不在群晖非交互 PATH，要写 `/usr/local/bin/docker`；Actions 够不着，服务定义使用 `build: ./homepage-reporter`，运行容器的镜像名是 `emby-proxy-emby-reporter`，并未使用 GHCR 镜像。部署到 dsm 仍需现场 build 或修改服务定义 | 核对于 2026-09-30，方式：SSH 读取 `docker-compose.yml` 的 `emby-reporter` 服务定义与 `/usr/local/bin/docker inspect homepage-reporter` 的镜像名、运行状态 <!-- allow: 核对戳 --> |
| Home Assistant：dsm 上 `dsm:/volume3/docker/homeassistant/homeassistant/`（HomePod 实体 `media_player.wo_shi`），n100 上 `n100:/volume1/docker/homeassistant/homeassistant/`（主卧立体声 HomePod mini：`media_player.zhu_wo_lyjw` 与 `media_player.zhu_wo_2_zhu_wo_2`，`rest_command.push_homepod_now_playing` 取正在播放的那一只。PS5 电源自动化与专用 `rest_command.push_ps5_power` 均不配置，主机探测由本地 `playstation-reporter` 的 UDP 探测负责）；改配置后用 `rest_command.reload` / `automation.reload` 或重启 `homeassistant` 容器 | 核对于 2026-10-06，方式：读取 n100 HA 实体与自动化，热重载后用现场播放核对选中的是正在播放的那一只；dsm 路径沿用 [核验记录](./reporter-endpoints.md) <!-- allow: 核对戳 --> |
| n100 的 HomePod 自动化 `homepod_now_playing_webhook` 监听 `media_player.zhu_wo_lyjw` 与 `media_player.zhu_wo_2_zhu_wo_2` 的曲名、循环模式与播放状态；`homepod_now_playing_heartbeat` 每分钟在任一只 `playing` 时调用 `rest_command.push_homepod_now_playing`。配置在 `n100:/volume1/docker/homeassistant/homeassistant/automations.yaml` 与 `configuration.yaml`。同曲重复播放可能上报 `repeat: all`，不能只靠换歌事件维持快照有效期 | 核对于 2026-10-06，方式：读取自动化与 rest_command 模板，`automation.reload` 与 `rest_command.reload` 后核对生产 `/api/status/listening/now` 与正在播放的那一只一致 <!-- allow: 核对戳 --> |
| 上报来源与生产实例的对应：mac 是本机 Mac Telemetry Hub，iphone 是 iPhone 17 Pro 上的 lyjwpage iOS App（`apps/ios`），server、agents 与 Quest Discord 上报器在 misaka-jp，emby 在 dsm，homepod 在两台 Home Assistant，playstation 的游戏数据由 n100 的 `playstation-reporter` 容器上报 | 核对于 2026-09-29，方式：Docker 日志首轮成功、生产 playing / trophies 时间戳与 D1 奖杯归档核对；iphone 一项核对于 2026-09-30，方式：devicectl 读回 lyjwpage 3.0.0 (8)，远程启动后生产 activity 的 pushedAt 前进 |
| n100 的 `playstation-reporter` 独立 compose 项目在 `n100:/volume1/docker/playstation-reporter/`，运行 GHCR 镜像、host 网络、UID/GID `1026:101`；PS5 地址 `192.168.100.193`，发现包回复休息状态。Access 凭据在该目录 `.env`，PSN 登录态在 `data/auth`，两者权限 600；首次从旧 KV 迁入登录态，运行时只在本地续期，不配云端 NPSSO | 核对于 2026-09-29，方式：SSH 核对 compose、文件权限、容器状态与真实 UDP 探测 |
| misaka-jp 的 Discord Gateway 上报器使用独立 compose 项目 `misaka-jp:/opt/lyjwpage/discord-reporter/`，服务名 `discord-reporter`；Bot 与 Access 凭据只存该目录 `.env`（0600），只接 Quest Playing，不读取 Discord 资料或关联账号。备份在 `misaka-jp:/opt/lyjwpage/backups/quest-restore-20260929T210550Z/` | 核对于 2026-09-30，方式：SSH 核对运行镜像 revision 与 main 提交、环境权限及 Gateway 登录；生产 Quest 端点收到真实快照，并正确反映 Discord 状态变化 |

## 待手工清理

| 事实 | 核对 |
| --- | --- |
| 已退役的 `online-counter`：控制台里的 Worker、自定义域 `online.homepage.lyjw.llc`、它的 Workers Builds 项目（不删则每次推送都留一条失败的构建）、Vercel 上的旧变量 `NEXT_PUBLIC_ONLINE_COUNTER_URL` 都待手工删除 | 核对于 未记录，方式：迁自 [核验记录](./reporter-endpoints.md) 的最后一节，迁入时是否已删未重核 |
| api Worker 上旧的 `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET` secret 与阿里云 RAM 里的专用用户已无用，两处控制台都删掉即可 | 核对于 未记录，方式：迁自 `workers/api/README.md` |
