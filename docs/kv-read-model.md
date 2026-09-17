# KV 公开读取投影

本层可选启用：**DO SQLite 是唯一权威状态，KV 是可删除、可重建的公开结果投影**。没有 `READ_MODEL` binding 时行为不变。它不是把内部 `StorageClient` 换成 KV，也不把所有 GET 都当缓存。

## 请求边界

| 路径 | 读取位置 | 发布最小间隔 / 投影最大年龄 |
| --- | --- | --- |
| `/api/home` | KV 首屏快照；挂载后的实时卡片仍回 DO | 60 秒 / 180 秒 |
| `/api/status/listening`、`watching`、`playing` | KV；该页收到相应推送后改回 DO | 60 秒 / 180 秒 |
| `trophies`、`vibecoding/year`、`github-chart`、`github-repo`、`cloudflare-workers`、`vercel-deployments` | KV | 300 秒 / 600 秒 |
| 所有 `*/now`、`desktop`、`server`、`activity`、`charger`、`powerbank`、`vibecoding` | DO；包含存活、日界线、暂停宽限期或增量历史语义 | 不经 KV |
| `/ws`、`/count`、上报、MusicKit token、歌词/动态封面 | 原路径 | 不经 KV |
| 任意带查询参数的请求 | 原路径，包括 `since`、筛选参数和 `fresh=1` | 不经 KV |

表中简写均位于 `/api/status/` 下。所有 KV 响应继续使用 `Cache-Control: no-store`，避免再叠浏览器 HTTP 缓存；KV 自己使用 60 秒读取缓存。`X-Fetched-At` 是投影开始生成的时刻，不伪装成本次请求时刻。`X-Read-Model: kv | origin` 标识可缓存端点命中还是回源。

`/api/home` 只承担 SSR bootstrap，不承诺实时。现有 `useStatus` 对实时卡片在挂载时重新取数，不能把它关闭。午夜边界、掉线、暂停后过期等需要重新计算的独立端点仍直读 DO。

## 写入与恢复

1. 上报继续在 StateHub 确认权威写入，LivePushRoom 的连接、计数、广播协议不变。
2. 上报完成（包括已经部分写入而最终报错）仅在 SQLite 中标记受影响的公开路径。**不在上报队列里等待 KV put 或重建公开响应**。
3. 每分钟已有 cron 也标记全部公开路径，覆盖 Apple 最近播放、外部查询缓存、只随时间变化的视图，以及给已有 DO 新增 KV binding 的首次回填。标记在原 cron（最近播放刷新、PageSpeed）写完之后才入队，listening 投影总是按刷新后的列表生成。
4. DO alarm 从 `public_read_model_jobs` 取到期项，调用现有公开 API 生成结果，每轮最多处理三个；单次生成 15 秒超时，挂起的外部请求不会拖住同一 alarm 里的 TTL 清扫。策略表里已删除的路径若还留有旧行，flush 时直接删掉，不让 alarm 空转。只有这个对象向对应 KV 键发布；边缘读 miss 仅请求补建，绝不把自己先前读到的旧响应回写 KV。
5. 重复标记合并，不把截止时间不断推后；每键最小间隔 60 或 300 秒。网络调用前、结束后均持久化冷却期限，避免慢请求、重启或不确定写入后立即再写同键。
6. 发布只确认其捕获的 revision；生成或 KV put 期间收到的新上报仍保留 dirty。失败保留队列并由 alarm 重试，不依赖 JS `setTimeout` 或下一位访客。失败不会把已确认的上报改成失败。

KV 值只包含版本、公开路径、生成时间及公开 JSON 正文，不复制 CORS、凭据或任意存储键。非 200、非 JSON、单条 `ok:false`、过大或生成期间已经过龄的结果不发布；首页允许各卡片独立降级。投影版本为 `public-read-model:v1`，改变序列化契约时升版本。

KV miss、负缓存、旧 schema、错误正文、过龄值、异常和超过一秒的读取均回 DO。最大年龄是**本代码主动拒绝过旧投影的规则**，不是 KV 传播时延的保证，也不是底层数据源的新鲜度保证。

### 推送不会被 KV 旧值覆盖

现有 `rememberPushed()` 继续做时间戳防乱序，同时调用 `markLiveRead(path)`。页面生命周期内，该路径通过 `backendUrl()` 发出的实际 URL 增加 `fresh=1`，直读权威数据；SWR 缓存键不变。Emby/PlayStation 没有可比时间戳的列表同样受保护，错误响应不会清掉此标记。

这有明确取舍：活跃页面收到某类推送后，该类轮询不再从 KV 获益。比虚构一套不完备的版本一致性协议安全；实时端点从一开始就不经 KV。断线期间的即时事件不由 KV 保证补发，现有挂载、焦点和轮询读取仍需保留。

## 启用与回滚

生产 binding 已写在 `workers/api/wrangler.toml`：命名空间 `api-READ_MODEL`（用项目安装的 Wrangler 3 创建，`wrangler kv namespace create READ_MODEL`），binding 名 `READ_MODEL`。合并到 `main` 即随 Workers Builds 启用，不迁移 DO，也不改 DO 身份。

`wrangler.test.toml` 与本地 `.dev.vars` 环境不配这个 binding：生产、预览和本地测试不能共享一个可写 namespace，多个 StateHub 写同一前缀会破坏单写者假设。隔离脚本 `scripts/verify-kv-read-model.mjs` 用本地 `wrangler dev` 的临时持久化目录模拟 KV，不碰真实命名空间。

本地 `.dev.vars` 的 `DEV_OVERRIDES=true` 或非空 `UPSTREAM_API_URL` 会同时禁用读取和发布，防止夹具或上游 overlay 污染共享投影。真实混合链路的本地验证使用下方隔离脚本。

启用后先确认 `/api/status/watching?fresh=1` 原路径正常，待 cron/alarm 回填后，无参数查询应返回 `X-Read-Model: kv`。验证 `/ws`、`/count`、`*/now`、增量请求和 CORS 未改变。KV 长期不可用时会增加 DO 回源，检查 `[read-model]` 日志和命中头，不以“上报成功”推断投影健康。

移除 `READ_MODEL` binding 并走现有 Git 发布即回滚到纯 DO 读取；SQLite 权威数据和 DO 身份不变。KV 可删除后重建，队列由 cron 重新驱动，无需反向导入数据。

## 验证

```sh
pnpm --filter @lyjwpage/api test
pnpm test
pnpm -r --include-workspace-root typecheck
node scripts/verify-kv-read-model.mjs
```

新增单测用真实 Node SQLite 与可控 KV，覆盖合并、限频、新报告到达、失败/重启、旧投影和权限前置条件。集成脚本在临时目录创建全新的本地 DO、KV 和测试专用 harness，验证真正的 Worker → DO alarm → KV → Worker 链路；不加载生产 `.dev.vars`，不使用 `--remote`，结束后清理。CI 新增这两项检查，不添加部署流水线。

## 当前不做的事

不删除既有 `ingestTail`，不重写充电历史状态机，不迁移 `claim()` 或原始字典合并，也不把整个 `cache.ts` 改到 KV。缓存中的原子闸门、短期错误缓存、令牌失效需要独立设计；本改动只移出公开读取流量，避免把两类迁移风险叠在一起。

官方语义：
- https://developers.cloudflare.com/kv/concepts/how-kv-works/
- https://developers.cloudflare.com/kv/api/write-key-value-pairs/
- https://developers.cloudflare.com/durable-objects/api/alarms/
