# playstation-reporter

把 PSN 的「此刻在玩」和「最近在玩」推给 lyjwpage 的小代理。

> ## ⚠️ 这是原型，**从没用真实凭据跑过**
>
> 写这份东西时手上没有、也不需要任何 PSN 账号。所以：
>
> - **所有对索尼端点的调用都未经验证。** 端点地址、OAuth 常量、GraphQL 之外那两个
>   REST 端点的响应字段，全部原样抄自 [`psn-api@2.18.1`](https://github.com/achievements-app/psn-api)（MIT）
>   的源码和类型声明，逐条标了出处；抄得对不对、索尼今天是不是还这么答，没人试过。
> - **站点侧的 `/api/ingest/playstation` 还不存在。** 下面那份信封是给它写的**契约草案**，
>   不是已经实现的接口。所以这份上报器的主形态是 **dry-run**：不配站点地址就把本该
>   POST 的信封打到 stdout。
> - 下面出现的所有信封样例和报错样例，要么来自**模拟上游响应**（把 `fetch` 换掉、
>   喂进索尼形状的假数据），要么来自不出网的本地路径。凡是标了「模拟」的，就不是实测。
> - **真推那条路一次都没走过**：所有验证都跑在 dry-run 下，配了站点地址时的那个
>   POST 分支（Bearer 头、回执解析）没有执行过，连打给假站点都没有 —— 端点还不存在，
>   而 `readEnvelope` 是从另外两份上报器一字不差拷来的，为它现造一个桩没有意义。
>
> 真接上去之前，至少要把这几件事验一遍：换码那一步的实际状态码和 `Location` 形状、
> 两个业务端点的真实字段、`playDuration` 有没有超出 `PTxHxMxS` 的写法。

## 它做两件事

| 内容 | 节奏 | 什么时候真的推 |
| --- | --- | --- |
| 此刻在线 / 在玩什么（`…/users/:accountId/basicPresences?type=primary`） | 30 秒一轮 | **翻面**才推 —— 开始玩、换游戏、下线 |
| 玩过哪些、各玩了多久（`…/users/:accountId/titles`） | 5 分钟一轮 | 列表内容有变化时；另外每 10 分钟兜底整推一次 |

「变了才推 + 定时兜底整推」是这个仓库里两张列表的既定模式（见根 README 的「状态是
怎么接的」）：站点将来在 Vercel 上是按调用计费的函数，而它那边的 Redis 可能被清空、
也可能因为部署换了库，只靠「有变化才推」会空在那儿等一个永远不来的变化。

判「变没变」的指纹里**不含 `observedAt`** —— 那个每轮都在变，含进去等于每轮都推一次。

**规范化全在这一侧做完**（AGENTS.md 第 4 条）：ISO 时间戳换成 epoch 毫秒、
`PT228H56M33S` 那种 ISO-8601 时长换成毫秒、上游大小写不一的平台名（同一个字段里
PS4 写作 `"ps4"` 而 PS5 写作 `"PS5"`）统一成大写。站点收到的应该是一份可以直接
落库的东西，而不是又一种要它去猜的方言。

## 先跑一次 `--once`

冒烟测试，也是唯一一条「不配任何东西也有意义」的命令：

```bash
npm install && npm run build
node dist/index.js --once
```

什么都没配时它应当以**这条**报错退出（退出码 1，实跑确认过）：

```text
2026-08-24T19:24:37.350Z playstation-reporter 启动（--once）
2026-08-24T19:24:37.352Z 没配 SITE_URL / SITE_INGEST_URL，进 dry-run：信封只打到 stdout。（站点侧的 /api/ingest/playstation 目前也还不存在）
2026-08-24T19:24:37.352Z [启动] 缺少环境变量 PSN_NPSSO（状态文件 ./state/auth.json 里也没有还能用的 refresh token）。
  · 去 https://ca.account.sony.com/api/v1/ssocookie 取一串 NPSSO（要先在 playstation.com 登录），填进 PSN_NPSSO
  · 别从 PlayStation 网站登出 —— 登出会让已经发出去的 token 在七天内软失效
  · 重新生成 NPSSO 会**立刻**作废上一串，所以别在两处同时用同一个账号换码
```

配上 NPSSO 之后 `--once` 会认证一次、两个端点各拉一次、把信封打出来，然后退出。

## 怎么拿 NPSSO

PSN 没有给第三方的正经授权流程，只能借浏览器里那个 cookie 起头：

1. 用浏览器登录 <https://www.playstation.com>；
2. **同一个浏览器**里访问 <https://ca.account.sony.com/api/v1/ssocookie>；
3. 页面会回一小段 JSON：`{"npsso":"<64 位左右的一串>"}`，把 `npsso` 的值填进 `PSN_NPSSO`。

（这个地址和这条路径出自 `psn-api@2.18.1 src/authenticate/exchangeNpssoForAccessCode.ts`
的 JSDoc。上报器**不**替你去开浏览器，那串得手工取。）

### 两条运维警告

- **别从 PlayStation 网站登出。** 登出会让已经发出去的 token 在**七天内软失效** ——
  症状是上报器某天忽然开始报 401，而 NPSSO 那串看着还好好的。要退出登录就直接关标签页。
- **重新生成 NPSSO 会立刻作废上一串。** 所以别在两个地方同时拿同一个账号换码
  （比如这份上报器和某个 trophy 脚本），后换的那边会把先换的踢掉，两边轮流掉线。

拿到之后 NPSSO 本身就没用了：换出来的 refresh token 活约两个月，上报器一直用它续，
状态文件在（见下）就不用再管这串。

## 配置

全部走环境变量。**站点那三个是选填的** —— 不配就是 dry-run，这是原型现在的常态。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `PSN_NPSSO` | ⚠️ | 上面那串。状态文件里已有没过期的 refresh token 时可以不填；两样都没有就启动即退出 |
| `PSN_ACCOUNT_ID` | | 默认 `me`，PSN 给「本次鉴权的那个账号」留的字面量，不用先去查自己的 accountId |
| `PSN_STATE_FILE` | | 默认 `./state/auth.json`。token 状态文件，**0600**，进 `.gitignore` |
| `PLAYED_GAMES_LIMIT` | | 默认 `20`，一次拉多少条已玩记录 |
| `SITE_URL` | | 站点地址，如 `https://lyjw131.com`。端点路径由上报器自己拼成 `/api/ingest/playstation` |
| `SITE_INGEST_URL` | | 直接给完整端点，给了就不用 `SITE_URL` |
| `TELEMETRY_INGEST_SECRET` | | 和站点同名变量对上，作 Bearer 鉴权。站点没配时才可留空 |
| `PRESENCE_INTERVAL_MS` | | 默认 `30000` |
| `PLAYED_GAMES_INTERVAL_MS` | | 默认 `300000` |
| `FULL_PUSH_INTERVAL_MS` | | 默认 `600000`，没变化也兜底整推的间隔 |
| `RETRY_MS` | | 默认 `15000`，出错后第一次重试的间隔，之后每连错一次翻倍 |
| `MAX_RETRY_MS` | | 默认 `600000`，退避封顶 |
| `REQUEST_TIMEOUT_MS` | | 默认 `10000`，问 PSN 用 |
| `PUSH_TIMEOUT_MS` | | 默认 `15000`，推站点用 |

变量名跟两个邻居走（`SITE_URL` / `SITE_INGEST_URL` / `TELEMETRY_INGEST_SECRET`），
不另起一套 —— 三份上报器将来会摆在同一台 NAS 上、共用同一份 `.env` 习惯。

### token 状态文件

`PSN_STATE_FILE` 指的那份 JSON 里是**明文的 access / refresh token**，所以：

- 以 **0600** 写入，所在目录 0700；写法是「先写 `.tmp` 再 `rename`」，rename 是原子的，
  进程写到一半被 docker 干掉不会留下半份 JSON 把下次启动坑死；
- `state/` 进同目录的 `.gitignore` 和 `.dockerignore`；
- **任何日志都不打印 token 内容**，拿到新 token 时只说到期时刻；上游报错时只带状态码
  和截断到 200 字的正文。换码那一步的 `Location` 头也不进日志 —— 那一串就是 access code。

重启后先试状态文件里的 refresh token，被上游拒了才退回 NPSSO 重来一遍。
**续期看半衰期**：过了「签发 → 到期」的中点就换新的，和 `workers/musickit-token`
那份 `pastHalfLife` 同一条规则、同一个理由 —— 寿命不由上游承诺（access token 约一小时、
refresh 约两个月都是观测值不是合同），写死一个提前量在两个方向上都可能错。

## 信封契约草案

> **站点侧尚未实现。** 下面是给将来那个 `POST /api/ingest/playstation` 写的草案。
> 端点按 AGENTS.md 第 1 条命名：`/api/ingest/<来源>` 里的来源是「数据是谁产生的」，
> 所以是 `playstation` 而不是 `playstation-reporter` —— 哪天换个代理程序，端点不用跟着改。

```text
POST /api/ingest/playstation
Authorization: Bearer <TELEMETRY_INGEST_SECRET>
Content-Type: application/json
```

两部分**各自可省**，因为两路轮询节奏不同（30 秒 / 5 分钟），各推各的；这一点和
emby 那份的 `resume` / `playing` / `images` 是同一个模式：缺席表示「这次不谈这一项」。
每部分自带 `observedAt`，不放在信封顶层 —— 两部分是在不同时刻观测到的，共用一个
时间戳就是把其中一个说谎地说新了。

```jsonc
{
  "version": 1,          // 信封版本，改形状时站点据此区分
  "presence": {
    "observedAt": 1787599316815,   // epoch 毫秒，下同
    "online": true,
    "availability": "availableToPlay",  // 上游原词，另一个值是 unavailable
    "platform": "PS5",                  // 统一大写
    "lastOnlineAt": 1685827528987,
    "playing": {                        // 没在玩就是 null
      "titleId": "PPSA01521_00",
      "title": "Horizon Forbidden West",
      "format": "PS5",
      "launchPlatform": "PS5",
      "iconUrl": "https://image.api.playstation.com/vulcan/ap/rnd/…png"
    }
  },
  "playedGames": {
    "observedAt": 1787599316816,
    "items": [
      {
        "titleId": "PPSA01521_00",
        "name": "Horizon Forbidden West",
        "category": "ps5_native_game",  // 上游原词：ps4_game / ps5_native_game / pspc_game / unknown
        "playCount": 100,
        "firstPlayedAt": 1436557219000,
        "lastPlayedAt": 1722713307120,
        "playDurationMs": 824193000,    // 上游那串 "PT228H56M33S" 换算来的
        "imageUrl": "https://image.api.playstation.com/vulcan/ap/rnd/…png"
      }
    ]
  }
}
```

（这份样例是**模拟上游响应**跑出来的 dry-run 输出：把 `fetch` 换成返回索尼形状假数据的
函数，假数据的字段和示例值取自 `psn-api@2.18.1` 的 `dist/index.d.ts` 里那些 `@example`
注释。它验证的是我们这侧的规范化，不是索尼真会这么答。）

站点将来实现它时，几件已经定下来的事：

- 回执按仓库惯例是 `{ ok: true, data: { changed } }`，`ok !== true` 一律算失败
  （三份上报器共用的 `readEnvelope` 就是这条约定，见 `src/site.ts` 的注释）；
- 读路径按 AGENTS.md 第 2 条成对加：`/api/status/playing` 是列表、`/api/status/playing/now`
  是此刻，推送事件名跟着写成 `playing` 和 `playing-now`；
- **图先不落 R2。** `iconUrl` / `imageUrl` 是 `image.api.playstation.com` 上的公开地址，
  原样透传，和 Apple Music 封面走 `mzstatic.com` 直链同一个理由。哪天要落 R2，
  按 AGENTS.md 第 4 条给对象键起名 `objectKey`，来源侧那个键改叫自报家门的名字。

## 三种失败态

| # | 情形 | 表现 |
| --- | --- | --- |
| 1 | 没配 `PSN_NPSSO`，状态文件里也没有可用的 refresh token | **启动即退出**（码 1），报错点名变量名，附两条运维提醒。这一步不出网 |
| 2 | NPSSO 无效 / 过期（换码那步被拒） | 报错说清是哪一步失败，附「怎么重新拿一串」和两条运维提醒 |
| 3 | 运行中 refresh 失败 | **不退出。** 退避重试（15 秒起翻倍，10 分钟封顶），把状态喊出来；手上有 NPSSO 就自动整条重来一遍 |

失败态 1 是不出网的本地路径，实跑确认过（上面「先跑一次 `--once`」那段就是它的输出）。
失败态 2 和 3 是拿**模拟上游响应**跑的 —— 用垃圾值去撞真实索尼端点，得到的是一条
不能申报的实测行为，不如把 `fetch` 换掉、喂它一个 400 看自己怎么反应。失败态 3
那次模拟里，两路轮询各自按 2 → 4 → 8 秒退避（演示时把 `RETRY_MS` 调小了），
进程一直活着，日志因为 `log.ts` 的按条退避只在第一次完整说一遍。

第 3 种里有个刻意的分叉：**只有「被拒」才退回 NPSSO**。超时、断网这类要原样抛出去
让上层退避重试 —— 不该拿一串宝贵的 NPSSO 去撞一堵网络的墙，换一次就作废上一串。

## 在 NAS 上跑

部署单元是同目录的 [compose.yaml](compose.yaml)：把这个目录整个拷到 NAS、旁边放一份
`.env`，就地 build。**别在 Mac 上 build 完把镜像拷过去** —— Mac 是 arm64、群晖是
x86_64，架构对不上。

```bash
COPYFILE_DISABLE=1 tar czf - -C reporters --exclude node_modules --exclude dist --exclude state playstation-reporter | ssh nas-host 'mkdir -p /srv/lyjwpage && tar xzf - -C /srv/lyjwpage'
ssh nas-host 'cat > /srv/lyjwpage/playstation-reporter/.env && chmod 600 /srv/lyjwpage/playstation-reporter/.env' < 本机那份.env
ssh nas-host '/usr/local/bin/docker compose -f /srv/lyjwpage/playstation-reporter/compose.yaml up -d --build'
```

（`docker` 不在群晖的非交互 PATH 里，得写绝对路径。`-f` 指到哪个文件，compose 就拿
那个目录当项目目录 —— `.env` 和项目名都从那儿取，不会和 NAS 上别的 compose 项目串。）

refresh token 存在名为 `playstation-state` 的卷里，挂在容器的 `/app/state`。
镜像里那个目录已经 `chown` 给 `node` 了 —— 不先建好的话卷会以 root 身份挂进来，
非 root 的进程写不进去，于是每次重启都退回「要一份新 NPSSO」，而重新生成 NPSSO
会作废上一串，很快就会互相打架。

**Docker 构建没验过**（写这份东西的机器上 docker daemon 没在跑）。

## 常量都是从哪儿抄的

一个都不是凭记忆写的。`psn-api@2.18.1`（MIT，achievements-app/psn-api）的源码，
逐条对应：

| 常量 / 端点 | 出处 |
| --- | --- |
| `https://ca.account.sony.com/api/authz/v3/oauth` | `src/authenticate/AUTH_BASE_URL.ts` |
| client id `09515159-…`、`redirect_uri`、`scope`、`redirect: "manual"` 那套 | `src/authenticate/exchangeNpssoForAccessCode.ts` |
| `Basic MDk1MTUx…`（手机端 App 的公开 client 凭据）、`token_format: "jwt"` | `src/authenticate/exchangeAccessCodeForAuthTokens.ts`、`src/authenticate/exchangeRefreshTokenForAuthTokens.ts` |
| `https://m.np.playstation.com/api/userProfile/v1/internal/users` | `src/user/USER_BASE_URL.ts` 的 `USER_BASE_URL` |
| `/:accountId/basicPresences?type=primary` | `src/user/getBasicPresence.ts` |
| `https://m.np.playstation.com/api/gamelist/v2/users` | `src/user/USER_BASE_URL.ts` 的 `USER_GAMES_BASE_URL` |
| `/:accountId/titles` + `limit` / `offset` / `categories` | `src/user/getUserPlayedGames.ts`、`src/utils/buildRequestUrl.ts` |
| `Authorization: Bearer …` 的打法 | `src/utils/call.ts` |
| 两个响应的字段名和示例值 | 随包发布的 `dist/index.d.ts`（`BasicPresenceResponse` / `UserPlayedGamesResponse`） |

那个包不进依赖：**运行时零依赖**，fetch 用 Node 20 自带的，只实现上面这两个调用。
包本身还有一路 GraphQL 的 `getRecentlyPlayedGames`（`web.np.playstation.com/api/graphql/v1/op`
加一个 persisted query 的 `sha256Hash`），这份上报器**没有用** —— `…/titles` 已经
给全了要的字段，多带一个反向工程出来的哈希只是多一处会哑掉的地方。

源码是这么取的（`npm view psn-api version` 确认版本，包里只发 `dist`，原始 TS 在
sourcemap 的 `sourcesContent` 里）：

```bash
curl -sL "$(npm view psn-api dist.tarball)" | tar xzf - -C /tmp
node -e 'const m=require("/tmp/package/dist/index.mjs.map");m.sources.forEach((s,i)=>console.log(s))'
```

## 不进容器直接跑

Node ≥ 20，在这个目录里：

```bash
npm install && npm run build && node dist/index.js --once   # 冒烟
npm start                                                    # 常驻
```

它是独立的部署单元、有自己的 `package-lock.json`，用 npm 不用 pnpm
（`npm install --package-lock-only` 重生成锁文件时要在**没有 `node_modules`** 的干净
目录里跑，否则会把 pnpm 的软链农场写进去，那种锁文件在容器里没用）。
`log.ts` 和 `src/index.ts` 里那个 `loop()` 是从另外两份上报器**拷**过来的，不抽公共包 ——
理由写在 `log.ts` 的头注释里。
