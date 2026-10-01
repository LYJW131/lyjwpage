# 交接：上报回执 202 → 200，图片改为上报器自带 objectKey

临时交接文件，合进 main 前删掉。分支 `claude/202-response-timing-fo5da1`，基于 main `5d7fa74`。
这份交接只做了调研，代码一行没改。Mac Hub 源码是另一个仓库 `LYJW131/MacTelemetryHub`，在本仓库是子模块 `reporters/mac-telemetry-hub`，本地先 `git submodule update --init` 再看下文的 Swift 路径。

## 已定的取舍（不必再讨论）

- 上报保持同步：入口处理完再回执，不接 Cloudflare Queues，也不把提交挪进 `waitUntil`。理由：上报器都是后台常驻进程，几百毫秒的等待没人感知；异步之后要补持久队列、幂等、乱序防护和消息大小限制，不值得。
- 回执成功码从 202 改为 200：返回时实时层、可滞后层、凭据都已写完，语义就是 200。
- 图片：上报器每封都带 `objectKey`，站点不再维护「来源键 → objectKey」对应表，也不再在回执里告诉上报器缺哪张图。
  - 上报器上报前确认对象在 R2：先看本地「已确认」标记，没有就 HEAD，HEAD 不到就上传，成功后打标记。
  - 标记可清除，三种方式：到期后重新 HEAD（对象按内容寻址、仓库代码不删 R2 对象，有效期可放宽到小时级）、进程重启清空、手动清（Mac 设置页加按钮；Emby 靠重启）。
  - HEAD 或上传失败、超时都不能卡住上报：这一封照发，`objectKey` 为 null，下次再补。
  - 入口对 Emby 已有的 `hasStoredImage` 核对保留：核对不过就当没图，不回执。
- 不在本轮范围：把 Apple Music token 改成定时重发（以便去掉「凭据写完才回执」这条特殊规则）；查 iPhone 和 Mac 的 coding 数据是否只在变化时上报。

## 任务 A：202 → 200

只有入口一处产出 202，消费方全部按 2xx 判断成功（已核对），所以不需要协调上线顺序：

- `reporters/*/src/site.ts` 都是 `response.ok`。
- Mac Hub `reporters/mac-telemetry-hub/App/MacTelemetryHub/TelemetryPoster.swift` 判断 `200..<300`。
- iPhone `apps/ios/App/Hub/TelemetryHub.swift` 判断 `200..<300`。
- 没核对：两台 Home Assistant 的 `rest_command`（配置在 dsm / n100，路径见 `docs/ops-facts.md`）。HA 一般只把 ≥400 当失败，改完后看一眼 HA 日志。

要改的地方：

- `workers/ingress/src/worker.ts`：`commitIngest` 的成功返回；`handleIngest` 里 OTLP 分支判断 `response.status === 202` 要跟着改；凭据那行注释里的「回 202」。
- `workers/ingress/src/worker.test.ts`：所有断言 202 的地方，测试名里也有 202。
- `scripts/verify-api-worker.mjs`、`scripts/verify-coding-usage.mjs`：断言与默认参数 `status = 202`。
- `reporters/playstation-reporter/src/site.test.ts`：mock 的 202。
- 文档：
  - `workers/ingress/README.md`：回执表、「202 表示…」那段、「拆分」第 4 条；
  - `workers/api/AGENTS.md`：提交持久化那条；
  - `workers/api/README.md`：屏障那段；
  - `reporters/agents-reporter/src/site.ts` 的注释与 `reporters/agents-reporter/README.md`；
  - `docs/explainer/FACTS.md`：「202 的时机」一节和其他提到 202 的段落；
  - `docs/explainer/TREATMENT.md`：「202 这枚章」等处；
  - Mac Hub `reporters/mac-telemetry-hub/Tests/TelemetryCoreTests/TelemetryEnvelopeTests.swift` 的注释。
- 不要改：`docs/reporter-endpoints.md` 和 `docs/do-execution-audit.md`。两者是 record 类型的历史快照，`docs/do-performance-evidence.json` 是测量数据，这三份都不随现状改。
- 跟 202 无关、别误改：`src/lib/github-repo.ts` 里的 202 是 GitHub API 的。

## 任务 B：图片改为上报器自带 objectKey

### 现状（调研结论）

