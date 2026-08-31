# apple-music-reporter

把 Apple Music 的「最近在听」推给 lyjwpage 的小上报器。

站点从前自己去 `api.music.apple.com` 拉这份列表——全站唯一一路主动回源，而且
每个访客的每一轮轮询都要重走一遍缓存（一次请求十几趟 Redis）。现在站点那侧
命中数据缓存就不打 Redis，也不再打 Apple。

## 为什么非得是个常驻进程

省下那十几趟 Redis 只是顺带。真正的原因是**「此刻在不在听」需要连续观测**。

Apple 没有服务端可查的「当前播放」接口，也不返回播放时间戳，只能观测最近播放
列表里排第一的那项**什么时候变成第一的**，在它的总时长之内就认为还在听。这个
观测状态从前存在站点的进程内存里——serverless 上每个实例各有一份、活不到下一次
切换，等于永远推断不出来。

固定节奏一直看着的进程才是这件事该待的地方。

## 它做两件事

| 内容 | 节奏 | 什么时候真的推 |
| --- | --- | --- |
| 最近播放列表（含封面、链接、首项时长） | 三档：有人正看着 60 秒 / 页面开着但在后台 2 分钟 / 一个页面都没开 15 分钟 | 内容有变化时；另外每 10 分钟兜底整推一次（闲时每轮都已到期，等于 15 分钟一封） |
| 「此刻在不在听」的推断 | 跟着上面那轮 | 同上，它是同一份载荷里的一个字段 |

每轮收尾时问两个 `GET /count`（各超时 2.5 秒），据此选下一轮的档：

| 问到什么 | 下一轮 | 变量 |
| --- | --- | --- |
| online-counter 的 `online > 0` —— 有页面**可见** | 60 秒 | `LIVE_INTERVAL_MS` |
| live-push 的 `connections > 0` —— 有页面**开着** | 2 分钟 | `OPEN_INTERVAL_MS` |
| 两个都是 0 | 15 分钟 | `IDLE_INTERVAL_MS` |

两个数是两个口径：站点侧 `use-online-count` 在页面不可见时把连接整条关掉，所以切走的
标签页、锁了屏的手机在 online-counter 那侧算 0；`use-live-events` 那条不关，所以它们
只在 live-push 那个数里。中间那档是为「切走了但还会切回来」留的。可见的那个数问到了
就不问第二个（可见必然也开着）。

15 分钟那一档只在**一个页面都没开**的时候才划算 —— 那时这份轮询只为记录历史而跑，
晚一会儿落地没人受影响，换来的是闲时对 Apple 的请求从 1440 次/天降到 96 次/天；有人
正看着的这几分钟里多打几次 Apple，换歌延迟从最坏 15 分钟降到 1 分钟。人头数超时、
非 200、返回形状不对，一律**当 0 处理**：兜底方向是单向的，读不到只会往慢里退，永远
不会因为故障变快。哪个变量不配，对应那一档就用不上。

长档不是一觉睡满：拆成一个个快档长度的小觉，每觉醒来重新问一次人头数，问到人立刻
开跑。否则「从没人到有人正看着」最坏要等满一个闲档，而那正是有人盯着屏幕等的那一刻。
多打的那几次是自家的两个 worker，不是 Apple。

live-push 一份生产一个，`LIVE_PUSH_URL` 填的是 Vercel 那一份，国内那份生产上开着的
后台页面不进这个判断 —— 少数了只会更慢，和读不到时同一个方向。

兜底整推那 10 分钟是按墙钟判定的，但判定写在 tick 里 —— **只有 tick 跑起来才检查**，
而闲档一轮就是 15 分钟，每轮都早过了阈值。所以一个页面都没开时整推和轮询合一，站点
固定每 15 分钟收一封。站点侧的断流窗口（`src/lib/freshness.ts` 的 `LISTENING_STALE_MS`，
50 分钟）锚的就是这个闲档节奏：改**闲档**必须同步改那边，改另外两档不用。

兜底整推是防站点那侧的 Redis 被清空或换库。站点收到后会自己比对内容，没变就不会
往浏览器发失效通知，所以这条不会退化成定时广播。

## 凭据从站点取，不自己签

签 developer token 的 `.p8` 私钥按设计留在 Mac 的钥匙串里，这边签不出来。所以
**`GET /api/ingest/apple-music`** 取一份 Mac 上报器推上去的 token，`POST` 同一个
地址交算好的列表——同一把锁（`TELEMETRY_INGEST_SECRET`），同一个门。

让它直连 Redis 也能拿到，但那样它就多持有一份 Redis 凭据、还得自己认识键名和
存储格式；走 HTTP 的话它只需要认识一个地址和一把已经有了的密钥。

实测 developer token 寿命**大约一个月**（Apple 没有承诺过这个数，观测到的值在 29～30
天之间浮动过，根 README 记的是 30 天）。所以这个上报器平时不依赖 Mac 在线，只在
每月重签那一次要 Mac 醒着一回。续期逻辑不看这个具体数字，它取「签发 → 到期」的中点。到期前一小时会主动去换新的；换不到但旧的还没过期
就继续用旧的（站点重部署那几十秒不该把上报也停掉）。

