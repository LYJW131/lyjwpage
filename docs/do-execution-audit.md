# API Worker 的 DO 执行边界审计

状态：本次边界调整已完成并通过本地隔离验证。实现以 `52bd3cb` 为审计基线；本文记录执行边界。后续的生产指标核验、本地 SQL 优化及性能基准见 [DO 性能审计](./do-performance-audit.md)。

## 判断标准

在保留现有 SQLite 存储的前提下，以下工作需要进入 DO：

1. 访问 DO 私有的 SQLite，以及在同一份最新状态上完成原子读、判断、更新。
2. 跨请求协调：刷新资格、任务领取与结果提交、持久队列和重试时刻。
3. 管理属于同一个房间的 WebSocket 连接、广播和连接数。

HTTP 参数处理、输入归一化、展示计算、第三方请求和结果解析，不因为最终使用 DO 存储就必须在 DO 内执行。依赖旧状态的计算应与原子更新一起保留；只依赖一份已确定快照的计算可以在 Worker 执行。

本次边界调整不需要新增 DO 类、迁移 SQLite 数据，或改变 DO 名称。目标是减少进入 DO 的业务执行内容；不是让所有请求都不再访问 DO，也不能据此承诺性能提升。

平台依据：[Cloudflare 的 Worker / DO 职责划分](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)、[内部执行入口使用 Service Bindings](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/#use-service-bindings-for-worker-to-worker-communication)。下文的当前行为以本仓库代码为准。

## 实际执行边界

| 入口 | DO 内保留 | 普通 Worker 执行 |
| --- | --- | --- |
| 公开 HTTP | `publicBarrier()` 等待已经进入 StateHub `commitIngest()` 队列的提交，`publicRead()` 同步执行有界只读批次 | 已知路由、CORS、`publicResponse()`、首页聚合、展示计算、第三方请求、歌词和动态封面；未知路径直接 404 |
| 上报 | `commitIngest()` 同时检查初始化状态，并串行完成依赖最新状态的合并、差分、去重和持久化，再收集可序列化 effects | 鉴权、请求体读取、输入归一化、Emby R2 HEAD；只有输入准备失败时才补查初始化状态以保留 503 优先级；提交后补充 Apple 目录、广播和缓存通知 |
| 通用存储 | 同一命令 batch 的 SQLite 事务；首尾列表查询直接按索引读范围，尾部裁剪按实际 seq 边界删除；写入仍唤起 Alarm | 请求内相邻只读 batch 按 128 条协议上限合并，写 batch 保持调用顺序和原事务边界 |
| Pulse 评分 | claim / generation / 180 秒 lease、固定输入快照、提交资格和按窗口合并 | 特征与哈希、Jev 请求和结果解析；由 cron `await`，不挂 HTTP 后台窗口 |
| Pulse 归档 | 六域有界读取、每域水位、成功确认按 max 单调推进 | D1 `INSERT OR IGNORE` 分批写入和逐域失败处理 |
| KV 发布 | 持久队列、revision、重试 Alarm、TTL 清理和最终 KV 单写者 | 同部署 `ReadModelRenderer` 生成公开 JSON；显式 Service Binding，不经公网 |
| 导入 | 空键导入、过期时间、初始化标记、初始化后任务入队 | HTTP 鉴权和有界请求读取 |
| `LivePushRoom` | WebSocket 接入、连接存活、广播和人数 | 本地中继的假数据查询经内部 renderer 执行，不再调用 StateHub 公开路由 |

主要调用点位于 `workers/api/src/origin-worker.ts`、`index.ts`、`storage-driver.ts` 和 `live-platform.ts`。

`LivePushRoom` 的本地开发上游 WebSocket 中继依赖房间连接生命周期，可以继续由房间管理。这里不能套用“所有外部请求都必须移出 DO”：持久连接本来就属于房间职责。中继读取本地假数据时，不需要再让 StateHub 执行完整 HTTP 路由。

## 上报内部需要的最小协调范围

| 来源 / 数据 | 需要一起协调的部分 | 无需把完整流程放进 DO 的部分 |
| --- | --- | --- |
| Mac | 存活与模块状态、图标映射合并、充电历史去重与追加、收敛窗口、Pulse / Coding 观测、token 用量的新旧判断，以及依赖本次提交快照的少量同步事件输入 | 信封和模块归一化、Apple 目录装饰与网络通知 |
| iPhone 活动 | 读取上一份活动快照，与新快照计算有界活动区间，再保存相关状态与样本 | 字段校验、数值归一化 |
| iPhone 训练 | 整份快照替换 | 训练校验、去重检查、排序；不需要额外包住完整训练处理器的独占流程 |
| HomePod | 保存新快照，结合已存 Mac 状态记录在听样本；样本追加本身需要去重 | 报文归一化、曲目目录查询、对公开在听结果的装饰 |
| Emby | 用最新图片映射合并已确认对象键、保存播放与续播状态、追加在看样本 | R2 存在性检查、纯字段与标题处理；检查完成后必须重新读取最新映射再合并 |
| PlayStation | 保存 presence / power 等状态、形成相关状态快照、追加 Gaming 样本 | 报文和奖杯归一化、对完整快照的展示处理 |
| Server | 在同一个 `commitIngest()` 串行段读取旧快照、判断展示变化并替换新快照 | 指标归一化、提交后的标签通知 |
| Agents | 根据最新字典按 id 合并限额 | 上报校验、字段归一化、提交后的标签通知 |

`pickNowListening()` 本身是纯选择函数。为了记录 Pulse 而使用最新的相关状态，与把公开播放结果组装成响应，是不同的执行需求。

## 已实现的接口边界

### 公开读取

Worker 负责 HTTP 路由和响应；`executePublicRequest()` 先过 StateHub 的初始化/可见性屏障，再为该请求创建独立的只读合并器。每个 RPC 批次是一个一致性边界；并发 loader 的相邻读取合并，依赖前一结果的后续读取进入下一批。写入前先封口待提交读取，因此 `read → write → read` 不会调序。

屏障的边界是已经进入 StateHub `commitIngest()` 队列的提交。普通 Worker 仍在执行输入准备或 Emby R2 HEAD 的请求尚未进入该队列，此时公开读取旧状态是预期行为；该上报也尚未返回 202。提交进入队列后，`publicBarrier()` 会等待它完成；202 之后经过 StateHub 的权威读取可以看到已持久化结果，部分失败已经落库的状态也遵守同一边界。四条 KV 投影路径仍是最终一致：命中有效投影时可以先返回较早 revision，再按刷新间隔和最大年龄收敛。

已知不存在的路由可以在普通 Worker 返回 404，不必为路由匹配访问状态对象。有效 KV 命中、MusicKit token 签发、鉴权、CORS 和请求体读取，当前已经在普通 Worker。

### 上报提交与通知

流程为：Worker 准备输入及完成外部检查 → DO 按最新状态提交变更并返回初始化状态 → Worker 执行通知。合法上报不单独调用 `ready()`，热路径只有一次 StateHub RPC；输入准备失败时才补查 `ready()`，因此未初始化环境仍优先返回 503，已初始化环境仍返回 400。

DO 返回提交结果和必要的事件输入。需要 Apple 目录补充的在听事件应携带本次提交对应的播放输入，避免后台再读“当前状态”时串入下一次上报的曲目。Vercel 标签失效和向 LivePushRoom 发起广播在 Worker 执行；实际 WebSocket 广播保留在 LivePushRoom。

必须保留现有的部分成功语义：Mac 的某些模块校验失败前，存活或其他状态可能已经写入。不能为了前置所有校验，意外把这些已约定的更新和通知取消。iPhone 多模块上报也要保留已开始写入部分的完成保证。只有持久化确认后才能返回上报成功。

### Pulse 评分

不能只把实例内的 `running` 变量搬到普通 Worker：多个 Worker 实例不共享它。由 DO 原子领取任务并记录提交资格，Worker 处理输入与调用模型，再向 DO 提交结果。DO 拒绝失去资格的旧任务，并按窗口合并结果，避免用计算开始时的整份旧列表覆盖后来完成的评分。

长评分继续走定时任务执行链，不挂到普通 HTTP 响应后的短后台窗口上。任务状态和失败后的重试依据必须持久化。

### D1 归档

Worker 从 DO 获取待归档数据，分批写入 D1，仅在该批成功后确认水位。水位更新取已确认进度的最大值，不能被晚到的旧确认倒退。

现有 D1 主键与 `INSERT OR IGNORE` 已使重复写入幂等；不需要为正确性给整段归档增加独占锁。避免重复工作的措施可以另外评估，但不应当作迁移的硬性前提。

### KV 视图发布

DO 保留队列、修订号、Alarm 重试和最终 KV 发布。JSON 生成交给普通 Worker 的内部执行入口，不经过公开互联网，不要求增加新的部署单元。

不要把最终 KV 写入直接交给多个 Worker：仅在写前检查修订号，无法阻止检查通过后变慢的旧任务最后覆盖新结果。保留一个受协调的发布者，生成期间收到的新上报仍应保持待发布状态。

## 验证结果

初始基线为 64 项 Worker 单测。实施后新增批量读取、评分/归档协调、上报边界和原子开发 override 覆盖。两条隔离脚本不连接生产服务或使用生产凭据；根构建仍需要显式提供公开后端地址。

已验证：

- 未初始化的已知公开路由和合法上报返回 503；未知路由在普通 Worker 返回 404。
- StateHub 已接收的 `commitIngest()` 会被公开屏障等待，上报只在持久化完成后返回 202；Mac / iPhone 的部分提交由定向上报边界测试覆盖。
- desktop / timezone / music 的通知与遥测主状态提交绑定；后续模块失败时不广播未落库的新值，已独立落库的 presence / charger / workouts 仍可通知。
- Emby R2 准备在普通 Worker 执行；提交时重新基于最新图片映射合并。
- 公开请求内相邻只读批次按 128 条上限合并并正确切分结果；`read → write → read` 顺序和写 batch 的原事务边界保持不变。
- 评分测试覆盖 claim、generation、lease 与过期提交；归档测试覆盖失败隔离和确认水位单调推进。
- 读模型测试覆盖队列合并、revision、失败重试、过龄投影和 KV 单写者。
- API Worker 类型检查通过，Worker 单测 82 项、根单测 312 项通过。
- `scripts/verify-api-worker.mjs` 通过初始化 503、未知路由 404、并发 override 索引、上报、WebSocket、CORS、重启持久化等隔离链路。
- `scripts/verify-kv-read-model.mjs` 在 Wrangler 3.114.17 / compatibility date 2025-02-14 下实际完成 `StateHub alarm → self Service Binding → ReadModelRenderer → StateHub publicRead → KV`，没有循环等待。
- production/test TOML 已解析；生产 custom domain route 保持顶层。生产配置 `wrangler deploy --dry-run` 打包成功并识别 `api#ReadModelRenderer`。

根类型检查通过。首次直接运行 `pnpm build` 在预渲染阶段因未设置必需的 `NEXT_PUBLIC_BACKEND_URL` 停止；有效验收随后通过 `node scripts/verify-api-worker.mjs --build` 完成，构建期后端和在线人数源都指向脚本内已初始化的隔离 Worker，生产构建成功且未使用生产后端或凭据。部署后的平台状态不在本地验证范围内。
