# server-reporter

把日本落地节点的 CPU、内存、磁盘、网速、周期流量推给 lyjwpage 的小进程，跑在节点自己上面。

站点够不着这台机器的 `/proc`（将来还要部署到 Vercel），所以该给的东西由这边送过去。
只依赖 Python 3 标准库，这台 1C2G 的 Ubuntu 上没装 Node，也不为此装。

## 它做什么

| 内容 | 节奏 | 什么时候真的推 |
| --- | --- | --- |
| CPU / 负载 / 内存 / 磁盘 / 网速 / 运行时间 | 三档：有人正看着 60 秒，页面开着但在后台 2 分钟，一个页面都没开 15 分钟 | **每轮都推**。这份快照本身就是心跳，站点拿 `pushedAt` 判断上报器还活着没有 |
| 公网 IP 的 Location / ISP / ASN | 地址变了才查，否则缓存 6 小时 | 跟着上面那份一起推。查的是网卡上的地址，不是「我访问某个 what-is-my-ip 看到的出口」 |
| 计费周期内的累计流量 | 每轮把这一段的增量并进去 | 跟着一起推。攒不住（状态文件写不进）时报 `null`，卡片上那一栏整行不出现 |

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

累计那两个纯函数（周期边界、增量累加）有单测，标准库 unittest，不装东西：

```bash
python3 reporter_test.py
```

站点那侧**没有实时推送**。这些数字每个间隔都在变，广播就是拿推送当轮询用；卡片 30 秒自己来问。

每轮收尾并行读取在线人数和 API Worker 的 `GET /count`（各自超时 2.5 秒），分别拿到两个数，据此选下一轮的档：

| 问到什么 | 下一轮 | 变量 |
| --- | --- | --- |
| `online > 0` —— 有页面**可见** | 60 秒 | `LIVE_INTERVAL_MS` |
| `connections > 0` —— 有页面**开着** | 2 分钟 | `OPEN_INTERVAL_MS` |
| 两个都是 0 | 15 分钟 | `IDLE_INTERVAL_MS` |

两个数是两个口径，这也正是要两个的原因：站点侧 `use-online-count` 在页面不可见时把连接整条关掉，所以锁屏、切走的标签页在 `online` 里算 0；而 `use-live-events` 那条连接不管可不可见都挂着，它们在 `connections` 里。中间那档就是为「切走了但还会切回来」留的 —— 切回来那一下不该看见十分钟前的 CPU。

三档和另外两个上报器（agent-limits-reporter、playstation-reporter）逐档对齐，同一个概念同一个数。这份快照每轮必发（它本身就是心跳），30 秒一轮时 `/api/ingest/server` 是站点函数调用量最大的一条路径，实测 12 小时 1.5K 次。人头数读不回来一律当 0，只会往慢里退，永远不会因为故障变快。

长档不是一觉睡满：拆成一个个快档长度的小觉，每觉醒来重新问一次人头数，该走更快那档了就立刻回去开跑。否则「从没人到有人正看着」最坏要等满一个慢档（15 分钟），而那正是有人盯着屏幕等的那一刻。上一轮出错时走的是退避表，那段时间不问人头数。

卡片那侧仍是 30 秒一问（和充电头一档），比快档还勤 —— 多出来那一趟拿到的是同一份数字，是有意留的：那是浏览器自己的节奏，不该由上报器的档位决定。

人数读取上报使用的同一个 `SITE_URL`，所有连接该 API Worker 的页面都计入判断。

断流窗口锚的是**慢档**：站点 `lib/freshness` 的 `SERVER_STALE_MS` 默认 50 分钟 = 三轮 + 缓存余量，和另外两路的窗口同一个数。改慢档必须同步改那边，改另外两档不用。顺序是**站点那侧先放宽窗口并部署，这边再降频**，反过来做中间那段时间卡片会一直显示离线。

## 配置

