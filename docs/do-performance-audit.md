# DO 优化线上效果核验

核验时间：2026-09-22，UTC+8。结论：`04edf60` 已有效降低 StateHub 的 CPU 与活跃时长，原有执行边界调整应保留。它增加了 RPC 往返，部分计算转移到了普通 Worker；现有证据不足以称为整体计算成本下降或所有接口全面提速。

## 生产版本与观察窗口

Cloudflare MCP 核实 Workers Builds `31dfef59-f33f-492b-a60a-a9a8894fc992` 构建成功，对应提交 `04edf6087dc9fb7b93d58109d9070882fcb7f5ef`。生产部署于 **2026-09-22 06:17:44 UTC+8** 完成，版本 `fc59fa87-ed5a-4982-acd8-b50e24567dd3` 承接 100% 流量；之前的版本为 `b0ddad1e-8b61-4f75-87c7-195c8f3ad318`。

比较同为 10 分钟、避开部署过程的窗口：

- 优化前：2026-09-22 **06:05–06:15 UTC+8**。
- 优化后：2026-09-22 **06:20–06:30 UTC+8**。

指标由 Cloudflare MCP 调用 GraphQL Analytics API 取得，限定 `api_StateHub` 命名空间 `08a6c22e048d4a9b915ba869ad40ffee`。原始聚合、完整 GraphQL 查询、日志摘要及运行核验保存在 [证据 JSON](./do-performance-evidence.json)。这两个窗口均早于本任务首次主动调用生产状态 API（06:32），不包含本任务的 API 探测流量。

## 指标结果

| 指标（每个 10 分钟窗口） | 优化前 | 优化后 | 变化 |
| --- | ---: | ---: | ---: |
| StateHub CPU | 982.967 ms | 572.235 ms | **-41.8%** |
| StateHub activeTime | 150.701 s | 34.428 s | **-77.2%** |
| StateHub duration | 19.290 GB-s | 4.407 GB-s | **-77.2%** |
| StateHub 调用量（自适应估计） | 133 | 360 | +170.7% |
| StateHub SQL rowsRead | 670,253 | 902,998 | +34.7% |
| StateHub SQL rowsWritten | 15,069 | 15,367 | +2.0% |
| StateHub subrequests | 78 | 0 | 外部执行已移走 |
| StateHub 错误 / CPU、内存超限 | 0 | 0 | 未出现异常 |
| 普通 api Worker 调用量（自适应估计） | 97 | 144 | +48.5% |
| 普通 api Worker CPU | 96.701 ms | 1,011.132 ms | 计算转移到 Worker |

流量结构发生变化：日志中 Mac 上报从 27 次增加到 37 次，公开查询的种类和次数也更多，因此不能直接把所有变化归因于代码。虽然请求增加，DO CPU 与活跃时长仍显著下降，且 DO 内的评分、归档、通知执行已由日志确认离开，支持“StateHub 减负有效”的判断。

将普通 Worker 和 StateHub 的 CPU 相加，分别约为 **1.080 s、1.583 s**，增长 46.7%。按 Worker 调用数粗略摊分约为 **11.13 ms、11.00 ms**，基本持平；这是混合负载归一化，不是同一请求类型的对照实验，不能据此承诺整体 CPU 节省。总 SQL 读取增长也小于 Worker 调用量增长，不能单凭总行数称为存储回归。

## 指标口径与限制

