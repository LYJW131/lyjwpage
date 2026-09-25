# server-reporter

把日本落地节点的 CPU、内存、磁盘、网速、周期流量推给 lyjwpage 的小进程，跑在节点自己上面。

站点够不着这台机器的 `/proc`（将来还要部署到 Vercel），所以该给的东西由这边送过去。
TypeScript / Node，和 [agents-reporter](../agents-reporter) 同一套结构（`config` / `log` /
`site` / `push-ledger` 各一份；它按人数调频的那份这里不用，见下面「节奏」）。没有运行时依赖，跑在容器里，机器上不用装 Node。2026-09 前是 Python
标准库写的，改写时报文字段和状态文件格式都没变。

## 它做什么

| 内容 | 节奏 | 什么时候真的推 |
| --- | --- | --- |
| CPU / 负载 / 内存 / 磁盘 / 网速 / 运行时间 | 固定每分钟一轮（`INTERVAL_MS`） | **每轮都推**。这份快照本身就是心跳，站点拿 `pushedAt` 判断上报器还活着没有 |
| 公网 IP 的 Location / ISP / ASN | 地址变了才查，否则缓存 6 小时 | 跟着上面那份一起推。查的是网卡上的地址，不是「我访问某个 what-is-my-ip 看到的出口」 |
| 计费周期内的累计流量 | 每轮把这一段的增量并进去 | 跟着一起推。攒不住（状态文件写不进）时报 `null`，卡片上那一栏整行不出现 |
| 推送账本（`reporter` 块） | 站点回 ok 才记一笔，十分钟一格存在 `PUSH_LEDGER_PATH` | 每封都带：镜像提交（Actions 以 `GIT_SHA` 烧进 `REPORTER_COMMIT`）、过去 12 小时推成功几封（含这一封）、这些封往返的中位数（`rttMs`，从发出到读完回执，不含这一封）、窗口起止。站点卡片服务区据此显示 Push、RTT 和线上跑的哪一版。和 agents-reporter 同一份 `push-ledger.ts` |

CPU 占用和网卡速率都是这一段间隔的平均，不是「这一瞬间的尖峰」：上一轮 `/proc` 的读数留着，这一轮做差。第一封在启动后约 1 秒就发出去，卡片不必干等一个完整间隔。

## 流量怎么攒的

`/proc/net/dev` 那两个计数器只从开机算起，一重启就归零，所以「这个计费周期用了多少」
站点算不出来，得这边自己攒：每轮的增量既用来算速率，也累加进当前周期，连同游标一起
原子写回 `TRAFFIC_STATE_PATH`（容器里是挂进来的 `/data/traffic.json`）。进程重启、
机器重启、容器重建都接着上次数下去。

| 情况 | 怎么处理 |
| --- | --- |
| 这一次读数比游标小 | 机器重启，网卡从 0 重新数。开机到这一轮之间那段就是当前读数本身 |
| 从没攒过（状态文件不存在） | 只记游标、不计流量。一台开机 200 天的机器第一次跑起来，计数器里那几个 T 是过去几个月的，不该一股脑算进这个周期 |
| 从没攒过，但**开机时刻在这个周期之内** | 计数器里每个字节都是这个周期走的，整份接管。第一次装上去不用干等到下个周期才有数 |
| 默认路由换了网卡 | 新计数器和上一块无关，累计和游标一起作废，从这一轮重新数 |
| 状态是上个周期的，中间机器还重启过 | 计数器归零那条规矩照走，开机以来的字节整段算进新周期 —— 其中落在上个周期的那一小段跟着多算了，上限是「最后一次开机到周期边界」那么多。要分得更细就得再记一份跨周期的开机快照，为这点误差不值 |
| 跨周期那一轮 | 整段增量算进新周期。边界上最多差一个上报间隔，而按秒把它劈成两半要假设这段时间流量是匀速的 —— 那个假设比这点误差更假 |
| 状态文件一次都没写成功过 | 报 `null`，不报一个只从本次进程算起的小数。卡片上少一栏，好过显示一个错的 |

周期是 **UTC** 的自然月，起始日 `TRAFFIC_CYCLE_DAY` 跟着套餐账单日填（1–28，29 之后
不是每个月都有）。这台在东京，UTC 和 JST 差 9 小时，落在边界上那几个小时的流量算进
哪个月对配额没有影响，换取的是「不管容器时区怎么设，两次读到的是同一个周期」。

