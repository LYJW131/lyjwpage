# iOS App 上机验证

> 类型：runbook

给在 Mac 上接手 [`apps/ios`](../apps/ios/README.md) 的 agent：把这个 App 第一次编过、测过、装上手机，并把验证结果写回仓库。App 是什么、怎么分层见它的 README；硬约束见 [`apps/ios/AGENTS.md`](../apps/ios/AGENTS.md)。做完一项就从本文删掉对应条目，全部做完后删掉本文并从 [docs/README.md](./README.md) 撤下登记。

## 已经验证到哪一步

写这个 App 的环境是 Linux，没有 iOS SDK，所以只验到了这些：

- `Core/`（站点模型、取数排期、推送连接、过期规则，纯 Foundation）在 Swift 6 语言模式、严格并发检查下编译通过；`Tests/` 全部通过，其中包括对着生产 api Worker 抓的每个端点快照解码、对着 `workers/api/dev-fixtures/` 的站点开发夹具解码。
- 所有 Swift 文件（含 `App/`、`Widgets/`、`SharedUI/`）在 Swift 6 模式下语法解析通过。
- 用到的 iOS 26 / 27 API 的名字与签名逐个对过 Apple 文档（`developer.apple.com/tutorials/data/documentation/<路径>.json`）。
- `apps/ios/project.yml` 用在 Linux 上编出来的 XcodeGen 生成过一次工程：三个目标的源文件归属（小组件不含 `Core/Live/`）、小组件扩展嵌入主 App、带测试目标的 scheme 都对。
- 界面层做过一轮对着 Core 声明与 SDK 文档的人工审查，查出并修掉了一处同模块重名（上报器与站点读侧都叫 `ActivityPayload`）。

**没验证的**：`App/`、`Widgets/`、`SharedUI/` 从没被真正编译过（SwiftUI、UIKit、HealthKit、WidgetKit、AppIntents、Charts、FoundationModels 在 Linux 上都没有），小组件扩展和快捷指令没跑过，真机和后台唤醒没测过。第一次编译出现一批编译错误是预期的。

## 前置

- 带 iOS 27 SDK 的 Xcode、`xcodegen`；Xcode 里登录着 Team `2VTXNMR2GL` 的 Apple ID，Mac 解锁（锁屏时钥匙串读不出账号，自动签名会退回通配描述文件，报缺 HealthKit 能力）。
- iPhone 与 Mac 配对、同一网络、解锁。手机上现在装着同一 bundle id 的旧版，覆盖安装后授权和钥匙串里的密钥都还在。

## 步骤

1. **共享层**：`cd apps/ios && swift test`，应全部通过。失败先看是不是站点契约变了（夹具是现读的），那是真问题，不是测试的问题。
2. **生成工程**：`xcodegen generate`。
3. **编模拟器包，修编译错误**：
   `xcodebuild -project Lyjwpage.xcodeproj -scheme Lyjwpage -destination 'generic/platform=iOS Simulator' build`
   - 修法：以 SDK 的真实签名为准改调用，保留原来的行为和意图；某个 iOS 27 API 签名和文档不一致时，查 Xcode 里的文档再改，不要为了编过把功能删掉。实在做不了的，改成退路（比如去掉那一个修饰符）并在提交说明和本文「已知取舍」里写明。
   - 高风险的几处（写的时候无法编译验证）：`apps/ios/App/Views/Pulse/DaySummaryCard.swift`（FoundationModels 的 builder 写法）、`apps/ios/Widgets/LyjwpageWidgets.swift`（`TimelineProvider` 的 `@Sendable` 回调与 `async let`）、`apps/ios/App/Views/Now/NowView.swift`（`reorderContainer` 的 `ReorderDifference` 用法、`ToolbarOverflowMenu`）、`apps/ios/App/Views/Pulse/PulseView.swift`（Charts 的 `RectangleMark` 与 `chartXSelection`）、`apps/ios/App/Intents/AppIntents.swift`（`supportedModes` / `allowedExecutionTargets`）、`apps/ios/Core/Live/LiveSocket.swift`（`URLSessionWebSocketTask` 在 Apple SDK 下的并发检查）。
