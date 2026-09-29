# reporters/agents-reporter

把各 coding agent 的账号限额（以及 Cursor 云端用量）推给站点的小代理，跑在 misaka-jp 的容器里。配置表、登录步骤、部署命令在 `README.md`，这里只写不变量、坑和须成对修改的文件。

## 不变量

- 凭据在容器里自己登录，绝不拷 Mac 上那份：两份 refresh token 各自刷新会互相作废。续期时不要同时运行交互式登录，也不要有第二个实例共用同一个凭据卷；换机器时先停旧容器，再拷 `data/` 卷，最后起新的。
- 每轮都 POST，内容没变也发：那一封就是心跳，站点靠它刷新限额时间。整轮失败的重试间隔从短到长翻倍，跑通一次复位。
- 「没配」（`configured: false`）的 agent 这一行不发，站点按 id 留着上一次的值；「配了但取不到」发空 `limits` 加非空 `limitsError`，不要把上一次的好值再发一遍。一家失败只影响那一行。
- 按页面人数分档调频，只读公开的 `SITE_URL/count`（`online` 判快档、`connections` 判中档），不带 ingest 密钥；读不到、超时、格式错一律当 0，只会变慢。`IDLE_INTERVAL_MS` 改长时，先放宽站点 `src/lib/freshness.ts#AGENT_LIMITS_STALE_MS` 并部署完，容器再改。
- 上报鉴权是 `lyjwpage-agents` 那把 Access service token（`ACCESS_CLIENT_ID` / `ACCESS_CLIENT_SECRET`），只在控制台创建或轮换时显示一次；`.env` 不进仓库。
- 依赖站点新契约的改动，先确认站点与 Worker 已生效，再换容器（根 `AGENTS.md`「部署流程」）。

## 部署

- 镜像由 `.github/workflows/build-reporters.yml` 构建；合进 main 后推 GHCR，并用受限部署密钥 ssh 到 misaka-jp 自动换这一个服务（`reporters/misaka-deploy.sh`）。机器上只拉镜像，不放源码、不 build。
- 一个 compose project 里有两个服务（本服务与 `server-reporter`），不点名服务的 `docker compose` 命令会同时动两个容器：只换这个就写服务名并加 `--no-deps`。
- ssh 直连在 kex 阶段会被关掉，一律 `ssh -J dsm misaka-jp`；`compose.yaml` 改了才需要手动送（跳板后没有 sftp，走 ssh 管道）。控制台与机器侧的事实见 `docs/ops-facts.md`。

## 须成对修改

- `reporters/agents-reporter/src/push-ledger.ts` 与 `reporters/server-reporter/src/push-ledger.ts` 是同一份（两边各一份、逐字相同），改一边必须改另一边；上报入口校验它带的 `reporter` 块。
- 新增或改名 agent：`src/config.ts` 的 `AGENT_IDS` 默认值、`src/providers/` 里的取数、`src/limits.ts` 的登记、登录步骤（`README.md`「登录」）和站点按 id 贴回限额的展示要一起看。

## 验证

- `pnpm --filter @lyjwpage/agents-reporter typecheck`；`pnpm --filter @lyjwpage/agents-reporter test`（先 `tsc` 再 `node --test`）。
- 不出网、不读凭据的干跑：`DRY_RUN=1 LIMITS_FIXTURE=<夹具> HOME=/tmp/empty node dist/index.js`（先 `npm run build`），夹具形状见 `README.md`「DRY_RUN」。
