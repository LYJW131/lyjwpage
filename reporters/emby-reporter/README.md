# emby-reporter

把内网 Emby 的状态推给 lyjwpage 的小代理，跑在 NAS 上。

站点将来要部署到 Vercel，那时它够不着局域网里的 Emby（`http://emby.local:8096`），
所以站点侧已经删光了对 Emby 的主动请求。该给的东西改由这个代理送过去。

## 它做四件事

| 内容 | 节奏 | 什么时候真的推 |
| --- | --- | --- |
| 续播列表（`Users/{id}/Items/Resume`，含单集详情） | 60 秒一轮 | 列表内容有变化时；另外每 10 分钟兜底整推一次 |
| 播放位置（`/Sessions`） | 在播时 2 秒一轮，空闲时 5 分钟 | 换片、暂停状态变了、或位置偏离站点推算值超过 1.5 秒（也就是拖了进度条） |
| 海报（`Items/{id}/Images/...`） | 跟着上面两条走 | 只推站点还没有的那些，按 Emby 的 ImageTag 判变 |
| 转发 Emby 的播放通知 | 事件驱动 | 收到就转 |

**Emby 的 webhook 现在发给这个代理，不再直发站点。** Emby 后台那个配置项加不了
自定义请求头，直发站点就只能开一个不鉴权的入口；经代理转发后，站点只保留
`TELEMETRY_INGEST_SECRET` 这一种鉴权方式。

事件本身只当触发器用，位置、暂停状态、设备名一律以 `/Sessions` 的回答为准 ——
webhook 各版本的字段位置本来就不一致，用它带的值等于把版本差异一路带进站点。

事件顺带当作会话轮询的开关：**收到「开始播放」才起 2 秒那一档，「停止」就歇下来**，
没人看片时不盲轮。空闲那一档 5 分钟仍留着，是漏收 webhook 时的兜底。

位置为什么不是 2 秒一推：站点是按「上次锚点 + 真实流逝时间」自己把进度条推着走的，
正常播放它算得准，只有拖了进度条才会偏。站点将来在 Vercel 上是按调用计费的函数，
一小时白推 1800 次没有道理。

## 配置

全部走环境变量。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `EMBY_URL` | ✅ | 内网地址，如 `http://emby.local:8096` |
| `EMBY_API_KEY` | ✅ | Emby 后台「高级 → API 密钥」 |
| `EMBY_USER_ID` | ✅ | 要跟的那个用户；别人在看什么不会被推出去 |
| `SITE_URL` | ✅ | 站点地址，如 `https://lyjw131.com`。端点路径由代理自己拼 |
| `SITE_INGEST_URL` | | 直接给完整端点，给了就不用 `SITE_URL` |
| `TELEMETRY_INGEST_SECRET` | ✅ | 和站点同名变量对上，作 Bearer 鉴权。站点没配时才可留空 |
| `WEBHOOK_PORT` | | 默认 `8787`，Emby 的播放通知发到这里 |
| `RESUME_INTERVAL_MS` | | 默认 `60000` |
| `RESUME_LIMIT` | | 默认 `8`，站点也只展示这么多 |
| `SESSION_ACTIVE_INTERVAL_MS` | | 默认 `2000` |
| `SESSION_IDLE_INTERVAL_MS` | | 默认 `300000`，漏收 webhook 时的兜底 |
| `WAKE_WINDOW_MS` | | 默认 `30000`，收到事件后至少按活跃档跟这么久 |
| `SEEK_TOLERANCE_MS` | | 默认 `1500`，判定「拖了进度条」的阈值 |
| `REANCHOR_MS` | | 默认 `30000`，没拖动也隔这么久重新落一次锚 |
| `FULL_PUSH_INTERVAL_MS` | | 默认 `600000`，没变化也兜底整推的间隔 |
| `IMAGES_PER_PUSH` | | 默认 `4`，一次推送最多捎几张图 |

## 在 NAS 上跑

```bash
docker build -t emby-reporter reporters/emby-reporter
docker run -d --name emby-reporter --restart unless-stopped \
  -p 8787:8787 \
  -e EMBY_URL=http://emby.local:8096 \
  -e EMBY_API_KEY=... \
  -e EMBY_USER_ID=... \
  -e SITE_URL=https://lyjw131.com \
  -e TELEMETRY_INGEST_SECRET=... \
  emby-reporter
```

compose 版本：

```yaml
services:
  emby-reporter:
    build: ./reporters/emby-reporter
    restart: unless-stopped
    ports:
      - "8787:8787"
    environment:
      EMBY_URL: http://emby.local:8096
      EMBY_API_KEY: ${EMBY_API_KEY}
      EMBY_USER_ID: ${EMBY_USER_ID}
      SITE_URL: https://lyjw131.com
      TELEMETRY_INGEST_SECRET: ${TELEMETRY_INGEST_SECRET}
```

那个端口只需在局域网里可达，**别映射到公网**：Emby 的 webhook 带不了鉴权，
这个入口也就没法校验来路。

不进容器直接跑也行（Node ≥ 20），在仓库根目录：
`pnpm --filter @lyjwpage/emby-reporter build && node reporters/emby-reporter/dist/index.js`。

## Emby 侧怎么配

后台「通知 → 添加通知 → Webhooks」，地址填**代理**而不是站点：

```text
http://<NAS 地址>:8787/webhook
```

Emby 和代理在同一台 NAS 上时填 `http://localhost:8787/webhook`；Emby 跑在容器里的话
用容器网络里的服务名。请求方式 POST、内容 JSON，勾上播放开始 / 暂停 / 继续 / 停止。
路径其实不校验，POST 到哪个路径都收 —— 各版本的 Emby 对地址的处理不太一样，
少一个能配错的地方。

## 容错

- Emby 或站点连不上都只是这一轮作废，进程不退；下一轮照常重试。
- 转发失败（站点重部署、网络断了）不会丢状态：会话循环每 30 秒重新落一次锚，
  下一轮就把最新的位置补上；停止事件转发失败时，站点那份状态自己会推算到片尾作废。
- 代理重启后第一轮查到没人在播，会明确给站点清一次 —— 我们手上是空的，
  而站点那份还留着重启前的「正在播放」，没人更正的话它会一直挂着。
- 同一个环节连续报错只在第一次和恢复时各写一句日志，中间按 1、10、100 次退避着报，
  免得 `docker logs` 被同一条「连接被拒绝」刷满。
- 站点的响应里带 `missingImages`（它引用了却没有的图片键）。Redis 被清空、
  容器换了机器之后，代理据此把图补传回去，不需要人工干预。
- 同一张图连着送三次站点还说没有，就不再送了 —— 那是它存不下（编码不认之类），
  而图片键跟着 ImageTag 走不会自己变，一直重试只会变成死循环。