配额 `TRAFFIC_QUOTA_BYTES` 是可选的，配了卡片才画进度条，**按上下行之和**算用量。
套餐若只计出站，别配这个变量 —— 那条进度条会比实际宽松。

单位是**十进制**：套餐说的「2T」按 2×10¹² 填（`TRAFFIC_QUOTA_BYTES=2000000000000`），
卡片上那一栏也按 1000 换算。网络那一侧一向如此，卡片上的速率（MB/s = 10⁶ B/s）本来
就是这个口径；按 1024 算的话 2T 会显示成「1.82 TB」，和账单对不上。内存和磁盘不受
影响，它们仍按 1024 —— 那是系统自己报数的方式。

周期边界、增量累加、12 小时窗口、推送账本这几个纯函数有单测：

```bash
pnpm --filter @lyjwpage/server-reporter test
```

站点那侧**没有实时推送**。这些数字每个间隔都在变，广播就是拿推送当轮询用；卡片 30 秒自己来问。

### 节奏

固定每分钟推一次，按轮的起点对齐（采集和推送花掉的时间从这一分钟里扣）。

从前按有没有人在看分三档（可见 60 秒、只是开着 2 分钟、都没有 15 分钟），为的是给 Vercel 函数减负：上报曾经经过 Vercel，30 秒一轮时这条是全站函数调用量最大的路径（实测 12 小时 1.5K 次）。上报改进 api Worker 之后那个理由没了，三档反而更费 —— 闲着时每分钟要问两个 Worker 的 `/count`，一天约 2880 次，比固定每分钟推一次（1440 次）还多。2026-09 起去掉。agents-reporter 和 playstation-reporter 还在按人数调频：它们控制的是打厂商 / PSN 接口的频率，那个理由还在。

断流窗口是站点 `lib/freshness` 的 `SERVER_STALE_MS`（默认 50 分钟，按从前的慢档定的）。现在每分钟一轮，窗口可以缩到几分钟；**顺序是这边先提速、确认跑稳，站点再缩窗口**，反过来做中间那段时间卡片会断续显示离线。

## 配置

