# reporters/playstation-reporter

在 n100 上探测局域网里的 PS5，按它醒着还是没醒来打 PSN，把 presence、游玩列表和奖杯 POST 到站点。配置、切换顺序和部署命令在 `README.md`。

## 不变量

- PSN 的 refresh token 每次续期都会轮换。同一个账号只能有一处在跑：采集 Worker 的构建里还含着 `playstation` 任务时不要起这个容器；换机器时先停旧的，再拷 `data/`，最后起新的。重新生成 NPSSO 会作废上一串，也不要从 PlayStation 网站登出。
- 调频只看发现包（UDP 9302，`src/probe.ts`）：`200` 醒着按 `src/cadence.ts#AWAKE_TICK_INTERVAL_MS`，`620` 或连续探测不到按 `src/cadence.ts#IDLE_TICK_INTERVAL_MS`。不读在线人数，不读 Home Assistant 的电源。醒着和没醒对调时立刻打一轮，退避仍然优先。一次超时不把醒着的主机打进闲档（`OFF_STREAK_TO_REST`）。
- `src/cadence.ts#IDLE_TICK_INTERVAL_MS` ⇄ 站点 `src/lib/freshness.ts#PLAYSTATION_STALE_MS`：要放宽闲档，先改站点窗口并部署完，再改这边。
- 电源展示仍由 Home Assistant 的自动化 `lyjwpage_ps5_power` 上报。这个容器不发 `power`。
- 上报鉴权是单独一把 Access service token（`ACCESS_CLIENT_ID` / `ACCESS_CLIENT_SECRET`），只在控制台创建或轮换时显示一次；`.env` 不进仓库。client id 登记进 `workers/ingress/wrangler.toml#ACCESS_CLIENTS`，权限只有 `ingest:playstation`。
- 原始信封 POST 到 `/api/ingest/playstation`，收敛在 `shared/ingest/playstation.ts`。奖杯进 D1 由 api 在收下之后做（`workers/api/src/stores/trophy-history.ts#archiveTrophies`），容器里不写。
- 依赖站点新契约的改动，先确认站点与 Worker 已生效，再换容器（根 `AGENTS.md`「部署流程」）。

## 部署

- 镜像由 `.github/workflows/build-reporters.yml` 构建，只出 `linux/amd64`。合进 main 后推 GHCR，不自动换容器：n100 够不着 Actions，按 `README.md` 手动拉。
- `network_mode: host`，否则发现包到不了 PS5。容器用户 `1026:101`，`./data` 要可写。
- 不在 misaka-jp 上 build。

## 验证

- `pnpm --filter @lyjwpage/playstation-reporter test`（先 `tsc` 再 `node --test`）。
- `PS_DRY_RUN=true` 时信封只打日志、不 POST，PSN 照样打。没有 `PSN_NPSSO`、数据卷里也没有登录态时，这一轮跳过，不打 PSN。