全部走环境变量。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `SITE_URL` | ✅ | 上报 Worker 的源，如 `https://api.homepage.lyjw.llc`。上报端点和推送连接数的 `/count` 从它拼 |
| `SITE_INGEST_URL` | | 直接给完整端点，给了就不用 `SITE_URL` 上报；人头数仍只从 `SITE_URL` 读，没配就永远走最慢那档 |
| `TELEMETRY_INGEST_SECRET` | ✅ | 和站点同名变量对上，作 Bearer 鉴权。站点没配时才可留空 |
| `HOST_ID` | | 默认 `misaka-jp`，卡片上认的名字 |
| `HOST_ROOT` | | 宿主机 `/etc` 挂进容器后的前缀，compose 里填 `/host`，**不写进 `.env`**。留空 = 直接跑在宿主机上，读 `/etc` 和 `/`。见[下面那节](#容器里怎么还能看见宿主机) |
| `HOST_LOCATION` | | 默认 `Tokyo`，机房所在城市。站点不从 IP 猜 |
| `TRAFFIC_STATE_PATH` | | 默认 `/data/traffic.json`，流量累计的状态文件。**留空 = 不攒流量**，报文里 `traffic` 为 `null` |
| `TRAFFIC_CYCLE_DAY` | | 默认 `1`，周期从每月几号按 UTC 归零。跟着套餐账单日填，只收 1–28 |
| `TRAFFIC_QUOTA_BYTES` | | 套餐配额，字节。配了卡片才画进度条（按上下行之和）；没配只报用量 |
| `LIVE_INTERVAL_MS` | | 默认 `60000`，有人正看着那一档 |
| `OPEN_INTERVAL_MS` | | 默认 `120000`，页面开着但都在后台那一档 |
| `IDLE_INTERVAL_MS` | | 默认 `900000`，一个页面都没开那一档。站点的 `SERVER_STALE_MS` 锚着它 |
| `COUNT_TIMEOUT_MS` | | 默认 `2500`，问人头数那一次请求的超时 |
| `PUSH_TIMEOUT_MS` | | 默认 `10000` |

## 在 VPS 上跑

2026-09-13 起部署单元是 Docker，和 `agent-limits-reporter` 合在
[`reporters/compose.yaml`](../compose.yaml) 一个 project 里，misaka-jp 上一条命令起两个。
从前这里是 systemd（`server-reporter.service`，`DynamicUser=yes`），已经删掉，不要再装。

ssh 直连在 kex 阶段会被对面关掉，一律走 dsm 跳板：`ssh -J dsm misaka-jp`。

拷过去（`scp` 不一定可用，走 tar 管道；tar 会带上 Mac 的 uid，落地补一次 `chown`）：

```bash
COPYFILE_DISABLE=1 tar czf - -C reporters --exclude .env --exclude __pycache__ --exclude data compose.yaml server-reporter \
  | ssh -J dsm misaka-jp 'mkdir -p /opt/lyjwpage && tar xzf - -C /opt/lyjwpage && chown -R root:root /opt/lyjwpage/server-reporter /opt/lyjwpage/compose.yaml'
```

状态卷的目录先建好并交给容器里的 `nobody`（镜像里是 uid 65534），否则写不进去、
流量那栏不会出现：

```bash
ssh -J dsm misaka-jp 'mkdir -p /opt/lyjwpage/server-reporter/data && chown 65534:65534 /opt/lyjwpage/server-reporter/data'
```

`.env` 单独送，别混进源码目录一起打包：

```bash
ssh -J dsm misaka-jp 'cat > /opt/lyjwpage/server-reporter/.env && chmod 600 /opt/lyjwpage/server-reporter/.env' < 本机那份.env
```

起来（**点名服务**，不然会连 agent-limits-reporter 那个 3GB 镜像一起重建）：

```bash
ssh -J dsm misaka-jp 'cd /opt/lyjwpage && docker compose up -d --build server-reporter'
```

生产的 `SITE_URL` 统一填 `https://api.homepage.lyjw.llc`，不经 Vercel 站点。

看日志：`ssh -J dsm misaka-jp 'docker logs -f server-reporter'`。

### 容器里怎么还能看见宿主机

`/proc` 在 Docker 里本来就不虚拟化，CPU、内存、负载、运行时间、内核版本、核数读到的
直接是宿主机的数。另外两块要配：

| 要什么 | 怎么拿 |
| --- | --- |
| 网卡名、网卡上的公网 IP、收发字节 | `network_mode: host`。这三样读的是网络命名空间（`/proc/net/route`、`/proc/net/dev`、`SIOCGIFADDR`），容器自己那套是 `eth0` + `172.x` |
| 系统名、主机名、根分区容量 | 只读挂 `/etc:/host/etc` 加 `HOST_ROOT=/host`。前两样读 `$HOST_ROOT/etc/{os-release,hostname}`；容量对 `$HOST_ROOT/etc` 做 `statvfs` —— 容器里量 `/` 量到的是 overlay，不是真正的根分区 |

`HOST_ROOT` 留空就是老样子（直接跑在宿主机上、读 `/etc` 和 `/`），本地 `python3 reporter.py` 照旧。
不挂宿主机整个 `/`：这里只 `statvfs` 一个路径、只读两个文件，`/etc` 一个挂载点就够，
没必要为此把 `/root`、`/etc/shadow` 之类一并暴露给容器进程。

## 容错

- 站点连不上只是这一轮作废，进程不退；下一轮照常重试，间隔从这一档起每连错一次翻倍，到 5 分钟封顶，跑通一次就复位。
- 同一个环节连续报错只在第一次和恢复时各写一句日志，中间每满 10 次再报一次。
- 网卡取默认路由那块（这台是 `enp3s0`），`lo` 不算。默认路由暂时没有时这一轮失败，不瞎猜一块。
- 流量状态文件读不出来（坏了、是别的版本）只丢掉这份历史、从零重新数，不挡这一轮上报；写不进去时这一份报 `traffic: null`，其余照报。

在线人数已恢复独立 Worker：配置 `ONLINE_COUNTER_URL=https://online.homepage.lyjw.llc`（只填源）。
其 `/count` 的 `online` 判定快档；`SITE_URL/count` 的 `connections` 判定中档。两个查询独立超时、独立降为零。