## 配置

全部走环境变量。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `SITE_URL` | ✅ | 站点地址，如 `https://lyjw131.com`。端点路径由上报器自己拼 |
| `SITE_INGEST_URL` | | 直接给完整端点，给了就不用 `SITE_URL` |
| `TELEMETRY_INGEST_SECRET` | ✅ | 和站点同名变量对上，作 Bearer 鉴权。站点没配时才可留空 |
| `APPLE_MUSIC_STOREFRONT` | | 目录查询地区，默认 `cn` |
| `LIVE_INTERVAL_MS` | | 默认 `60000`，有人正看着那一档 |
| `OPEN_INTERVAL_MS` | | 默认 `120000`，页面开着但都在后台那一档 |
| `IDLE_INTERVAL_MS` | | 默认 `900000`，一个页面都没开那一档。这也是「换歌时刻」的观测精度，站点的 `LISTENING_STALE_MS` 锚着它 |
| `ONLINE_COUNTER_URL` | | online-counter worker 的**源**，路径由这边拼 `/count`，和站点侧 `NEXT_PUBLIC_ONLINE_COUNTER_URL` 同一个形状。不配就永远进不了快档 |
| `LIVE_PUSH_URL` | | live-push worker 的**源**，同样拼 `/count`。不配就永远进不了中档 |
| `COUNT_TIMEOUT_MS` | | 默认 `2500`，问这两个数各自的超时 |
| `FULL_PUSH_INTERVAL_MS` | | 默认 `600000`，没变化也兜底整推的间隔 |
| `REQUEST_TIMEOUT_MS` | | 默认 `10000`，问 Apple 和取凭据用 |
| `PUSH_TIMEOUT_MS` | | 默认 `15000` |

## 跑起来

部署单元是同目录的 [compose.yaml](compose.yaml)：把这个目录整个拷到要跑它的机器上、
旁边放一份 `.env`，就地 build。**别在 Mac 上 build 完把镜像拷过去** —— Mac 是
arm64、群晖是 x86_64，架构对不上。

它没有任何入站接口，不开端口，跑在哪台机器上都行——只要出得了网、够得着站点。
和 Emby 那个不一样：那个必须待在能收 Emby webhook 的内网里。

拷过去（nas-host 的 sftp 子系统是关的，`scp` 用不了，走 tar 管道）：

```bash
COPYFILE_DISABLE=1 tar czf - -C reporters --exclude node_modules --exclude dist apple-music-reporter | ssh nas-host 'mkdir -p /srv/lyjwpage && tar xzf - -C /srv/lyjwpage'
```

`.env` 单独送，别混进源码目录一起打包：

```bash
ssh nas-host 'cat > /srv/lyjwpage/apple-music-reporter/.env && chmod 600 /srv/lyjwpage/apple-music-reporter/.env' < 本机那份.env
```

起：

```bash
ssh nas-host '/usr/local/bin/docker compose -f /srv/lyjwpage/apple-music-reporter/compose.yaml up -d --build'
```

（`docker` 不在群晖的非交互 PATH 里，得写绝对路径。`-f` 指到哪个文件，compose 就拿
那个目录当项目目录 —— `.env` 和项目名都从那儿取，不会和 NAS 上别的 compose 项目串。）

`SITE_URL` 指到站点跑的那台机器。站点在 MacBook 上时填它的局域网地址
`http://site.local:3211`。

不进容器直接跑也行（Node ≥ 20），在仓库根目录：
`pnpm --filter @lyjwpage/apple-music-reporter build && node reporters/apple-music-reporter/dist/index.js`。

## 容错

- Apple 或站点连不上都只是这一轮作废，进程不退；下一轮照常重试。
- 凭据被上游拒了会立刻去站点换一份，不等下一轮。
- 换新失败但旧的还没过期时继续用旧的：站点重部署那几十秒不该把上报也停掉。
- 同一个环节连续报错只在第一次和恢复时各写一句日志，中间每满 10 次再报一次，
  免得 `docker logs` 被同一条「连接被拒绝」刷满。

## 已知的不精确之处

都是这个推断本身的性质，不是实现缺陷：

- 一直循环同一张专辑时排第一的 id 不变，会被当成已经停了；
- 只听了专辑里一首歌就走开，仍按整张时长算，这段时间内都显示在听；
- 换歌时刻最多晚一个**当前档位的**轮询间隔被记下：有人正看着时 1 分钟，页面只是
  开着时 2 分钟，一个页面都没开时最坏 15 分钟 —— 那段时间里这份记录只进历史，
  没人正盯着它翻；
- 容器重启后要重新观测到一次切换才会再判定「在听」——刚起来时看到的第一项无从
  分辨是刚开始播还是几小时前就听完了，一律不算。不做持久化是因为重启远比从前
  站点那种「每次冷启动」罕见，不值得为它挂个卷。
