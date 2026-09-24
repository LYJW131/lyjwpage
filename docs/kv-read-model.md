# KV 公开读取投影

本层可选启用：**DO SQLite 是唯一权威状态，KV 是可删除、可重建的公开结果投影**。没有 `READ_MODEL` binding 时行为不变。它不是把内部 `StorageClient` 换成 KV，也不把所有 GET 都当缓存。

进 KV 的路径由 `src/lib/status-views.ts` 的 `readModel` 字段派生。有 `event` 的视图按登记表约束不进 KV，模块加载时断言。

## 请求边界

| 路径 | 读取位置 | 发布最小间隔 / 投影最大年龄 |
| --- | --- | --- |
| `/api/status/vibecoding/year`、`github-chart`、`github-repo`、`vercel-deployments`、`sentry`、`reporters` | KV | 300 秒 / 600 秒 |
| `/api/home` | DO；Vercel 生成或重建首页读一次，浏览器打开页面后各卡的第一轮取数合成一次（`src/lib/status-reads.ts`） | 不经 KV |
| 所有 `*/now`、`desktop`、`server`、`activity`、`charger`、`powerbank`、`vibecoding`、`pulse` | DO；包含存活、日界线、暂停宽限期或增量历史语义 | 不经 KV |
| `cloudflare-workers` | DO；带各 Worker 当前版本，投影的发布间隔和最大年龄会让刚部署完读到上一版。上游由 15 分钟 StateHub 缓存挡住 | 不经 KV |
| `listening`、`watching`、`playing` | DO；有推送事件，登记表禁止进 KV | 不经 KV |
| `trophies` | DO；无参是摘要（与首屏字段、`trophies` 推送同形状，挂载引导可代答），`?titleids=` 是那几款的完整目录。有推送事件，登记表禁止进 KV | 不经 KV |
| `/ws`、`/count`、上报、MusicKit token | 原路径 | 不经 KV |
| `/api/lyrics`、`/api/motion-artwork` | 机房级 Cache API，未命中回 DO，不过公开读屏障（见 `workers/api/README.md`） | 不经 KV |
| 任意带查询参数的请求 | 原路径，包括 `since` 和筛选参数 | 不经 KV |

表中简写均位于 `/api/status/` 下。所有 KV 响应继续使用 `Cache-Control: no-store`，避免再叠浏览器 HTTP 缓存；KV 自己使用 60 秒读取缓存。`X-Fetched-At` 是投影开始生成的时刻，不伪装成本次请求时刻。`X-Read-Model: kv | origin` 标识可缓存端点命中还是回源。

`/api/home` 不进 KV，两次读取都直读 DO：Vercel 生成或后台重建首页时读一次；浏览器挂载后各卡的第一次回源合成一次，之后各卡按自己的周期直连各自端点。挂载这一次不能关：「此刻」类信封里有服务端按当时时钟算的结论（存活、日界线、暂停宽限期），HTML 放一会儿就不成立。规则在 `status-reads.ts`：本页收到过推送或失效通知的路径不吃聚合；只服务打开页面后 15 秒内的第一次取数。聚合请求 5 秒超时、非 2xx、字段缺失或该字段本身 `ok:false` 都退回直连。带 `since` 的增量请求也吃聚合，其他查询参数不碰。

## 写入与恢复

1. 上报继续在 StateHub 确认权威写入，LivePushRoom 的连接、计数、广播协议不变。
2. 上报完成（包括已经部分写入而最终报错）仅在 SQLite 中标记 `readModelPathsForSource` 给出的路径。mac 上报只标记 `vibecoding/year`；emby、playstation 上报不标记任何 KV 路径。**不在上报队列里等待 KV put 或重建公开响应**。
3. 每分钟已有 cron 也标记登记表中的全部 KV 路径（六条），覆盖外部查询缓存、只随时间变化的视图，以及给已有 DO 新增 KV binding 的首次回填。标记在原 cron（最近播放刷新、PageSpeed）写完之后才入队。
4. DO alarm 从 `public_read_model_jobs` 取到期项，经同部署 `READ_MODEL_RENDERER` Service Binding 调用普通 Worker 的公开 API 生成结果，再回到 StateHub 完成 KV 写入；调用不经公网，也没有新增 Worker 部署。每轮最多处理三个，单次生成 15 秒超时。策略表里已删除的旧行直接删除。只有这个对象向对应 KV 键发布；边缘读 miss 仅请求补建，绝不回写自己读到的旧响应。
5. 重复标记合并，不把截止时间不断推后；每键最小间隔 300 秒。网络调用前、结束后均持久化冷却期限，避免慢请求、重启或不确定写入后立即再写同键。
6. 发布只确认其捕获的 revision；生成或 KV put 期间收到的新上报仍保留 dirty。失败保留队列并由 alarm 重试，不依赖 JS `setTimeout` 或下一位访客。失败不会把已确认的上报改成失败。

