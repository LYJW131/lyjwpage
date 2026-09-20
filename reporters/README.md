# misaka-jp 上报器部署与迁机

仅管理 lyjwpage 的三个上报器。服务器上的其他 Compose 项目不属于本目录。
以 2026-09-20 核对的配置为基线；源码和部署定义在 Git 中，密钥与运行数据需私下备份。

## 部署布局

把本仓库 `reporters/` 中以下文件复制到服务器 `/opt/lyjwpage/`：

| Compose 项目 | 配置文件 | 服务 | 持久化数据 |
| --- | --- | --- | --- |
| `lyjwpage-reporters` | `compose.yaml` | `agent-limits-reporter` | `agent-limits-reporter/data/`，UID/GID 1000 |
| 同上 | 同上 | `server-reporter` | `server-reporter/data/`，UID/GID 65534 |
| `discord-reporter` | `discord-reporter/compose.yaml` | `discord-reporter` | 无；Bot 配置在该目录 `.env` |

三个目录各有 `.env.example`。复制为 `.env` 后填写真实配置，权限设为 `600`。
`SITE_URL` 均为 API Worker 地址；`TELEMETRY_INGEST_SECRET` 与 Worker 一致。
Discord 额外需要 Bot token、用户 ID、Presence Intent 与共同服务器。
各服务自己的 README 记录登录、字段和采集行为。

## 在新服务器恢复

需要 Linux、Docker Engine 和 Compose v2。先从仓库根目录打包源码（不带凭据/数据），
将 `NEW_HOST` 替换成 SSH 主机别名。在目标机器构建镜像，避免 CPU 架构不一致。

```bash
COPYFILE_DISABLE=1 tar --no-xattrs -czf - -C reporters \
  --exclude node_modules --exclude dist --exclude .env --exclude data \
  compose.yaml README.md agent-limits-reporter server-reporter discord-reporter \
  | ssh NEW_HOST 'mkdir -p /opt/lyjwpage && tar xzf - -C /opt/lyjwpage'
```

旧机器先停止三个上报器，再备份以下私密文件；限额上报器不能在两台机器同时使用同一份
refresh token，否则会互相使登录失效。这里只停止指定服务，不运行整个项目的 `down`。

```bash
ssh OLD_HOST 'cd /opt/lyjwpage && docker compose stop agent-limits-reporter server-reporter && docker compose -f discord-reporter/compose.yaml stop discord-reporter'
# 私密备份留在本机 Git 仓库之外，不要上传到 GitHub。
umask 077
ssh OLD_HOST 'cd /opt/lyjwpage && tar czf - agent-limits-reporter/.env agent-limits-reporter/data server-reporter/.env server-reporter/data discord-reporter/.env' > "$HOME/lyjwpage-reporters-private.tgz"
ssh NEW_HOST 'umask 077; tar xzf - -C /opt/lyjwpage' < "$HOME/lyjwpage-reporters-private.tgz"
```

没有旧备份时，复制三个 `.env.example` 并填写配置，按
[限额上报器 README](agent-limits-reporter/README.md) 重新登录各平台。
有备份时保留完整目录，包括隐藏文件；server 的 `traffic.json` 保留本周期累计流量。
迁往不同套餐时检查 `HOST_ID`、`HOST_LOCATION`、`TRAFFIC_CYCLE_DAY`、`TRAFFIC_QUOTA_BYTES`，
不要把旧服务器的流量累计误当成新套餐的用量。

在新服务器执行：

```bash
cd /opt/lyjwpage
mkdir -p agent-limits-reporter/data server-reporter/data
chown -R 1000:1000 agent-limits-reporter/data
chown -R 65534:65534 server-reporter/data
chmod 600 agent-limits-reporter/.env server-reporter/.env discord-reporter/.env
docker compose config --quiet
docker compose -f discord-reporter/compose.yaml config --quiet
docker compose up -d --build agent-limits-reporter server-reporter
docker compose -f discord-reporter/compose.yaml up -d --build discord-reporter
```

Discord 的 `DRY_RUN=true` 只采集并记录日志；确认生产 `/api/status/discord` 已可用后，
把其 `.env` 改成 `DRY_RUN=false`，重新执行 Discord 的 `up -d`。
恢复时使用私密备份中的设置，而不是覆盖成示例文件。

## 验证与回退

```bash
cd /opt/lyjwpage
docker compose ps
docker compose -f discord-reporter/compose.yaml ps
docker logs --tail 30 discord-reporter
```

确认真实上报无错误，以及生产 `/api/status/server`、`/api/status/vibecoding`、
`/api/status/discord` 时间戳继续更新。Discord 空闲时 `playing: null` 是正常结果。
看到容器 Running 还不等于已成功上报。不要在共享终端打印渲染后的 `docker compose config`，
它包含真实密钥；验证语法用 `--quiet`。

若恢复失败，先停止新机器的三个上报器，保持新旧不并行，再启动旧机器同名服务。
若新机器已刷新登录凭据，回退前把最新 `agent-limits-reporter/data/` 私下同步回旧机器。
旧机器目录与私密备份保留到生产验收完成。日常更新点名服务，避免重建另外的容器。
