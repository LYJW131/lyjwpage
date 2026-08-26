# server-reporter

把日本落地节点的 CPU、内存、磁盘、网速推给 lyjwpage 的小进程，跑在节点自己上面。

站点够不着这台机器的 `/proc`（将来还要部署到 Vercel），所以该给的东西由这边送过去。
只依赖 Python 3 标准库，这台 1C2G 的 Ubuntu 上没装 Node，也不为此装。

## 它做什么

| 内容 | 节奏 | 什么时候真的推 |
| --- | --- | --- |
| CPU / 负载 / 内存 / 磁盘 / 网速 / 运行时间 | 15 秒一轮 | **每轮都推**。这份快照本身就是心跳，站点拿 `pushedAt` 判断上报器还活着没有 |
| 公网 IP 的 Location / ISP / ASN | 地址变了才查，否则缓存 6 小时 | 跟着上面那份一起推。查的是网卡上的地址，不是「我访问某个 what-is-my-ip 看到的出口」 |

CPU 占用和网卡速率都是这一段间隔的平均，不是「这一瞬间的尖峰」：上一轮 `/proc` 的读数留着，这一轮做差。第一封在启动后约 1 秒就发出去，卡片不必干等一个完整间隔。

站点那侧**没有实时推送**。这些数字每个间隔都在变，广播就是拿推送当轮询用；卡片 15 秒自己来问。断流窗口默认 45 秒（三倍间隔），漏一条不该翻脸。

## 配置

全部走环境变量。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `SITE_URL` | ✅ | 站点地址，如 `https://lyjw.me`。端点路径由上报器自己拼 |
| `SITE_INGEST_URL` | | 直接给完整端点，给了就不用 `SITE_URL` |
| `TELEMETRY_INGEST_SECRET` | ✅ | 和站点同名变量对上，作 Bearer 鉴权。站点没配时才可留空 |
| `HOST_ID` | | 默认 `misaka-jp`，卡片上认的名字 |
| `HOST_LOCATION` | | 默认 `Tokyo`，机房所在城市。站点不从 IP 猜 |
| `INTERVAL_MS` | | 默认 `15000` |
| `PUSH_TIMEOUT_MS` | | 默认 `10000` |

## 在 VPS 上跑

部署单元是 systemd，不是 Docker —— 这台机器上没有 Docker，为这一个进程拉守护进程也不值。

拷过去（`scp` 不一定可用，走 tar 管道）：

```bash
COPYFILE_DISABLE=1 tar czf - -C reporters --exclude .env server-reporter \
  | ssh misaka-jp 'mkdir -p /opt/lyjwpage && tar xzf - -C /opt/lyjwpage'
```

`.env` 单独送，别混进源码目录一起打包：

```bash
ssh misaka-jp 'cat > /opt/lyjwpage/server-reporter/.env && chmod 600 /opt/lyjwpage/server-reporter/.env' < 本机那份.env
```

装 unit、拉起来：

```bash
ssh misaka-jp 'install -m 644 /opt/lyjwpage/server-reporter/server-reporter.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now server-reporter'
```

`SITE_URL` 指到站点跑的那台。站点在 MacBook 上时，这台公网 VPS 够不着 `localhost:3211`，要么临时做一条 SSH 反向隧道，要么等站点部署到生产再把 `SITE_URL` 改成 `https://lyjw.me`。

看日志：`journalctl -u server-reporter -f`。

## 容错

- 站点连不上只是这一轮作废，进程不退；下一轮照常重试，间隔从这一档起每连错一次翻倍，到 5 分钟封顶，跑通一次就复位。
- 同一个环节连续报错只在第一次和恢复时各写一句日志，中间每满 10 次再报一次。
- 网卡取默认路由那块（这台是 `enp3s0`），`lo` 不算。默认路由暂时没有时这一轮失败，不瞎猜一块。
