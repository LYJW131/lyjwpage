# emby-reporter

把内网 Emby 的状态推给 lyjwpage 的小代理，跑在 NAS 上。

站点在公网上，够不着局域网里的 Emby（`http://emby.local:8096`），
所以站点不主动请求 Emby，该给的东西由这个代理送过去。

## 它做四件事

| 内容 | 节奏 | 什么时候真的推 |
| --- | --- | --- |
| 续播列表（`Users/{id}/Items/Resume`，含单集详情） | 每 `RESUME_INTERVAL_MS` 一轮 | 列表内容有变化时；另外每 `FULL_PUSH_INTERVAL_MS` 兜底整推一次 |
| 播放位置、设备与规格（`/Sessions`，规格从条目详情的媒体源里挑） | 在播时每 `SESSION_ACTIVE_INTERVAL_MS` 一轮，空闲时每 `SESSION_IDLE_INTERVAL_MS` | 换片、暂停状态变了、位置偏离站点推算值超过 `SEEK_TOLERANCE_MS`（也就是拖了进度条）、客户端 / 设备 / 播放方式 / 选中的音轨与字幕变了，或距上次落锚已满 `REANCHOR_MS`（周期性重新落锚） |
| 海报（`Items/{id}/Images/...`） | 跟着上面两条走 | 上报器一次压成 WebP 并直传 R2；只把对象键推给站点，按 Emby 的 ImageTag 判变 |
| 接收 Emby 的播放通知 | 事件驱动 | 通知只当触发器，本身不进站点：叫醒会话轮询，暂停 / 停止后催一下续播列表；「停止」直接清掉站点的播放状态 |

**Emby 的 webhook 发给这个代理，不直发站点。** Emby 后台那个配置项加不了
自定义请求头，直发站点就只能开一个不鉴权的入口；所以通知只在局域网里到代理，
站点收到的上报一律由代理带着这个来源自己的 Access service token 发出。

事件本身只当触发器用：开始 / 暂停 / 继续等事件叫醒会话轮询，位置、暂停状态、设备名
一律以 `/Sessions` 的回答为准 —— webhook 各版本的字段位置本来就不一致，用它带的值
等于把版本差异一路带进站点。唯一的例外是「停止」：它直接给站点清掉播放状态
（`playing: null`），不等 `/Sessions` 确认。

规格（分辨率、动态范围、编码、音轨、字幕、码率）从换片时取的条目详情里按会话选中的
流下标挑（`src/playback.ts`），只把挑好的字段发出去：流列表整份不出这台机器，外挂字幕
流带着 NAS 的 SMB 路径。客户端名和设备名原样转发，怎么显示由站点定。

事件顺带当作会话轮询的开关：**除「停止」外的播放事件把会话轮询叫醒，按活跃档
跟 `WAKE_WINDOW_MS`，「停止」就歇下来**，没人看片时不盲轮。空闲那一档仍留着，
是漏收 webhook 时的兜底。

位置为什么不是每轮都推：站点是按「上次锚点 + 真实流逝时间」自己把进度条推着走的，
正常播放它算得准，只有拖了进度条才会偏，每轮都推只会白白消耗上报请求。

## 配置

