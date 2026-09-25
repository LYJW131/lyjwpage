# 生产上报端点核验

2026-09-07（UTC+8）核验。统一源为 `https://api.homepage.lyjw.llc`，生产 Worker 名为 `api`。
所有七个来源均在新 Worker 日志中确认真实 POST 返回 202；HomePod 的两个实例还分别检查了 Home Assistant 动作回执。

| 来源 | 当前实例 | 路径 | 结果 |
| --- | --- | --- | --- |
| Mac | 本机 Mac Telemetry Hub | `/api/ingest/mac` | 设置已保存；连续真实上报 202 |
| server | `ssh -J dsm misaka-jp`，容器 `server-reporter` | `/api/ingest/server` | 配置已更新、容器 Up；真实上报 202（2026-09-13 从 systemd 改成 Docker，见下） |
| Emby | `ssh dsm`，容器 `homepage-reporter` | `/api/ingest/emby` | 容器已应用新配置；真实上报 202 |
| agents | `ssh -J dsm misaka-jp`，容器 `agents-reporter` | `/api/ingest/agents` | 容器已应用新配置；真实上报 202（2026-09-13 从 dsm 迁到 misaka-jp，见下） |
| PlayStation | Worker `playstation-reporter` | `/api/ingest/playstation` | `SITE_URL` 已更新并部署；真实上报 202 |
| PlayStation 电源 | `ssh n100`，Home Assistant 自动化 `lyjwpage_ps5_power` | `/api/ingest/playstation` | 2026-09-13 新增；`switch.ps5_210_power` 翻面即上报，真实上报已落地 |
| HomePod | `ssh dsm`，Home Assistant `media_player.wo_shi` | `/api/ingest/homepod` | 配置检查通过；真实 rest_command 返回 202 |
| HomePod | `ssh n100`，Home Assistant `media_player.zhu_wo_lyjw` | `/api/ingest/homepod` | 配置检查通过；真实 rest_command 返回 202 |
| iPhone | iPhone 17 Pro，遥测中心 | `/api/ingest/iphone` | 用户修改设置；App 显示成功，新 Worker 收到 202 |

两台 Home Assistant 已重启应用配置；验证只调用 `rest_command.push_homepod_now_playing` 上报当前实况，没有控制 HomePod 播放，也没有发送合成数据。
iPhone 最新活动数据已在生产主页显示为活动 334 / 270 千卡、锻炼 25 / 30 分钟、站立 8 / 10 小时（核验时快照）。

## 站点与持久化

主账号 Vercel 和小账号生产 Vercel 的 Production / Preview `NEXT_PUBLIC_BACKEND_URL` 均为新域名。
`lyjw.me` 的浏览器状态查询直连新 API，`/ws`、`/online/ws` 均握手 101。
Worker 的三个 SQLite Durable Object 命名空间通过 transfer migration 迁移，ID 和数据保持不变：

| 类 | 命名空间 ID |
| --- | --- |
| LivePushRoom | `7d366bc728244a71b06ce6cbd8267539` |
| OnlineCounterRoom | `1aa4f5ed35f14a258005da8583342661` |
| StateHub | `08a6c22e048d4a9b915ba869ad40ffee` |

生产使用 Vercel / Workers；腾讯云 EdgeOne 部署已退役。

## 配置备份

每份远端配置修改前均保留原文件权限与时间戳备份，后缀为 `.before-api-20260907`。

| 主机 | 原路径 | 应用命令 |
| --- | --- | --- |
| misaka-jp | `/opt/lyjwpage/agents-reporter/.env` | `cd /opt/lyjwpage && docker compose up -d --no-deps --no-build agents-reporter` |
| dsm | `/volume3/docker/emby-proxy/.env` | `/usr/local/bin/docker compose -f /volume3/docker/emby-proxy/docker-compose.yml up -d --no-deps --no-build emby-reporter` |
| dsm | `/volume3/docker/homeassistant/homeassistant/configuration.yaml` | Home Assistant 的 `rest_command.reload` 动作，或重启 `homeassistant` 容器 |
| n100 | `/volume1/docker/homeassistant/homeassistant/configuration.yaml` | Home Assistant 的 `rest_command.reload` 动作，或重启 `homeassistant` 容器 |
| n100 | `/volume1/docker/homeassistant/homeassistant/automations.yaml` | Home Assistant 的 `automation.reload` 动作；备份后缀 `.before-ps5power-20260913` |
| misaka-jp | `/opt/lyjwpage/server-reporter/.env` | `cd /opt/lyjwpage && docker compose up -d --no-deps --no-build server-reporter` |

备份路径是原路径加上述后缀。原 Worker / 域名退役后，不要单独恢复备份中的旧目的地；如需整体回滚，先恢复后端域名与服务，再切换调用方。

## 2026-09-09 在线人数拆分

`online-counter` 已恢复独立域名 `https://online.homepage.lyjw.llc`：
浏览器通过 `NEXT_PUBLIC_ONLINE_COUNTER_URL` 连接 `/ws`，公开 `/count` 返回 `{ ok, online }`。
API 的 `/count` 只保留 `{ ok, connections }`，旧 `/online/ws` 删除。
原 API 在线计数命名空间通过 `v2-split-online-counter` 删除；其余业务数据命名空间保留。

server、PlayStation 和 agent limits 新增 `ONLINE_COUNTER_URL`，并行读取两个来源的计数，
单端失败仅将该端计数降为零。三档间隔不变。

远端本次备份后缀为 `.before-online-20260909`：
NAS 备份 `src/cadence.ts`、`src/config.ts`、`compose.yaml`、`.env`；
server 备份 `.env`（代码随镜像走，回退改 `sha-<短哈希>` 标签）。回滚须与 API 旧计数契约整体恢复，不能只撤掉在线域名配置。

## 2026-09-25 上报鉴权迁到 Cloudflare Access

共用的 `TELEMETRY_INGEST_SECRET` 退役。上报一律走 `https://ingest.homepage.lyjw.llc/api/ingest/<来源>`，
每个来源一把 Access service token，Worker 按 `[vars.ACCESS_CLIENTS]` 限定可写来源（见 `workers/api/src/access-auth.ts`）。

| 来源 | 凭据 | 放在哪 |
| --- | --- | --- |
| server、agents | `lyjwpage-server`、`lyjwpage-agents` | misaka-jp `/opt/lyjwpage/<服务>/.env` 的 `SITE_INGEST_URL` / `ACCESS_CLIENT_ID` / `ACCESS_CLIENT_SECRET` |
| emby | `lyjwpage-emby` | dsm `/volume3/docker/emby-proxy/.env`（600），`docker-compose.yml` 里 emby-reporter 引用这三个变量 |
| HomePod、PS5 电源 | `lyjwpage-home-assistant` | dsm 与 n100 的 Home Assistant `secrets.yaml`：`lyjwpage_access_client_id` / `lyjwpage_access_client_secret` |
| mac、iphone | `lyjwpage-mac`、`lyjwpage-iphone` | App 里「登录 Cloudflare 获取上报凭据」配对取得（`docs/reporter-pairing.md`），存钥匙串 |
| 部署通知 | `lyjwpage-github-actions` | 仓库 secret `ACCESS_CLIENT_ID` / `ACCESS_CLIENT_SECRET` |
| playstation | 无 | playstation-reporter 经 Service Binding 调 `PlaystationIngest` |

远端改动前的备份后缀为 `.before-access-<时间戳>`。token 有效期到 2027-09-25，续期或轮换在 Zero Trust 控制台做；
轮换 mac / iphone 直接在 App 里重新登录。
