# discord-reporter

通过 Discord Gateway 原始 `GUILD_CREATE` / `PRESENCE_UPDATE` 监听指定用户，仅上报
`platform=meta_quest` 且 `type=0` 的 Playing。`platform` 不区分 Quest 头显型号。
不采集 profile、connections，不使用 OAuth，也不向外部服务补游戏 ID 或封面。

数据链路：Gateway → `POST /api/ingest/quest` → `/api/status/quest/now` 和 `quest-now` 推送。
请求为 `{ version: 1, presence: { observedAt, discordStatus, playing } }`，`observedAt` 为 epoch 毫秒。
`playing` 为 `null` 或 `{ name, platform, details, state, startedAt, applicationId, parentApplicationId, largeImageUrl }`。
原始 ID 保留，封面 URL 仅从 Gateway `assets.large_image` 派生。

只有 Gateway ready 且已收到目标用户可信快照时才上报和发送心跳。初始未知时不报告空闲；
`GUILD_CREATE` 中没有目标 presence，只有明确包含目标 member 时才能确认 offline。
断线、重新连接或新 Gateway session 会清空快照和排队请求；恢复连接后仍需新目标快照。
提供快照的 guild 删除、不可用或明确移除目标成员时，同样撤销快照并取消排队请求。
可信观测与心跳的 `observedAt` 严格递增，同一毫秒内的不同状态也能按顺序接收。
每次心跳先用 Bot 的单目标 `GET /guilds/{guildId}/members/{userId}` 核实成员仍存在，仅检查
响应状态并丢弃资料。403/404 撤销快照；网络错误、限流或服务错误不刷新心跳，交由站点判陈旧。
检查有请求超时且不并发堆积；等待期间快照或连接变化会使检查结果失效。
HTTP 上报串行执行，等待期间只保留最新状态，断线会取消正在发送的请求。
断流的展示规则由 [shared/quest.ts](../../shared/quest.ts) 的 `QUEST_STALE_MS` 定义。

## Discord Bot

Bot 必须和目标用户在同一个服务器，并在 Developer Portal 开启 **Presence Intent**。
只请求 `Guilds` 和 `GuildPresences`。真实游戏活动依赖 Quest 的 Discord 活动分享。
`platform` 是原始 Gateway 扩展字段，因此使用 raw packet，而非 discord.js 的 Activity 对象。
Guild 快照字段见 [Discord Gateway Events](https://docs.discord.com/developers/events/gateway-events#guild-create)，
单目标核实见 [Get Guild Member](https://docs.discord.com/developers/resources/guild#get-guild-member)。
未请求 `GuildMembers`，不依赖接收成员移除事件；若收到明确移除事件，会立即撤销该来源快照。

## 配置

环境变量模板见 [.env.example](.env.example)，凭据不得提交到 Git。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DISCORD_BOT_TOKEN` | 是 | Bot token |
| `DISCORD_USER_ID` | 是 | 目标用户 snowflake |
| `ACCESS_CLIENT_ID` | 是 | 专用 Cloudflare Access service token client id |
| `ACCESS_CLIENT_SECRET` | 是 | 对应 client secret |
| `SITE_INGEST_URL` | 否 | 完整上报地址；默认值见 `src/config.ts#config` |
| `DRY_RUN` | 否 | `true` 时仅记录状态，不发 HTTP 请求 |
| `HEARTBEAT_INTERVAL_MS` | 否 | 默认值及小于陈旧窗口的校验见 `src/config.ts` |
| `PUSH_TIMEOUT_MS` | 否 | 请求超时；默认值见 `src/config.ts#config` |

## 本地验证

仓库根目录安装工作区依赖后运行：

```bash
pnpm --dir reporters/discord-reporter typecheck
pnpm --dir reporters/discord-reporter test
pnpm --dir reporters/discord-reporter build
```

单独拷出目录时用 `pnpm install --ignore-workspace --lockfile=false` 安装本地依赖。
Docker 是独立 npm 部署单元，使用本目录 `package-lock.json` 和 `npm ci`。
更新独立锁文件时，在没有 `node_modules` 的临时目录里复制 `package.json`，运行
`npm install --package-lock-only`，再复制回锁文件，避免 pnpm 软链接混入 npm 锁。

## 发布

[compose.yaml](compose.yaml) 从 GHCR 拉取镜像，保持独立 Compose project。
[Dockerfile](Dockerfile) 用于 CI 构建。镜像构建与部署入口由根目录
`.github/workflows/build-reporters.yml` 和 `reporters/misaka-deploy.sh` 管理。
远端部署位置和凭据路径以 [docs/ops-facts.md](../../docs/ops-facts.md) 为准。
接收端契约及 Access 权限先生效，再切换上报器正式发送；`DRY_RUN=true` 可验证 Gateway 快照。