全部走环境变量。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `EMBY_URL` | ✅ | 内网地址，如 `http://emby.local:8096` |
| `EMBY_API_KEY` | ✅ | Emby 后台「高级 → API 密钥」 |
| `EMBY_USER_ID` | ✅ | 要跟的那个用户；别人在看什么不会被推出去 |
| `SITE_INGEST_URL` | ✅ | 上报端点 `https://ingest.homepage.lyjw.llc/api/ingest/emby` |
| `ACCESS_CLIENT_ID` | ✅ | Cloudflare Access service token `lyjwpage-emby` 的 client id |
| `ACCESS_CLIENT_SECRET` | ✅ | 同一把 token 的 secret，只在 Zero Trust 控制台创建或轮换时显示一次 |
| `R2_ENDPOINT` | ✅ | R2 S3 API 地址，如 `https://<account>.r2.cloudflarestorage.com` |
| `R2_BUCKET` | ✅ | 图片 bucket 名称 |
| `R2_ACCESS_KEY_ID` | ✅ | 只授予该 bucket 写权限的访问密钥 ID |
| `R2_SECRET_ACCESS_KEY` | ✅ | 对应的访问密钥；只留在 NAS 上报器环境变量中 |
| `WEBHOOK_PORT` | | 默认 `8787`，Emby 的播放通知发到这里 |
| `WEBHOOK_TOKEN` | | webhook 的共享密钥。配了就要求通知地址带 `?token=<值>`，**留空 = 局域网里谁都能发** |
| `RESUME_INTERVAL_MS` | | 默认 `60000` |
| `RESUME_LIMIT` | | 默认 `8`，站点也只展示这么多 |
| `SESSION_ACTIVE_INTERVAL_MS` | | 默认 `2000` |
| `SESSION_IDLE_INTERVAL_MS` | | 默认 `300000`，漏收 webhook 时的兜底 |
| `WAKE_WINDOW_MS` | | 默认 `30000`，收到事件后至少按活跃档跟这么久 |
| `SEEK_TOLERANCE_MS` | | 默认 `1500`，判定「拖了进度条」的阈值 |
| `REANCHOR_MS` | | 默认 `300000`，没拖动也隔这么久重新落一次锚 |
| `FULL_PUSH_INTERVAL_MS` | | 默认 `600000`，没变化也兜底整推的间隔，也是站点断流告警的心跳。改长时先放宽 `shared/emby-store.ts#RESUME_STALE_MS` |
| `IMAGES_PER_PUSH` | | 默认 `4`，一次推送最多捎几张图 |
| `REQUEST_TIMEOUT_MS` | | 默认 `10000`，问 Emby 和传 R2 用 |
| `PUSH_TIMEOUT_MS` | | 默认 `30000`，上报到站点的请求超时 |
| `WEBHOOK_HOST_PORT` | | 默认 `8787`，映射到容器内的 `WEBHOOK_PORT` |

## 在 NAS 上跑

部署单元是同目录的 [compose.yaml](compose.yaml)：NAS 上只放它和旁边一份 `.env`。
镜像由 [`build-reporters.yml`](../../.github/workflows/build-reporters.yml) 在 GitHub Actions 上构建
（只出 `linux/amd64`），这个目录有改动合进 main 就推 `ghcr.io/lyjw131/emby-reporter:latest` 和
`sha-<短哈希>`。机器上只拉镜像，不放源码、不 build。
线上跑在 dsm 的 compose 项目 `dsm:/volume3/docker/emby-proxy`（`dsm:/volume3/docker/emby-proxy/docker-compose.yml`，服务名 `emby-reporter`，
容器名 `homepage-reporter`，`.env` 在项目根）。那边的服务定义应与这份一样写 `image:`、不写 `build:`；
机器上是否已从现场 build 切到拉镜像，以 [docs/ops-facts.md](../../docs/ops-facts.md) 为准，操作前先到机器上确认。

容器里监听 `WEBHOOK_PORT`，宿主端口由 `.env` 的 `WEBHOOK_HOST_PORT` 决定，compose 把两者对上（默认值见上面的配置表）。

只动这一个服务，别整项目 `up`（同一项目里还有别的容器）；之后每次 Actions 推了新镜像也是这一句：

```bash
ssh dsm '/usr/local/bin/docker compose -f /volume3/docker/emby-proxy/docker-compose.yml pull emby-reporter && /usr/local/bin/docker compose -f /volume3/docker/emby-proxy/docker-compose.yml up -d --no-deps emby-reporter'
```

群晖的 Docker 要能连上 `ghcr.io`（和拉 Docker Hub 基础镜像一样，按需给 daemon 配代理）。

（`docker` 不在群晖的非交互 PATH 里，得写绝对路径。`-f` 指到哪个文件，compose 就拿
那个目录当项目目录 —— `.env` 和项目名都从那儿取，不会和 NAS 上别的 compose 项目串。）

