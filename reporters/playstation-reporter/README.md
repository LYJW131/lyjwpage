# playstation-reporter

在 n100 上跑的小代理：直接探测局域网里的 PS5，按它醒着还是没醒来决定打不打 PSN，把在线状态、游玩列表和奖杯推给 lyjwpage。

站点在公网上，够不着家里的主机。采集 Worker 也在公网上，只能按「有没有人在看页面」决定打得多勤。这个容器跟 PS5 在同一个局域网里，发现包本身就知道主机醒着没有，不再问在线人数。

Home Assistant 的自动化 `lyjwpage_ps5_power` 继续在 `switch.ps5_210_power` 翻面时上报电源，卡片上的开关还是看那一份。这个容器不发 `power`。

## 节奏

发现包发到 `PS5_HOST` 的 UDP 9302（chiaki 那条 `SRCH`，协议 `00030010`）。大约每 `PROBE_INTERVAL_MS` 一次，只为了早点看见开关机，不每次都打 PSN。

| 发现结果 | 完整 tick |
| --- | --- |
| `HTTP/1.1 200`（醒着） | `AWAKE_TICK_INTERVAL_MS` |
| `HTTP/1.1 620`（休息）或连续 `OFF_STREAK_TO_REST` 次没人应答 | `IDLE_TICK_INTERVAL_MS` |

一次超时不把正在醒着的主机打进闲档。`200` 和 `620` 立刻生效。醒着和没醒对调时立刻打一轮，好接上或撤掉「正在游玩」；休息和关机是同一档，来回切不额外打。退避没到时，这些都不放行。

间隔算的是上一轮**开始**的时刻，写在打 PSN 之前。站点断流窗口 `src/lib/freshness.ts` 的 `PLAYSTATION_STALE_MS` 锚的是闲档：要放宽闲档，先改站点并部署完，再改 `src/cadence.ts` 的 `IDLE_TICK_INTERVAL_MS`。

一轮里：presence 每个完整 tick 都发（那一封是心跳）；游玩列表变了才一起带；奖杯只在目录变了才另发一封。PSN 前面的 CDN 回拒绝页或网关错误时按连败次数退避（`src/state.ts` 的 `backoffMs`），成功一轮清零。

## 配置

全部走环境变量。`.env` 不进仓库。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `SITE_INGEST_URL` | ✅ | `https://ingest.homepage.lyjw.llc/api/ingest/playstation` |
| `ACCESS_CLIENT_ID` | ✅ | 这个上报器自己的 Access service token 的 client id |
| `ACCESS_CLIENT_SECRET` | ✅ | 同一把 token 的 secret，只在控制台创建或轮换时显示一次 |
| `PS5_HOST` | ✅ | 局域网里那台 PS5 的地址。这家里的主机名是 `PS5-210`，发现包从 `192.168.100.193` 回复过 |
| `PSN_NPSSO` | | 数据卷里还没有 refresh token 时用来登录。两处不要同时拿同一串去换 |
| `DATA_DIR` | | 默认 `/data`，compose 把 `./data` 挂在这里 |
| `PSN_LANGUAGE` | | 默认 `zh-Hans` |
| `PSN_ACCOUNT_ID` | | 默认 `me` |
| `PLAYED_GAMES_LIMIT` | | 默认 `100`，最近游玩窗口 |
| `PLAYSTATION_HIDDEN_TITLE_IDS` | | 逗号分隔的 titleId，不上报。默认是三角洲行动和明日方舟：终末地 |
| `PS_DRY_RUN` | | `true` 时信封只打进日志，不 POST。PSN 照样打 |

## 切换

同一个 PSN 账号不能有两处同时在拉：refresh token 一轮一换，第二处会把第一处的登录作废。

1. 在 Zero Trust 新建 service token（建议名 `lyjwpage-playstation`），只授予 `ingest:playstation`。把 client id 写进 `workers/ingress/wrangler.toml` 的 `ACCESS_CLIENTS`。不要复用 Home Assistant 那把。
2. 含这次改动的提交进 `main` 之后，等采集 Worker 的 Workers Builds 成功，任务表里不再有 `playstation`。在那之前不要起会打 PSN 的容器。
3. 上报入口的构建也要带上新的 client id，容器才能 POST 成功。
4. 再在 n100 上起容器。没有 `PSN_NPSSO`、`data/` 里也没有登录态时，容器只探测、不打 PSN，可以先这样确认发现包。

`docs/ops-facts.md` 里「playstation 的游戏数据是采集 Worker」那一行，要等容器真的在报了再改。

## 在 n100 上跑

目录建议 `n100:/volume1/docker/playstation-reporter/`。放这份 [compose.yaml](compose.yaml) 和旁边的 `.env`，建好 `data/` 且属主是 `1026:101`（`/volume1/docker` 只给管理员组写）。非交互 shell 是 ash，Docker 在 `/usr/local/bin`。

```sh
ssh n100
# 下面在 n100 上，用 bash
export PATH="/usr/local/bin:$PATH"
cd /volume1/docker/playstation-reporter
install -d -o 1026 -g 101 data
docker compose pull
docker compose up -d
```

镜像由 [`.github/workflows/build-reporters.yml`](../../.github/workflows/build-reporters.yml) 在 GitHub Actions 上构建（只出 `linux/amd64`），这个目录有改动合进 main 就推 `ghcr.io/lyjw131/playstation-reporter:latest` 和 `sha-<短哈希>`。Actions 够不着 n100，不自动换容器。镜像还没进 GHCR 时，在 n100 上对这个目录 `docker build -t ghcr.io/lyjw131/playstation-reporter:latest .` 即可；这是一份小的 Node 镜像。不要在 misaka-jp 上 build。

`network_mode: host` 不能省：发现包要从宿主机的局域网接口发到 PS5。用户是 `1026:101`，否则写不进 `data/`。

只动这一个服务。之后每次 Actions 推了新镜像：

```sh
docker compose pull && docker compose up -d
```

回退是把 image 从 `latest` 换成 `sha-<短哈希>` 再 `up -d`。

## 验证

```sh
pnpm --filter @lyjwpage/playstation-reporter test
```

先 `tsc` 再 `node --test`。单测覆盖调频、发现包状态行、POST 信封，以及上游拒绝页的退避。