- **Emby**
  - 条目里存的是来源键 `posterKey` / `backdropKey`。键由 `reporters/emby-reporter/src/emby.ts#imageRef` 拼成 `itemId:kind:tag:height`，Emby 换图时 tag 会变。
  - 上报器上传 R2 后，在信封的 `images: [{ imageKey, objectKey }]` 里带上对应关系（`reporters/emby-reporter/src/index.ts#collectImages`）。
  - 入口用 `shared/ingest/emby.ts#prepareImages` 调 `shared/ingest/r2-assets.ts#hasStoredImage` 核对。
  - 状态核心把对应表存进 `shared/emby-store.ts#imagesMirror`（`workers/api/src/stores/emby-store.ts#setImageObjectKeys`，有上限 `IMAGE_LIMIT`）。
  - 读取时 `shared/emby.ts#resolve` 查表拼路径；查不到的键由 `workers/api/src/stores/emby.ts#missingKeys` 放进回执 `missingImages`，上报器据此重传。
  - 上报器的 R2 代码 `reporters/emby-reporter/src/r2.ts` 只有 PUT，没有 HEAD。
- **Mac 桌面图标和充电头封面**
  - 信封带 `iconHash` 和 `iconObjectKey`。
    - 桌面图标：`iconHash` 是源图标 TIFF 的 SHA-256，`objectKey` 是 96×96 PNG 的 SHA-256（`reporters/mac-telemetry-hub/App/MacTelemetryHub/TelemetryModules.swift#capture`）。
    - 充电头封面：两者是同一份 JPEG 的哈希（`reporters/mac-telemetry-hub/App/MacTelemetryHub/ChargerCoverController.swift`）。
  - 站点在 `workers/api/src/stores/telemetry.ts` 维护 `desktopIconAssets`（`iconHash → objectKey`，有上限 `DESKTOP_ICON_CACHE_LIMIT`，函数 `rememberDesktopIcon`），状态字段定义在 `shared/telemetry.ts`。回执带 `desktopIconAvailable` / `chargerCoverIconAvailable`。
  - Mac 已经会 HEAD 和上传，也有已确认标记：`reporters/mac-telemetry-hub/App/MacTelemetryHub/IconUploadCoordinator.swift`，里面有 `uploadedHashes`、`verifiedAt`、`verificationInterval`、`forget`。只在确认后才带 `iconObjectKey`。收到 `false` 时会 `forget`：`reporters/mac-telemetry-hub/Sources/TelemetryCore/LastPostedState.swift`、`reporters/mac-telemetry-hub/App/MacTelemetryHub/ServiceController.swift`（搜 `desktopIconRejected` / `sentCoverHadObjectKey`）。
  - 入口校验「`iconObjectKey` 必须和 `iconHash` 一起上报」：桌面图标在 `shared/ingest/telemetry.ts`，封面在 `src/lib/charging-device.ts`。
  - 公开类型 `src/lib/types.ts#ChargerStatus` 的 `cover` 里也有 `iconHash`。iOS App 不解码它，只有测试夹具 `apps/ios/Tests/Fixtures/charger.json` 里带着。

### 目标形状

- Emby 条目直接带 `posterObjectKey` / `backdropObjectKey`（命名按根 `AGENTS.md` 的「图片键」约定，最终名字由你定），删掉信封里的 `images`、来源键 `posterKey` / `backdropKey`、`imagesMirror` 和 `missingImages`。入口对每个 objectKey 照旧跑 `hasStoredImage`，不过的置 null。
- Mac 的 `desktop` 和 `chargingDevices.charger.cover` 只带 `iconObjectKey`，删掉 `iconHash`。`iconHash` 留在 Mac 本地作缓存键。站点删掉 `desktopIconAssets`、`rememberDesktopIcon`、`DESKTOP_ICON_CACHE_LIMIT` 和两个 `*IconAvailable` 回执字段。
- 坑：`workers/api/src/stores/charger-store.ts#structuralKey` 用 `cover.iconHash` 判断结构变化。改成 `iconObjectKey` 的话，图标从 null 补传成功时会被当成一次结构变化，先看清 `planHistory` 拿结构变化做什么，再决定是只比 `cover.name` 还是换成 objectKey。

### 站点侧要改的文件