KV 值只包含版本、公开路径、生成时间及公开 JSON 正文，不复制 CORS、凭据或任意存储键。非 200、非 JSON、单条 `ok:false`、过大或生成期间已经过龄的结果不发布；首页允许各卡片独立降级。投影版本为 `public-read-model:v1`，改变序列化契约时升版本。

KV miss、负缓存、旧 schema、错误正文、过龄值、异常和超过一秒的读取均回 DO。最大年龄是**本代码主动拒绝过旧投影的规则**，不是 KV 传播时延的保证，也不是底层数据源的新鲜度保证。

## 启用与回滚

生产 binding 已写在 `workers/api/wrangler.toml`：命名空间 `api-READ_MODEL`（用项目安装的 Wrangler 3 创建，`wrangler kv namespace create READ_MODEL`），binding 名 `READ_MODEL`；`READ_MODEL_RENDERER` 回绑同一个 `api` 服务的具名 `WorkerEntrypoint`。这里使用 Wrangler 3.114.17 已支持的显式 Service Binding，不依赖需要 `enable_ctx_exports` 的 `ctx.exports`。合并到 `main` 即随 Workers Builds 启用，不迁移 DO，也不改 DO 身份。

`wrangler.test.toml` 与本地 `.dev.vars` 环境不配 `READ_MODEL` KV binding：生产、预览和本地测试不能共享一个可写 namespace，多个 StateHub 写同一前缀会破坏单写者假设。测试配置已配 `READ_MODEL_RENDERER` self Service Binding；隔离脚本 `scripts/verify-kv-read-model.mjs` 再用本地 `wrangler dev` 的临时持久化目录模拟 KV，不碰真实命名空间，验证的是仍留在 KV 的路径。

本地 `.dev.vars` 的 `DEV_OVERRIDES=true` 或非空 `UPSTREAM_API_URL` 会同时禁用读取和发布，防止夹具或上游 overlay 污染共享投影。真实混合链路的本地验证使用下方隔离脚本。

启用后先确认一条 KV 路径（例如 `/api/status/vibecoding/year`）原路径正常，待 cron/alarm 回填后，无参数查询应返回 `X-Read-Model: kv`。验证 `/ws`、`/count`、`*/now`、增量请求和 CORS 未改变。KV 长期不可用时会增加 DO 回源，检查 `[read-model]` 日志和命中头，不以“上报成功”推断投影健康。

移除 `READ_MODEL` binding 并走现有 Git 发布即回滚到纯 DO 读取；SQLite 权威数据和 DO 身份不变。KV 可删除后重建，队列由 cron 重新驱动，无需反向导入数据。

## 验证

```sh
pnpm --filter @lyjwpage/api test
pnpm test
pnpm -r --include-workspace-root typecheck
node scripts/verify-api-worker.mjs --build
node scripts/verify-kv-read-model.mjs
```

新增单测用真实 Node SQLite 与可控 KV，覆盖合并、限频、新报告到达、失败/重启、旧投影和权限前置条件。集成脚本在临时目录创建全新的本地 DO、KV 和测试专用 harness，验证真正的 DO alarm → Worker renderer → DO publicRead / KV 链路；不加载生产 `.dev.vars`，不使用 `--remote`，结束后清理。CI 新增这两项检查，不添加部署流水线。

## 当前不做的事

保留 `ingestTail` 作为提交顺序与公开读屏障，不重写充电历史状态机，也不把整个 `cache.ts` 改到 KV。缓存中的原子闸门、短期错误缓存、令牌失效仍留在权威存储；KV 投影只覆盖登记过的公开读取流量。

官方语义：
- https://developers.cloudflare.com/kv/concepts/how-kv-works/
- https://developers.cloudflare.com/kv/api/write-key-value-pairs/
- https://developers.cloudflare.com/durable-objects/api/alarms/
