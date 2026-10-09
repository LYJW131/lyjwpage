# MCP Events

> 类型：reference

AI Worker 在现有 `/mcp` 上提供 webhook 事件订阅。公开工具继续无鉴权；事件发现、订阅、续期和取消要求专用 Bearer 凭据。事件对象只读取既有 `PUBLIC_STATUS`，不读取 StateHub 的内部表、不写入站点状态，也不运行模型或调度用户任务。

## 协议依据

按 2026-10-09 读取的 [OpenAI MCP Events 文档](https://developers.openai.com/plugins/build/mcp-events)实现 ChatGPT webhook profile：使用 MCP `2026-07-28`，支持发现、枚举、订阅、取消和签名回调验证；不提供 poll、stream、`gap` 或 `terminated`。协议仍在 [MCP Triggers and Events 工作组](https://modelcontextprotocol.io/community/working-groups/triggers-events)推进，草案不是已发布的完整核心协议。<!-- allow: 官方协议资料核对日期，用于识别草案兼容性依据 -->

事件错误采用 ChatGPT webhook profile 的编号组（`NotFound`、`Forbidden`、`ResourceExhausted`、`Unsupported`、`CallbackEndpointError` 对应 `-32011` 至 `-32015`），与 [改号前草案](https://github.com/modelcontextprotocol/experimental-ext-triggers-events/blob/6682596d65eec778fe0b8b1f43b4e89d2fe2c546/docs/design-sketch-proposal.md)一致。回调验证错误遵循 OpenAI 文档的 `-32015`；固定核对版本 [d5316be 的草案](https://github.com/modelcontextprotocol/experimental-ext-triggers-events/blob/d5316be214be2e76e51462069c1d67e00a5a7619/docs/design-sketch-proposal.md)使用 `-32027`，不把二者静默混用。其他不支持的传输或 replay 请求直接报错。服务器没有采用尚未支持这份扩展的 SDK schema 来宣称事件兼容性。

协议处理在 `workers/ai/src/mcp.ts#handleMcp`。现有工具的旧协议握手仍然可用；事件方法仅对现代协议开放。只有通过事件鉴权并具备事件对象绑定的连接，才在 `server/discover` 看见 `capabilities.events`。现代 discovery 和 `events/list` 返回私有、不可复用的缓存提示；匿名事件请求返回 HTTP 401 / `-32012`。

## 事件契约

目录的单一出处是 `workers/ai/src/mcp-event-catalog.ts#EVENT_DEFINITIONS`，事件名为 `watching-now`，对应公开视图 `/api/status/watching/now`。这是采样观察到的播放状态变化，不是 Emby 的源事件日志，也不承诺逐条捕获两次采样之间的变化。

订阅 `arguments` 可以省略或为 `{}`，也可以提供一个 `change` 字符串；未知字段、数组、对象值和 `null` 都不接受（`parseEventArguments`）。

| `change` | 检测到的变化 |
| --- | --- |
| `started` | 空闲变为有播放条目，包括首次看见已暂停的条目 |
| `changed` | 条目 ID 改变；同时变化的暂停状态不另发一条 |
| `paused` | 同一条目从播放变为暂停 |
| `resumed` | 同一条目从暂停变为播放 |
| `stopped` | 有播放条目变为空闲 |

每条通知的 `data` 只有下列字段（源：`workers/ai/src/mcp-event-catalog.ts#WatchingEventPayload`）：

| 字段 | 含义 |
| --- | --- |
| `change` | 上表中的变化类型 |
| `itemId` | 当前公开条目 ID；停止时为 `null` |
| `title` | 当前公开标题；缺少详情或停止时为 `null` |
| `paused` | 当前暂停状态；停止时为 `null` |
| `detectedAt` | 检测时刻的 Unix 毫秒，不是源播放发生时刻 |
| `sequence` | 对象持久化的递增变化序号；筛选、队列限额或失败可能造成缺号 |

变化指纹只包含 `itemId` 和 `paused`（`snapshotKey`）。进度、播放位置、心跳、封面、标题补全和设备信息不触发事件；通知不复制设备名、媒体路径、技术规格或凭据。标题始终是数据，不携带要求模型执行的指令。需要完整的当前公开模型时，调用 `get_site_status` 并传入 `views: ["nowWatching"]`。

`src/lib/emby-store.ts#resolveNowPlaying` 可以按播放时长推断空闲，所以 `stopped` 也可能来自公开视图的定时失效。外层 `timestamp` 和 `data.detectedAt` 都表示这次采样变化的检测时间。

## 采样、持久化与投递

`McpEventHub` 使用独立的 SQLite Durable Object。订阅、认证主体、回调地址、签名密钥、有效期、采样基线、序号和待投递正文均持久化；重启不会把它们变成新订阅。站点状态仍以 API Worker 为权威。

- 有有效订阅时按 `workers/ai/src/mcp-event-store.ts#MCP_EVENT_LIMITS` 的 `sampleMs` 采样公开视图。首次成功采样只建基线，不发送初始化事件；没有订阅时停止采样并清空基线，后续订阅重新建立基线。
- 非成功 HTTP、`ok:false`、解析失败或不合约的公开模型都保留旧基线，不把故障解释成停播。显式 `nowPlaying:null` 才是有效空闲快照。
- 检测到变化后，基线、序号和匹配订阅的 outbox 在同一 SQLite 事务更新。事件正文只序列化一次；重试复用相同 `eventId` 和字节，重新生成签名时间和签名。
- 每订阅按序尝试队首通知，不同订阅可并发。接收方仍须按 `eventId` 去重，并用 `sequence` 判断迟到通知；HTTP 响应丢失可以导致重复投递，网络不能提供恰好一次保证。
- 网络异常、超时、可重试状态码按有限退避重试；重试次数和窗口、每订阅待投递上限及并发量均取 `MCP_EVENT_LIMITS`。队列满时不再加入新通知，到达重试边界后丢弃该通知；接收方应读取当前状态恢复，不依赖事件作为历史账本。`410` 和 `413` 不重试。
- 没有历史补发或 replay：订阅结果与通知都带 `cursor:null`。不接受非空游标；合法的 `maxAgeMs` 在这种无 replay 的事件上忽略，不要求历史补发。

## 身份、有效期与回调

鉴权配置的解析与校验在 `workers/ai/src/mcp-event-auth.ts`：

| 配置 | 内容与边界 |
| --- | --- |
| `MCP_EVENT_CLIENTS` | JSON 数组，每项仅含 `principal` 和 `tokenSha256`；保存 Bearer token 的 SHA-256 小写十六进制摘要，不保存 token 原文 |
| `MCP_EVENT_CALLBACK_HOSTS` | 逗号分隔的精确小写回调主机名，不接受通配符、URL 或端口 |
| `MCP_EVENTS` | 指向 `McpEventHub` 的 Durable Object 绑定 |

这是供受信任插件连接使用的静态 Bearer 凭据，不是 OAuth 登录流程。默认缺少配置即关闭事件入口；无凭据的既有工具仍可用。部署管理员须为不同连接分配不同主体和凭据；共享同一主体的连接共享订阅命名空间。禁止把 token、签名密钥、完整回调 URL 或验证 challenge 写入日志、Sentry 或公开响应。

订阅 ID 由认证主体、回调 URL、事件名和规范化参数确定。同一身份重复订阅会续期；另一主体不能续期或取消该订阅。取消按同样的事件、参数和回调地址识别订阅，重复取消安全，并移除待投递项。移除允许主体或订阅到期后同样清理订阅和待投递项。

有效期、全局与每主体订阅上限取 `MCP_EVENT_LIMITS`。省略 `ttlMs` 使用默认时长；请求更长时长或无限期会受最大时长限制。客户端应在响应的 `refreshBefore` 前重发订阅续期。签名密钥轮换会重新验证回调，并在受限窗口内携带新旧密钥签名。

创建订阅前先验证 HTTPS 回调地址和签名密钥，再发一次无应用数据的签名 challenge；只在成功状态码及常量时间比较 challenge 通过后激活。验证缓存同时限定主体、回调 URL、密钥和时效，不能由别的主体复用。签名使用 Standard Webhooks 格式，验证和应用通知都经过同一出站安全检查。

## 出站边界与部署验证

回调地址必须通过主机白名单，并在每次连接时解析 DNS、拒绝非公网地址。连接固定到已验证 IP，以原始主机名做 TLS 校验，不跟随跳转。超时、响应大小和正文大小均有界；地址验证失败时关闭投递，不退回普通 `fetch` 绕过检查。实现见 `workers/ai/src/mcp-webhook.ts`。

[Cloudflare TCP socket](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)禁止连接 Cloudflare IP 段；如果接收端位于这些地址，出站连接会失败。固定 IP 连接再使用 `startTls({ expectedServerHostname })` 按运行时 API 合同保留原始 TLS 主机名；[workerd issue #6903](https://github.com/cloudflare/workerd/issues/6903)记录了 production edge 忽略该 SNI 选项的问题。核对于 2026-10-09，方式：读取官方 TCP socket 文档及公开 issue；本地成功不证明 edge 可用。<!-- allow: 运行时外部兼容性证据核对戳 -->

真实 ChatGPT 回调在部署环境中的 DNS、TLS 和网络可达性没有通过本地 mock 证明，不能把单元测试或配置完成称为 ChatGPT 端到端通过。生产接入前须使用获准的接收端验证回调 challenge、投递签名、续期与取消；网络不兼容时保持入口关闭。

启用需要追加部署 `McpEventHub` 的 DO 迁移与绑定，再配置管理员批准的主体摘要和精确回调主机。仓库不提供真实凭据或生产订阅；这些配置不应提交到 Git。Worker 发布遵循 [Workers 构建](./workers-builds.md)，不得用本地验证脚本代替发布或擅自配置生产回调。

## 本地检查

事件目录与筛选测试在 `workers/ai/src/mcp-event-catalog.test.ts`。订阅测试使用合成主体、时钟、状态和回调，验证持久化、隔离、续期、取消、失败重试和负例；出站测试以受控 DNS / socket 验证签名、回调证明和 SSRF 拒绝。真实 MCP 客户端要求见 [AI Worker MCP](../workers/ai/README.md#mcp)。

```sh
pnpm --dir workers/ai typecheck
pnpm --dir workers/ai test
pnpm exec eslint workers/ai/src
pnpm docs:check
node scripts/verify-api-worker.mjs --build --mcp-client --mcp-events
```

隔离集成脚本使用临时配置、本地状态和合成数据；不要为验证创建真实持久凭据、生产订阅或部署生产。真实 ChatGPT webhook 注册与投递仍需单独验收。