生产的 `SITE_INGEST_URL` 填 `https://ingest.homepage.lyjw.llc/api/ingest/emby`，不经 Vercel 站点。

不进容器直接跑也行（Node ≥ 20），在仓库根目录：
`pnpm --filter @lyjwpage/emby-reporter build && node reporters/emby-reporter/dist/index.js`。

## Emby 侧怎么配

后台「通知 → 添加通知 → Webhooks」，地址填**代理**而不是站点。代理在 nas-host 上、
Emby 在 emby-host 上，所以填 nas-host 的局域网地址和上面那个宿主端口：

```text
http://reporter.local:8788/webhook
```

（哪天两者同机就填 `http://localhost:<宿主端口>/webhook`；Emby 自己跑在容器里的话
用容器网络里的服务名。）请求方式 POST、内容 JSON，勾上播放开始 / 暂停 / 继续 / 停止。
路径其实不校验，POST 到哪个路径都收 —— 各版本的 Emby 对地址的处理不太一样，
少一个能配错的地方。

**这个端口默认不鉴权**：局域网里任意一台机器发一条伪造的 `playback.stop` 就能抹掉
站点上「正在观看」的卡片，伪造 `start` 则能把会话轮询顶到活跃档。同网段设备不
都可信的话，在 `.env` 里配一个 `WEBHOOK_TOKEN`，通知地址跟着带上：

```text
http://reporter.local:8788/webhook?token=<和 WEBHOOK_TOKEN 一样的值>
```

Emby 的通知配置项加不了自定义请求头，但地址里的 query 是能带的 —— 所以密钥走
query 而不是 header。**改了 `WEBHOOK_TOKEN` 记得同步改 Emby 后台那条地址**，
忘了改等于把 webhook 唤醒关掉了（表现为开播要等下一轮空闲轮询才被发现）。

## 容错

- Emby 或站点连不上都只是这一轮作废，进程不退；下一轮照常重试。
- 推送失败（站点重部署、网络断了）不会丢状态：推送失败时锚点不前进，会话循环下一轮
  就把最新的位置补上，平时也每隔 `REANCHOR_MS` 重新落一次锚；清播放状态的推送失败时，
  站点那份状态自己会推算到片尾作废。
- 代理重启后第一轮查到没人在播，会明确给站点清一次 —— 我们手上是空的，
  而站点那份还留着重启前的「正在播放」，没人更正的话它会一直挂着。
- 同一个环节连续报错只在第一次和恢复时各写一句日志，中间每满 10 次再报一次，
  免得 `docker logs` 被同一条「连接被拒绝」刷满。
- 站点的响应里带 `missingImages`（它引用了却没有对应图片的键）。站点存储被清空、
  图片映射被淘汰，或直传的对象在 R2 里确认不到时，代理据此把图补传回去，
  不需要人工干预。
- 同一张图连着试 `MAX_IMAGE_ATTEMPTS` 次（`src/index.ts#MAX_IMAGE_ATTEMPTS`）不成，
  就不再试了。两种失败共用这个上限：一种是送到站点了、站点还说没有（R2 对象校验
  没通过，而图片键跟着 ImageTag 走不会自己变，一直重试只会变成死循环），另一种是
  压根取不到 / 传不上去（条目被删、Emby 404、R2 凭据过期）。后一种到上限也要出队 ——
  每轮固定取队头 `IMAGES_PER_PUSH` 张，一张永远取不到的图不出队就会把后面排队的
  海报全堵住。
- 会话循环出错时，下一次重试是 `SESSION_ACTIVE_INTERVAL_MS` 后，连着错才逐次翻倍、
  最多退到 `SESSION_IDLE_INTERVAL_MS`（跑通一次就复位）。正在播放时抖一下不该按
  「空闲」处理：站点那侧还在按锚点推进度条，断供多久就偏多久。续播循环出错则仍按
  `RESUME_INTERVAL_MS` 重试，不退避。
