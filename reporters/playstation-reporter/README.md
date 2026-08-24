# playstation-reporter

把 PSN 的「此刻在玩」和「最近在玩」推给 lyjwpage 的小代理。

> ## ⚠️ 这是原型，**从没用真实凭据跑过**
>
> 写这份东西时手上没有、也不需要任何 PSN 账号。所以：
>
> - **所有对索尼端点的调用都未经验证。** 鉴权和两个业务请求直接调用
>   [`psn-api`](https://github.com/achievements-app/psn-api)（MIT）；响应规范化和错误处理
>   仍只按它的类型与实现写成，没有用真实账号确认过索尼今天会怎么答。
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

（这个地址也是 psn-api 文档给出的取值入口。上报器**不**替你去开浏览器，
那串得手工取。）

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
| `PUSH_TIMEOUT_MS` | | 默认 `15000`，推站点用 |

变量名跟两个邻居走（`SITE_URL` / `SITE_INGEST_URL` / `TELEMETRY_INGEST_SECRET`），
不另起一套 —— 三份上报器将来会摆在同一台 NAS 上、共用同一份 `.env` 习惯。

### token 状态文件

`PSN_STATE_FILE` 指的那份 JSON 里是**明文的 access / refresh token**，所以：

- 以 **0600** 写入，所在目录 0700；写法是「先写 `.tmp` 再 `rename`」，rename 是原子的，
  进程写到一半被 docker 干掉不会留下半份 JSON 把下次启动坑死；
- `state/` 进同目录的 `.gitignore` 和 `.dockerignore`；
- **任何日志都不打印 token 内容**，拿到新 token 时只说到期时刻；上游报错时只带
  普通错误文案。换码那一步的 access code 也不进日志。

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
函数，假数据的字段和示例值取自 `psn-api` 的 `dist/index.d.ts` 里那些 `@example`
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

## 为什么直接依赖 psn-api

索尼没有公开这些接口，OAuth 常量、端点和响应细节都来自逆向工程。上报器不再把它们
复制进自己的源码，而是把鉴权交给 `exchangeNpssoForAccessCode`、
`exchangeAccessCodeForAuthTokens`、`exchangeRefreshTokenForAuthTokens`，业务请求交给
`getBasicPresence` 和 `getUserPlayedGames`。上游变化时可以直接跟进 psn-api 的维护版本，
避免这里的一份副本无声失效。

状态文件、过半衰期续期、single-flight、业务请求 401 后强制续一次、信封规范化和推送
节奏仍由本上报器负责。psn-api 目前不会保留业务响应的 HTTP 状态码，401 会成为只带
上游 `error.message` 的普通 `Error`，所以这里按未授权文案判别后重试一次。

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