全部走环境变量。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `SITE_URL` | ✅ | 上报 Worker 的源，如 `https://api.homepage.lyjw.llc`，上报端点从它拼 |
| `SITE_INGEST_URL` | | 直接给完整端点，给了就不用 `SITE_URL` |
| `ACCESS_CLIENT_ID` | ✅ | Cloudflare Access service token `lyjwpage-server` 的 client id；配了就走 Access，`SITE_INGEST_URL` 填 `https://ingest.homepage.lyjw.llc/api/ingest/server` |
| `ACCESS_CLIENT_SECRET` | ✅ | 同一把 token 的 secret，只在 Zero Trust 控制台创建或轮换时显示一次 |
| `TELEMETRY_INGEST_SECRET` | | 过渡期的旧共用 Bearer，没配 Access 凭据时才用；全部迁完后删除 |
| `HOST_ID` | | 默认 `misaka-jp`，卡片上认的名字 |
| `HOST_ROOT` | | 宿主机 `/etc` 挂进容器后的前缀，compose 里填 `/host`，**不写进 `.env`**。留空 = 直接跑在宿主机上，读 `/etc` 和 `/`。见[下面那节](#容器里怎么还能看见宿主机) |
| `HOST_LOCATION` | | 默认 `Tokyo`，机房所在城市。站点不从 IP 猜 |
| `TRAFFIC_STATE_PATH` | | 默认 `/data/traffic.json`，流量累计的状态文件。**留空 = 不攒流量**，报文里 `traffic` 为 `null` |
| `TRAFFIC_CYCLE_DAY` | | 默认 `1`，周期从每月几号按 UTC 归零。跟着套餐账单日填，只收 1–28 |
| `TRAFFIC_QUOTA_BYTES` | | 套餐配额，字节。配了卡片才画进度条（按上下行之和）；没配只报用量 |
| `INTERVAL_MS` | | 默认 `60000`，每轮间隔 |
| `PUSH_TIMEOUT_MS` | | 默认 `10000` |
| `PUSH_LEDGER_PATH` | | 默认 `/data/pushes.json`，推送账本。留空 = 只记在内存里，重启后从零数 |
| `DRY_RUN` | | `1` 时采一轮、把报文打到 stdout 就退出，不推送 |

## 在 VPS 上跑

2026-09-13 起部署单元是 Docker，和 `agents-reporter` 合在
[`reporters/compose.yaml`](../compose.yaml) 一个 project 里，misaka-jp 上一条命令起两个。
从前这里是 systemd（`server-reporter.service`，`DynamicUser=yes`），已经删掉，不要再装。

ssh 直连在 kex 阶段会被对面关掉，一律走 dsm 跳板：`ssh -J dsm misaka-jp`。

镜像由 [`build-reporters.yml`](../../.github/workflows/build-reporters.yml) 在 GitHub Actions 上构建
（只出 `linux/amd64`），这个目录有改动合进 main 就推 `ghcr.io/lyjw131/server-reporter:latest` 和
`sha-<短哈希>`。机器上只拉镜像，不放源码、不 build。
`/opt/lyjwpage/server-reporter/` 下只有 `.env` 和 `data/` 卷。

`compose.yaml` 改了才需要送（`scp` 不一定可用，走 ssh 管道）：

```bash
ssh -J dsm misaka-jp 'mkdir -p /opt/lyjwpage && cat > /opt/lyjwpage/compose.yaml' < reporters/compose.yaml
```

状态卷的目录先建好并交给容器里的 `nobody`（镜像里是 uid 65534），否则写不进去、
流量那栏不会出现：

```bash
ssh -J dsm misaka-jp 'mkdir -p /opt/lyjwpage/server-reporter/data && chown 65534:65534 /opt/lyjwpage/server-reporter/data'
```

`.env` 单独送：

```bash
ssh -J dsm misaka-jp 'cat > /opt/lyjwpage/server-reporter/.env && chmod 600 /opt/lyjwpage/server-reporter/.env' < 本机那份.env
```

起来：

```bash
ssh -J dsm misaka-jp 'cd /opt/lyjwpage && docker compose pull server-reporter && docker compose up -d --no-deps server-reporter'
```

合进 main 之后不用再手动换：`build-reporters.yml` 推完镜像会用部署密钥 ssh 过去自动 pull 并重建这一个服务（见 `reporters/misaka-deploy.sh`）。手动换还是上面那一句。

生产的 `SITE_URL` 统一填 `https://api.homepage.lyjw.llc`，不经 Vercel 站点。

看日志：`ssh -J dsm misaka-jp 'docker logs -f server-reporter'`。

### 容器里怎么还能看见宿主机

`/proc` 在 Docker 里本来就不虚拟化，CPU、内存、负载、运行时间、内核版本、核数读到的
直接是宿主机的数。另外两块要配：

| 要什么 | 怎么拿 |
| --- | --- |
| 网卡名、网卡上的公网 IP、收发字节 | `network_mode: host`。这三样读的是网络命名空间（`/proc/net/route`、`/proc/net/dev`、`os.networkInterfaces()`），容器自己那套是 `eth0` + `172.x` |
| 系统名、主机名、根分区容量 | 只读挂 `/etc:/host/etc` 加 `HOST_ROOT=/host`。前两样读 `$HOST_ROOT/etc/{os-release,hostname}`；容量对 `$HOST_ROOT/etc` 做 `statfs` —— 容器里量 `/` 量到的是 overlay，不是真正的根分区 |

`HOST_ROOT` 留空就是直接跑在宿主机上、读 `/etc` 和 `/`（`pnpm build && node dist/index.js`，要 Linux）。
想看一眼报文不推送：`DRY_RUN=1` 采一轮打到 stdout 就退出。
不挂宿主机整个 `/`：这里只 `statfs` 一个路径、只读两个文件，`/etc` 一个挂载点就够，
没必要为此把 `/root`、`/etc/shadow` 之类一并暴露给容器进程。

## 容错

- 站点连不上只是这一轮作废，进程不退；下一轮照常重试，间隔从一分钟起每连错一次翻倍，到 5 分钟封顶，跑通一次就复位。
- 同一个环节连续报错只在第一次和恢复时各写一句日志，中间每满 10 次再报一次。
- 网卡取默认路由那块（这台是 `enp3s0`），`lo` 不算。默认路由暂时没有时这一轮失败，不瞎猜一块。
- 流量状态文件读不出来（坏了、是别的版本）只丢掉这份历史、从零重新数，不挡这一轮上报；写不进去时这一份报 `traffic: null`，其余照报。
