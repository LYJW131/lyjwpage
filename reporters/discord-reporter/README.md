# discord-reporter

监听指定 Discord 用户的 `meta_quest` Playing，只在首页 Quest 3 卡显示。
PS4、PS5、桌面活动和离线状态不会显示为正在玩；PlayStation 卡沿用自己的上报器。
`meta_quest` 本身不区分头显型号，Quest 3 是这位用户的设备标签。

数据链路：Discord Gateway → `POST <API_WORKER_URL>/api/ingest/discord` →
API Worker / SQLite → `/api/status/discord`、`/api/home.discord` 和 `discord` 推送。
上报版本是 `{ version: 1, presence: { observedAt, discordStatus, playing } }`。
`playing` 为 `null` 或 Quest 游戏；仅变化推送事件，每分钟心跳落库，5 分钟断流显示不可用。
乱序上报不会覆盖新状态；封面解析和上报串行，快速切游戏保留最新活动。

## Discord Bot

Bot 必须和目标用户在同一个服务器，在 Developer Portal 开启 **Presence Intent**。
只需要 `Guilds` 和 `GuildPresences`，不需要消息内容权限。
真实显示还依赖 Quest 的 Discord 活动分享；没有活动与上报器断流是两个状态。

## 为什么非得是个常驻进程

Discord 没有 REST「读我正在玩」。要听 `PRESENCE_UPDATE` 就得挂在 Gateway 上。
Cloudflare cron Worker 15 分钟醒一次会漏掉开关游戏。

## 它做什么

| 内容 | 节奏 | 什么时候真的推 |
| --- | --- | --- |
| 过滤后的正在游戏（含明确没在玩） | 事件驱动；另外每 60 秒心跳 | 内容有变化时；心跳每轮都发，站点靠 `observedAt` 判死活 |

桌面客户端把 Cursor 标成 Playing 的那些，`platform` 不是 `meta_quest`，会被丢掉。

## 配置

全部走环境变量。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DRY_RUN` | | `true` 时采集并记录状态，不向 Worker 发请求；默认 `false` |
| `DISCORD_BOT_TOKEN` | ✅ | 开发者后台 Bot 令牌。只进这台机器的 `.env` |
| `DISCORD_USER_ID` | ✅ | 要盯的那个 Discord 用户 snowflake |
| `SITE_URL` | 未配 `SITE_INGEST_URL` 时 | API Worker 地址（不是 Vercel 站点）。端点路径由上报器拼 |
| `SITE_INGEST_URL` | | 直接给完整端点，给了就不用 `SITE_URL` |
| `TELEMETRY_INGEST_SECRET` | ✅ | 和 API Worker 同名变量一致，必须配置，作 Bearer 鉴权 |
| `HEARTBEAT_INTERVAL_MS` | | 默认 `60000`。须小于固定的 5 分钟陈旧窗口，建议保持默认 |
| `PUSH_TIMEOUT_MS` | | 默认 `15000` |

## 使用 Docker Compose 部署

部署单元是同目录的 [compose.yaml](compose.yaml)：把这个目录整个拷到要跑它的机器上、
旁边放一份 `.env`，就地 build。**别在 Mac 上 build 完把镜像拷过去** —— 两端的
CPU 架构可能不同。

它没有任何入站接口，不开端口，跑在哪台机器上都行——只要出得了网、够得着 API Worker 和
Discord Gateway。

部署到 `misaka-jp`，构建和启动都在目标服务器执行：

```bash
COPYFILE_DISABLE=1 tar czf - -C reporters --exclude node_modules --exclude dist --exclude .env --exclude data discord-reporter | ssh misaka-jp 'mkdir -p /opt/lyjwpage && tar xzf - -C /opt/lyjwpage'
```

`.env` 单独送，别混进源码目录一起打包：

```bash
ssh misaka-jp 'umask 077; cat > /opt/lyjwpage/discord-reporter/.env' < 本机那份.env
ssh misaka-jp 'cd /opt/lyjwpage/discord-reporter && docker compose up -d --build discord-reporter'
```

本目录是独立 npm 部署单元，保留自己的 `package-lock.json`。重生成时必须在没有
`node_modules` 的干净状态运行 `npm install --package-lock-only`，否则根工作区的 pnpm
软链可能被写进锁文件，容器里的 `npm ci` 无法复现。

本地验证：

```bash
pnpm install
pnpm --dir reporters/discord-reporter typecheck
pnpm --dir reporters/discord-reporter test
pnpm --dir reporters/discord-reporter build
```

## 本地预览

本地启动 API Worker 和站点后：

```bash
pnpm dev:override /api/status/discord discord-quest.json
```

示例是明确标注的模拟数据。使用站点右下角 Fake data 开关切回真实状态。
新 Worker 契约先上线，再部署本目录的常驻进程；仅部署站点不会自动启动 Bot。

当前部署目标为 `misaka-jp`，目录 `/opt/lyjwpage/discord-reporter`。接收端上线前使用 `DRY_RUN=true` 验证 Gateway；切换正式上报时设置 `DRY_RUN=false` 并重新创建该服务。

Discord 状态包含公开 `profile`（`id`、`username`、`displayName`、`avatarUrl`），由 Bot 每五分钟刷新，失败时保留最近成功的数据并在一分钟后重试。空闲时展示头像、名字与 Discord 个人资料链接；账号资料变化也触发状态推送。


## 关联账号授权

关联账号来自 Discord OAuth2 `identify connections`，只上报 `visibility=1` 且未撤销的条目，字段仅为 `type`、`id`、`name`。读取失败时清空连接；不会输出令牌或私有连接。游戏状态继续来自 Bot Gateway。

在 Discord Developer Portal 的 OAuth2 页面注册 `http://127.0.0.1:3236/callback`。在本目录创建已忽略的 `data/oauth-client.json`（权限 0600）：

```json
{"clientId":"YOUR_APPLICATION_ID","clientSecret":"YOUR_CLIENT_SECRET"}
```

然后在本目录运行 `DISCORD_USER_ID=YOUR_USER_ID node scripts/authorize.mjs`，打开 `data/authorize-url.txt` 中的地址并授权。脚本验证 state 和账号 ID，把令牌原子写入 `data/oauth-token.json`。回调仅监听本机，15 分钟后停止。

部署时单独安全传输 `data/oauth-client.json` 和 `data/oauth-token.json`，不要放入源码包或 Git。让 Docker 的 node 用户（uid 1000）拥有 data 目录，目录权限 0700、文件 0600；设置 `DISCORD_OAUTH_DIR=/app/data` 后启动 Compose。刷新令牌会持久化回该卷。不要同时在多台上报器上使用同一套刷新令牌；迁机先停止旧实例，再复制最新 data。
