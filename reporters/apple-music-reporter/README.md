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
| 最近播放列表（含封面、链接、首项时长） | 60 秒一轮 | 内容有变化时；另外每 10 分钟兜底整推一次 |
| 「此刻在不在听」的推断 | 跟着上面那轮 | 同上，它是同一份载荷里的一个字段 |

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
| `RECENT_INTERVAL_MS` | | 默认 `60000`。这也是「换歌时刻」的观测精度 |
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
- 换歌时刻最多晚一个轮询间隔被记下；
- 容器重启后要重新观测到一次切换才会再判定「在听」——刚起来时看到的第一项无从
  分辨是刚开始播还是几小时前就听完了，一律不算。不做持久化是因为重启远比从前
  站点那种「每次冷启动」罕见，不值得为它挂个卷。
