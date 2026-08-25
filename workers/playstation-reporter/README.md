# playstation-reporter

Cloudflare Worker 上的 PSN 上报器：每 15 分钟顺序读取一次「此刻在玩」和「最近在玩」，
并比对奖杯总览指纹；只有变化的部分才推给 lyjwpage。奖杯明细只在等级 / 完成度
变化时才整份拉一遍。

鉴权链和两个读取端点已经用真实凭据跑通，也确认 `Accept-Language: zh-Hans` 会返回
官方中文名。唯一还没实测的是向站点真正 POST：目标端点目前不存在。

## 调度与状态

只有一个 Cron Trigger：`*/15 * * * *`。`wrangler dev` 不会自己响这根 cron，
本地要刷新就 `GET /tick`。每轮顺序执行：

1. 读取 presence；
2. 复用同一轮拿到的 token，分页拉全份 played games（带 `Accept-Language`）；
3. 分页拉购买库（PS4 / PS5），把 `service` / 预购接到游玩列表；没开过档的预购
   追加在最近窗口之后，不混进 `PLAYED_GAMES_LIMIT`；
4. 比对奖杯总览指纹；变了才拉明细，并用官方
   `getUserTrophiesForSpecificTitle` 把 `titleId`（PPSA…）接到
   `npCommunicationId`（NPWR…），同一奖杯组的多个 SKU 时长相加，中文名取自游玩列表；
5. 按 `PLAYSTATION_HIDDEN_TITLE_IDS` 去掉屏蔽的 titleId（不上报），再按
   `PLAYED_GAMES_LIMIT`（默认 100）切开，接上未开档预购；
6. 只把发生变化的部分装进同一个 v1 信封；都没变就不推。

没有 30 秒 / 5 分钟双节奏，也没有定时兜底整推。状态全部放在绑定 `STATE` 的 Workers
KV：

| KV key | 内容 |
| --- | --- |
| `auth` | token 状态 JSON，形状与旧 `state/auth.json` 完全相同 |
| `fp:presence` | presence 内容指纹 |
| `fp:playedGames` | played games 内容指纹 |
| `fp:trophies` | 奖杯总览指纹（等级 + 各标题完成度） |
| `meta:lastTick` | 最近一轮时间、成功与否、变化情况和 dry-run 状态 |

`auth` 的字段固定为 `accessToken`、`refreshToken`、`accessTokenIssuedAt`、
`accessTokenExpiresAt`、`refreshTokenIssuedAt`、`refreshTokenExpiresAt`；四个时间都是
epoch 毫秒。现有文件可以原样种进 KV。

Worker 的 HTTP `fetch` 是手动触发入口：`GET /tick` 把一轮 tick 完整跑一遍（拉
PSN、比指纹、变了才交付），把这轮的元信息和抓到的 presence、played games 一并
返回；出错则回 502，带上错误和 KV 里最近一轮的记录。`GET /` 只回最近一轮的
meta，不碰 PSN —— Chrome / Cursor 探调试口会打 `/json/version` 再打根路径，
根路径上跑 tick 会把 PSN 打爆。`/favicon.ico` 同样 404。

Worker 自己不做鉴权，访问控制交给前面的 Cloudflare Access；token 永远不出现在
响应里。

## 鉴权

整条链由 `psn-api` 2.18.1 的三个 exchange 函数负责：

```text
NPSSO → access code → access token + refresh token → refresh 续期
```

access token 过「签发 → 到期」的中点就续；业务请求遇到 401 会强制续一次并重试一次。
refresh 被上游拒绝时才退回 NPSSO，超时、断网等网络错误原样抛出，避免拿 NPSSO 去撞
网络故障。真实凭据观察到 refresh token 有效期约 10 天，不是旧文档所写的约两个月；
具体期限始终以上游响应为准。

NPSSO 是 Worker secret `PSN_NPSSO`，可以缺席：KV 的 `auth` 里还有有效 refresh token
时不需要它。重新生成 NPSSO 会立即作废上一串；也不要从 PlayStation 网站登出，登出会
让已经发出的 token 在七天内软失效。