4. **单测**：`xcodebuild -project Lyjwpage.xcodeproj -scheme Lyjwpage -destination 'platform=iOS Simulator,name=<任一 iOS 27 模拟器>' test`。
5. **模拟器里走一遍**（生产数据）：
   - Now：Mac 前台应用、时钟、各卡有数据；左上角是 Live（推送连上）；下拉刷新；Arrange 里拖动排序、关掉某张卡、Reset。
   - 正在听：Mac 或 HomePod 在放歌时 Tab 栏下方出现迷你播放器，往下滚时并进 Tab 栏；点开是完整的正在播放，进度每秒走，有歌词时逐行高亮；右上角 Open in Apple Music。
   - Pulse：时间线四条泳道、三张读数小图，按住拖动出现选中时刻的明细；支持 Apple Intelligence 的模拟器上 Day in Review 能生成。
   - Library：四个分段；Watching 行左滑出现 Emby / Share，点进详情顶部剧照延伸到状态栏下。
   - iPhone：模拟器没有健康数据，确认页面不崩、设置能存。
   - 横屏：Pro Max 尺寸横屏时 Now 排成两列。
   - 深色模式、动态字体放大各看一眼。
6. **看此刻没发生的状态**（充电、正在看、PlayStation 在玩）：本机起 `pnpm dev:worker`（首次先 `pnpm dev:worker:init`），`.dev.vars` 里 `DEV_OVERRIDES=true`，用 `pnpm dev:override <端点> <夹具>` 注入；在 Xcode 的 scheme → Run → Environment Variables 里加 `LYJWPAGE_API=http://localhost:8788` 再从 Xcode 运行（见 `apps/ios/Core/StatusClient.swift#SiteHosts`）。收尾 `--clear` / `--off`，把环境变量去掉。
7. **装到手机**：`./build-install.sh`。
   - 覆盖安装后「iPhone」页 Last report 有值、Settings 里地址和 Client ID 还在；按 Report Now 显示 Delivered。
   - 「Now」的 Activity 卡和「iPhone」页的本机圆环对得上。
   - 桌面加 Listening 与 Activity Rings 小组件，锁屏加圆形与长条；主屏切到着色 / 透明外观看封面与圆环是否可读。
   - 快捷指令 App 里跑 Report Telemetry（不打开 App 就完成），可绑到操作按钮；问 Siri「What's playing on lyjwpage」。
8. **后台唤醒**：装好、手动报一次后别再开 App，几小时后看站点上的圆环卡时间往前走了没有；不走按 [README「后台到底有没有在报」](../apps/ios/README.md#后台到底有没有在报) 查。
9. **收尾**：修过的地方提交（提交说明写清是哪条编译错误、怎么改的）；按根 AGENTS.md 的部署流程合进 main。App 不走任何自动部署，装到手机就是上线。

## 装上之后要回填的仓库事实

- [仓库外事实](./ops-facts.md) 里「上报来源与生产实例的对应」那一行还写着 iPhone 上跑的是「遥测中心」：装上新版并看到真实上报后，改成 lyjwpage iOS App 并更新核对戳。
- [架构图](./architecture.json) 里 iPhone 节点的名字与出处已改到 `apps/ios`，但 HTML 与 PNG 产物没重出（要本机的 archify 技能和 Chrome）：按 [screenshots.md「交互式架构图」](./screenshots.md#交互式架构图) 跑 `pnpm docs:architecture`。
- `/explainer` 讲解动画里 iPhone 那一格还叫 iPhone Telemetry Hub（`docs/explainer/v2/ch01.js`、`docs/explainer/scenes-1.js`、`docs/explainer/SCRIPT.md`）；要不要改名随下一版动画定，事实基线已在 [FACTS.md](./explainer/FACTS.md) 注明。

## 已知取舍

- **没做控制中心按钮**：控件要在小组件扩展里引用意图，而意图的执行体（上报器、HealthKit、钥匙串）只在主 App；按 `IntentExecutionTargets` 的文档，跨目标复用意图要把它放进共享框架。现在用快捷指令 + 操作按钮覆盖这个需求。
- **没用 iPhone Duo 的 `ArrangementView`、铰链与保留区域 API**：它们在 27.1 beta；布局靠尺寸类自适应，宽窗口两列。
- **图标还是脚本画的 PNG**（`apps/ios/Tools/generate-icon.swift`），没做 Icon Composer 的分层图标。
- **没做实时活动**：要服务端推送令牌，站点没有这条链路。
- 歌词只做了行级高亮；充电曲线每次取整份，没用 `?since=` 增量。