- GraphQL 的 invocation 数据采用自适应采样。本次 StateHub 平均采样间隔约 1.03 / 1.28，Worker 约 1.23 / 1.25；调用数和分位数应视为估计值。Periodic CPU、activeTime、duration 使用对应周期聚合，不能把不同数据集的记录数硬凑成同一总数。
- Worker 的 `wallTimeMs` 包含 `waitUntil()` 的响应后工作。上报通知移入 Worker 后，Worker Wall time 变长本身不证明上报响应变慢。[Cloudflare 字段定义](https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/account/workers_trace_events/#walltimems)
- `duration` 为 GB-s 用量，不能直接当成最终账单金额；实际账单还取决于请求、存储和套餐额度。
- 内存指标是整个 isolate 的采样，不能当成单个 DO 独占内存。日志中的整数毫秒 CPU 会舍去亚毫秒细节，CPU 总量判断以 GraphQL 周期数据为主。[DO 指标说明](https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/)
- 这是发布后短窗口实测，未做控制流量压测。HTTP 请求时长 P50 约 35.0 → 38.5 ms、P95 274.0 → 481.2 ms，来源为混合请求；没有足够的相同路径样本证明所有端点提速。

## 行为核验

Cloudflare MCP 读取当前配置确认：StateHub 仍使用原 SQLite 命名空间，`READ_MODEL_RENDERER` 指向同一部署的 `api#ReadModelRenderer`；持久日志开启且采样率为 1，未为审计更改生产配置。

Workers Logs 的原始 invocation 记录按窗口分别取回 **264 / 545** 条，均未触及 2,000 条查询上限。优化后有 10 次 cron、7 次 StateHub Alarm、8 次 renderer 事件；StateHub 事件均为 `ok`。06:18–06:36 的 `api` warn/error 日志查询为空。WebSocket 的取消 / 断流单独出现，不作为 DO 业务异常计数。

生产 API 探测中，受影响的状态、首页聚合和连接数均返回 200。四个 KV 视图（vibecoding/year、github-chart、github-repo、vercel-deployments）均命中 KV，生成时间已推进至 **06:38 UTC+8**。Pulse 状态返回正常。MCP 对 D1 仅执行只读查询，确认部署后有新增归档：coding 6 条、listening 5 条、gaming 1 条、charging 31 条；watching、activity 该时段无新样本，不能据此声称这两个来源产生了新数据。

## 首轮本地追加优化

生产日志定位到：优化后 10 分钟内，44 次合法上报分别触发一次 `ready()` 和一次 `commitIngest()`。后者本身已经检查就绪状态，前置 `ready()` 是正常路径上的重复远程调用。

本轮由 GPT-5.6 Sol 实现以下最小调整：合法输入准备成功后直接提交，依靠提交结果的 `ready` 决定是否返回 503；仅在输入准备失败时查询 `ready()`，保留“未初始化优先 503，已初始化非法输入 400”的行为。合法上报由两次 StateHub RPC 降为一次，202 仍需等待持久化完成。没有把提交 / RPC 故障放入准备失败的兜底分支，避免用后续就绪查询覆盖原错误。

公开读取的可见性屏障、逐批一致性、评分租期、归档确认、KV 单写者与 TTL 清理维持既有契约。

首轮共享 SQL 调整了 `listRange` 的非负范围分支，让 `LIMIT/OFFSET` 自然截断范围，跳过确定总长度的 `COUNT(*)`。当时保留了负索引算法；下面的持续优化继续覆盖了高频首尾读取和尾部裁剪。首轮临时 SQL 探针在 6,000 行读取 `[0, 599]` 时，从 6,600 行降为 600 行；该探针未计 `entries` 检查。后续完整存储基准将检查也计入，因此相同场景为 6,601 → 601。两者口径不同，均不能代表整个生产 Worker 的百分比收益。

## 首轮追加修改的验证与发布状态

- API Worker 类型检查通过。
- Worker 测试 **84 / 84** 通过，包括合法输入不调用 `ready()`、非法输入的初始化错误优先级，以及列表边界。
- 主站 / 共享库测试 **313 / 313** 通过。
- `node scripts/verify-api-worker.mjs` 隔离验证通过：合法 / 非法输入在已初始化 / 未初始化状态的响应、上报持久化、WebSocket、缓存通知、重启持久化等行为均通过。
- 修改文件的 ESLint 与 `git diff --check` 通过。
- 首轮验证时，所有追加修改均为**本地未提交、未推送、未部署**，线上版本为本报告评估的 `04edf60`。最终提交与发布状态见文末；上表的生产收益不能当作追加修改的生产实测结果。

## 复查入口

- [对应 Worker 构建](https://dash.cloudflare.com/209f2c881b1c494fec50851c067b3266/workers/services/view/api/production/builds/31dfef59-f33f-492b-a60a-a9a8894fc992)
- [Cloudflare DO 指标与 GraphQL 数据集](https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/)
- [Cloudflare DO 与普通 Worker 的职责建议](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- [SQLite 游标的 rowsRead 定义](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#sql-api)

后续部署追加修改时，应比较新版本的合法上报调用链、每次上报的 DO RPC 数、相同窗口的 CPU / duration / SQL rowsRead，并继续验证 202、初始化 503、KV 发布和归档。不要将本地验证结果当成追加修改已经改善生产指标。

## 持续核验与代码质量判断

用户要求继续优化后，MCP 再次核对 **07:05–07:15 UTC+8** 窗口：生产仍为同一版本，StateHub CPU **398.400 ms**、activeTime **28.646 s**、SQL rowsRead **635,060**；调用估计 221 次，无业务错误或 CPU / 内存超限。普通 Worker 调用估计 76 次、CPU 298.101 ms。此窗口流量与上文不同，只证明当前版本继续稳定，不能作为本地追加修改的收益。

原始日志 338 条，与 API 报告总数一致且低于 2,000 条上限。按每条事件去重 RPC 方法后，32 条 `commitIngest` 事件占日志 CPU 166 ms，10 条 `readPulseArchive` 占 71 ms，1 条 `finishPulseScore` 占 73 ms；18 条 `publicRead` 仅占 2 ms。日志 CPU 以整数毫秒表示，只用于热点排序，不代替周期 CPU 指标。新窗口的查询和汇总已加入证据 JSON 的 `continuedAudit`。

### 质量结论与优化边界

当前 Worker / DO 的职责划分清楚，核心协调代码可维护；本次审查没有发现需要扩大为架构重写的阻断问题。单个 StateHub 对应同一站点所有者的相关状态，在当前负载下没有证据需要分片。这个判断限定于本次 DO、存储和调用边界审查，并非整个仓库的全面质量认证。

- 持久化完成才返回 202；模块部分失败仍保留已经提交的状态及对应通知。
- SQLite 仍是权威状态。公开读取屏障、评分 generation / lease、归档水位取最大值、KV 最终单写者都有对应回归测试。
- 同步 SQL 游标在 `await` 前全部消费，没有把未消费游标带出事务；符合 [Cloudflare 的游标与事务要求](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#exec)。
- 主要剩余浪费来自通用列表实现：取最后一项和取完整列表都先做 `COUNT`，尾部裁剪又计数并用 `NOT IN` 检查保留集合。应优先利用现有 `(key, seq)` 主键，不改存储契约。

没有采用持久列表长度缓存：虽然可消除 `append` 为返回准确长度而执行的 `COUNT`，但会增加一份所有写入、导入、裁剪及回滚都必须维护的派生状态。也没有采用事务内 entry 缓存，其收益只是少量主键读取，却增加失效规则。这两项在当前负载下不值得增加维护成本。

本轮停止条件为：高频范围查询去掉不必要计数；裁剪有可重复的扫描量收益；结果、TTL、类型检查及回滚语义不变；必要回归和隔离链路通过。不会以增加缓存、取消一致性检查或持续改架构来追求未测得的收益。

### 两轮本地优化与可重复基准

实现由 `gpt-5.6-sol` 完成，主 Agent 复核代码、独立检查范围语义并汇总证据。

第一轮使用现有 `(key, seq)` 索引直接读取正向范围、完整尾段，以及倒序选取负索引范围后恢复正序；其余混合范围保持原有计数算法。第二轮为 `trim(-N, -1)` 找到第 N 新的实际序号，按边界删除更旧的行；短列表保持原内容，空列表 entry 仍删除。没有假定序号连续，没有新增表、迁移或缓存。

基准在独立临时配置的本地 Wrangler / workerd SQLite DO 中运行，实际实例化基线与工作区的 `SqliteStore`。计数包含 `entries` 的类型与 TTL 检查；初始化、种子数据和结果检查不计入。读取重复 5 轮，写循环重复 100 轮。以游标完全消费后的 `rowsRead` / `rowsWritten` 为依据；不把冻结时钟或宿主请求耗时当成生产 CPU / HTTP 延迟。

| 场景（6,000 行，每轮） | `04edf60` rowsRead | 工作区 rowsRead | 下降 |
| --- | ---: | ---: | ---: |
| 读取全部 `[0, -1]` | 12,001 | 6,001 | 50.00% |
| 读取末条 `[-1, -1]` | 12,001 | 2 | 99.98% |
| 读取末 2,000 条 | 12,001 | 2,001 | 83.33% |
| 读取前 600 条 | 6,601 | 601 | 90.90% |
| 追加、保留末 6,000 条、续期 | 24,012 | 12,009 | 49.99% |
| 末条读取 + 追加、裁剪、续期 | 36,013 | 12,011 | **66.65%** |

100 轮完整采样存储循环合计 **3,601,300 → 1,201,100 rowsRead**；写入均为 500 行，SQL 语句数 1,300 → 1,200。各轮返回值摘要、最终列表摘要和最终 `expires_at` 都相同。2,000 行保留窗口及序号断档场景也通过等价检查。

这里的“完整采样存储循环”指 `listRange(-1,-1)` 加 `append / trim / expire` 的存储路径，不包括整个 Mac HTTP 上报、通知或网络耗时。结果证明存储算法收益，不能当成新增修改已降低生产 CPU 66.65%。

可复跑命令：

```sh
node scripts/benchmark-do-storage.mjs --ref 04edf6087dc9fb7b93d58109d9070882fcb7f5ef --rows 6000 --rounds 5 --write-rounds 100
```

环境为 Node v26.7.0、Wrangler 3.114.17、compatibility date 2025-02-14。脚本不读取真实 `.dev.vars` 或使用生产绑定，运行后删除临时配置与数据。证据分别为 [读取轮](./do-storage-benchmark-read.json) 和 [最终轮](./do-storage-benchmark-final.json)，记录完整基线提交、参数和工作区 `SqliteStore` SHA-256；最终源码哈希已独立核对一致。

### 最终验证与停止判断

- 独立范围矩阵 **48,074** 组、裁剪矩阵 **19,220** 组通过，覆盖正负索引、越界、极值、序号断档、空 entry 删除、TTL 保持和其他 key 隔离。
- Worker 类型检查、**87 / 87** Worker 测试、**316 / 316** 主站与共享库测试通过。
- 修改文件的 ESLint、基准脚本语法检查和 `git diff --check` 通过。
- `verify-api-worker.mjs` 隔离链路通过；`verify-kv-read-model.mjs` 确认上报、DO Alarm、内部 renderer、KV、边缘命中及故障回退正常。

本地版本在当前规模下已达到合理的性能与代码质量平衡：高频末条读取只扫描结果及 entry，完整列表去掉重复扫描，采样存储循环降低约三分之二扫描量。保留的 `append COUNT` 负责准确返回长度，尾部裁剪仍需扫描到保留边界。继续消除这些成本需要新增派生状态或改变契约，目前没有相称的收益证据，停止继续扩大实现。

本任务的修改按用户要求仅提交至独立工作树的 `codex/do-storage-performance` 分支，未推送、未部署。收尾发现其他任务已在 **07:26:52 UTC+8** 部署 `dcc79d1`（desktop `windowTitle`），版本 `4ba46667-1c91-4644-9a73-5303e5269a1c` 接管 100% 流量。它没有修改本轮优化的 SQLite、RPC 入口或 StateHub 文件。上述生产性能窗口均早于此部署，版本和本地基准严格区分；不把这个外部发布归为本任务成果。

07:30–07:35 的 MCP 日志核对返回完整 314 条调用，全部属于这个新生产版本且 outcome 为 `ok`（StateHub 181 条），可见 HTTP 状态为 200 / 202。该检查只证明新版本当前调用正常，不用于计算本地优化收益。

随后在独立临时 worktree 把本轮补丁叠加到已获取的最新主分支 `757ac6e10d7c6c744931267a22811ccd02210491`，Worker 类型检查及 **92 / 92** 测试通过，包含新增的 5 条窗口标题测试。生产文件无合并冲突；`ingest-boundary.test.ts` 的相邻 import 需同时保留双方新增导入，测试正文均完整保留。临时 worktree 与目录已清理，当前工作区仍基于 `04edf60`，没有在这里隐式更新分支或发布。