## 语言与规范化

`PSN_LANGUAGE` 在 `wrangler.toml` 的 `[vars]` 中默认是 `zh-Hans`。
`PLAYED_GAMES_LIMIT` 默认 100。`PLAYSTATION_HIDDEN_TITLE_IDS` 是逗号分隔的
titleId，屏蔽的游戏不上报、不占窗口；改这份名单会重推奖杯目录。presence 和
奖杯接口通过 psn-api 的 `headerOverrides` 发送 `Accept-Language`。

「玩过的游戏」仍是唯一例外：psn-api 2.18.1 的 `getUserPlayedGames` 不接
`headerOverrides`，实现也不发语言头，所以 `src/psn.ts` 继续直接请求与它相同的
`…/users/:accountId/titles` 端点。上游补上这个入口后才能切回库函数。
游玩列表已经是中文元数据；奖杯标题对不上时用这份名字做 `localizedName`，
不手写中英对照。

规范化在 Worker 内做完：ISO 时间戳转 epoch 毫秒，ISO-8601 时长转毫秒，平台名统一
大写；对上游响应保留可选链与兜底。`category` 是上游枚举，已实测还会出现
`ps5_native_media_app`（YouTube / Netflix），其余常见值包括 `ps4_game`、
`ps5_native_game`、`pspc_game` 和 `unknown`。
`service` 同样是上游枚举，已实测 `ps_plus` / `none(purchased)` / `other`；
`ps_plus` 表示当前这份 entitlement 来自 Plus 会员库。预购来自购买库的
`isPreOrder`，没对上就是 `false`。买断后 `service` 可能变成 `none(purchased)`，
即使这款曾经在 Plus 目录里。

## 信封

形状与旧 Node 上报器不变，两部分各自可省：

```jsonc
{
  "version": 1,
  "presence": {
    "observedAt": 1787599316815,
    "online": true,
    "availability": "availableToPlay",
    "platform": "PS5",
    "lastOnlineAt": 1685827528987,
    "playing": {
      "titleId": "PPSA01521_00",
      "title": "Horizon Forbidden West",
      "format": "PS5",
      "launchPlatform": "PS5",
      "iconUrl": "https://image.api.playstation.com/…"
    }
  },
  "playedGames": {
    "observedAt": 1787599316816,
    "items": [
      {
        "titleId": "PPSA01521_00",
        "name": "Horizon Forbidden West",
        "category": "ps5_native_game",
        "playCount": 100,
        "firstPlayedAt": 1436557219000,
        "lastPlayedAt": 1722713307120,
        "playDurationMs": 824193000,
        "imageUrl": "https://image.api.playstation.com/…",
        "service": "none(purchased)",
        "preOrder": false
      }
    ]
  }
}
```

配了 `SITE_INGEST_URL` 就直接使用；否则由 `SITE_URL` 拼
`/api/ingest/playstation`。两者都没配就是 dry-run。真推时可选 secret
`TELEMETRY_INGEST_SECRET` 会作为 Bearer token。

## 部署

推到 `main` 且这个目录有改动时，`.github/workflows/deploy-workers.yml` 会自动部署，
不用在本机执行 `wrangler deploy`。首次部署后有两类手工动作：

1. 把备份的旧 `state/auth.json` 原样写到 KV key `auth`；
2. 按需要写入 secret：`PSN_NPSSO`，以及站点启用后用的
   `TELEMETRY_INGEST_SECRET`。

站点端点完成后，再在 `wrangler.toml` 配 `SITE_URL` 或 `SITE_INGEST_URL`，结束
dry-run。

本目录是独立 npm 部署单元，保留自己的 `package-lock.json`。重生成时必须在没有
`node_modules` 的干净状态运行 `npm install --package-lock-only`，否则根工作区的 pnpm
软链可能被写进锁文件，CI 的 `npm ci` 无法复现。

本地只做类型检查：

```bash
npm ci
npm run typecheck
```