- Emby
  - `shared/ingest/emby.ts`
  - `shared/emby-store.ts`
  - `shared/emby.ts`
  - `workers/api/src/stores/emby.ts`
  - `workers/api/src/stores/emby-store.ts`
  - `src/lib/emby-store.ts#getImageObjectKeys`
  - `src/lib/emby.ts`
- Mac
  - `shared/ingest/telemetry.ts`
  - `shared/telemetry.ts`
  - `workers/api/src/stores/telemetry.ts`
  - `workers/api/src/stores/charger-store.ts`
  - `src/lib/charging-device.ts`
  - `src/lib/types.ts`
  - `src/lib/anker.ts`、`src/lib/local-charging.ts`（这两个引用了 `iconObjectKey`，核对是否受影响）
  - `apps/ios/Tests/Fixtures/charger.json`
- 测试：
  - `workers/api/src/ingest-boundary.test.ts`
  - `workers/ingress/src/worker.test.ts`
  - `scripts/verify-api-worker.mjs`（Emby 图片段）
  - `shared/ingest`、`src/lib` 下对应的单测（用 `missingImages` / `iconHash` / `posterKey` 搜）
- 文档：
  - 根 `AGENTS.md` 的「图片键」那行（现在举例 `posterKey`、`backdropKey`、`iconHash`）；
  - `docs/telemetry-subsystems.md` 的「`missingImages` 补传机制」；
  - `docs/explainer/FACTS.md` 的 Emby 海报那条；
  - `workers/ingress/README.md` 的回执表；
  - `reporters/emby-reporter/README.md`。

### 上报器侧

- **emby-reporter**
  - 在 `reporters/emby-reporter/src/r2.ts` 加 HEAD。
  - 维护「图片来源键 → { objectKey, 确认时间 }」标记，过期就重新 HEAD。
  - 每次推送前把引用到的图都确认一遍，再在条目里填 objectKey。确认要先下载、用 sharp 压缩、算哈希，所以来源键到 objectKey 的映射也要缓存（tag 变了键就变，这份缓存不会过期）。重启后重算当前列表那十几张即可，嫌重再落盘。
  - 保留现有的单次推送张数上限 `config.imagesPerPush` 和失败预算 `MAX_IMAGE_ATTEMPTS`。
  - 删掉 `missingImages` 的处理和 `knownImages` 那套逻辑。
- **Mac Hub**
  - 发出的信封里去掉 `iconHash`。
  - 去掉对 `desktopIconAvailable` / `chargerCoverIconAvailable` 的处理（`reporters/mac-telemetry-hub/Sources/TelemetryCore/TelemetryEnvelope.swift` 的回执结构、上面提到的 LastPostedState 与 ServiceController、对应测试）。
  - 把 `verificationInterval` 放宽。
  - 设置页加「清除图标确认缓存」。
  - 未确认时不阻塞上报这一点现在已经满足，保持不变。
  - Hub 推送后，按根 `AGENTS.md` 的规则把本仓库子模块指针挪到同一提交，并入站点这次提交。

### 上线顺序

按根 `AGENTS.md` 的「部署流程」：

1. 站点先上新契约：`workers/api` 先于 `workers/ingress`，Workers 契约只加不改，跨 Worker 的切换按那里写的手动部署例外处理；之后 Vercel 跟进。
2. 再切上报器：emby-reporter 在 dsm 上手动发布，Mac Hub 本机安装。

过渡期旧上报器还会发旧字段，入口对删掉的字段要**忽略、不能拒收**，否则整封会 400。先确认 `shared/ingest/telemetry.ts` 和 `shared/ingest/emby.ts` 遇到多余字段是忽略还是报错。旧的 Emby 条目里没有 objectKey，要等下一次整份推送（`fullPushIntervalMs`）图才回来，这可以接受。

## 验证

- 入口：`pnpm --dir workers/ingress typecheck`、`pnpm --dir workers/ingress test`。
- api 和端到端：按 `workers/api/AGENTS.md` 写的命令跑，外加 `node scripts/verify-api-worker.mjs`。
- 站点：`pnpm typecheck`、`pnpm test`、改动文件跑 `pnpm exec eslint`、`pnpm docs:check`。
- 页面：Emby 海报、桌面图标、充电头封面三张卡，用 `pnpm dev:worker` + `pnpm dev:local` 在浏览器里看，桌面和 375px 两个宽度都看。
- 上线后：从生产域名确认三处图片正常，看 Sentry 里 `worker:ingress` 有没有新增 400。
