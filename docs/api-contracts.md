# API 命名与跨端契约

> 类型：reference

这些约定由主站、`reporters/` 下的相关上报器、MacTelemetryHub 和 Home Assistant 共用。新增或修改端点、字段前，先定位对应的数据生产者、接收端、消费者和推送事件。

| 对象 | 约定 | 示例 / 边界 |
| --- | --- | --- |
| 上报入口 | `/api/ingest/<来源>`，来源按数据归属命名，不使用上报程序名；仅由 `workers/ingress` 接收，站点不提供上报路由、rewrite 或转发 | 来源清单是 `shared/ingest/prepare.ts#INGEST_SOURCES`（另有 `/api/ingest/agents/otlp`）；校验在 `shared/ingest/`，实时那一半经 Service Binding 交给 `workers/core` 的 `StateCore.commitIngest` |
| 设备遥测 | 一台设备一个入口、一个信封、一个 `modules` 字典 | 充电头归观测它的 `mac`；活动圆环归搬运和观测它的 `iphone`，不按品牌或模块另开入口 |
| 账号限额 | coding agent 的账号套餐和限额统一归 `agents` | 厂商账号事实不归某台 Mac，也不按采集容器命名 |
| 上报鉴权 | 走 `ingest.homepage.lyjw.llc`，每个上报方一把 Cloudflare Access service token（同一上报方管多个来源时共用一把），上报入口按 `workers/ingress/wrangler.toml#ACCESS_CLIENTS` 限定可写来源 | 新上报方要新建 token、加进 Access 策略并登记 client id；改这张表要同步 Access 策略，两边不一致会拦住上报；不再让一把凭据通吃所有来源 |
| 状态查询 | `/api/status/X` 表示列表 / 历史，`/api/status/X/now` 表示此刻 | `listening` + `listening/now`，`watching` + `watching/now`；两者同时存在时成对命名 |
| 推送事件 | 跟随状态 URL，`/` 替换为 `-` | 列表为 `X`，此刻为 `X-now`；事件和端点含义一致 |
| 大小写 | URL 段全小写，JSON 字段 camelCase | `/api/status/powerbank` 与视图键 `powerBank` 各守其约定 |
| 跨来源字段 | 同一概念同名、同单位，单位写进字段名 | Mac / HomePod 的 `LocalNowPlaying` 共用 `positionMs`、`durationMs`、`repeatOne`、`observedAt`；`observedAt` 为 epoch 毫秒，秒转毫秒在上报侧完成 |
| 图片键 | R2 内容地址使用 `objectKey`，来源侧键用明确名称 | `posterKey`、`backdropKey`、`iconHash`，避免含义不明的 `key` |

设计契约：同一类数据可以有多个来源。来源只上报自己观测到的原始事实；合并、去重、排名等派生量在站点侧一处计算。消费者不关心数据来自哪个上报器，新增来源只加生产者和入口校验，不改消费者。例：coding agent 的 token 用量来自 Mac、Claude Code 云端和容器里的 Cursor；gaming 泳道同时有 PlayStation 与 Quest。

改动完成的标准见根 [`AGENTS.md`](../AGENTS.md)「变更完成条件」。
