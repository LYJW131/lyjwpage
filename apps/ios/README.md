# lyjwpage iOS App

个人主页的原生 iOS 客户端，同时是 iPhone 端的上报器。两件事各走各的路：

- **看**：读站点公开的状态 API 和推送长连接，把首页各卡、Pulse 时间线、最近记录用原生界面呈现，和浏览器访客看到的是同一份事实。只在前台工作。
- **报**：HealthKit 有新样本时系统把 App 从后台拉起来，把活动圆环和最近训练 POST 到 `/api/ingest/iphone`，报完就睡。协议与链路见下方「上报」。

原生 SwiftUI；最低系统版本和 App 版本见 `project.yml`（`deploymentTarget`、`MARKETING_VERSION`），需要带对应 SDK 的 Xcode 编译。界面是 iOS 原生的液态玻璃设计语言：Tab 栏、工具栏、浮在媒体上的按钮用系统的玻璃，内容层用分组背景（HIG「Materials」：别把玻璃铺进内容层）；界面文案一律英文，和站点一致。

## 四个分区

| 分区 | 内容 |
| --- | --- |
| Now | 站点首页那些卡：Mac 前台应用与所在时区的时钟、正在看、充电、正在听、活动与训练、Vibe Coding、落地节点、PlayStation、服务商状态、站点自身。「正在看」「充电」只在对应的事发生时出现，和站点一致。卡片顺序与显隐可在 Arrange 里拖动调整（只存在这台手机上）。 |
| Pulse | 最近 24 小时的时间线：编码、听、看、玩画成区间条，token 速率、充电功率、步数各一张小图；按住拖动选一个时刻，下面列出那一刻各泳道在干什么。支持 Apple Intelligence 的机型上可以让设备端模型写两句「今日回顾」。 |
| Library | 最近听、最近看、最近训练、游戏与奖杯。 |
| iPhone | 这台手机作为上报器：本机 HealthKit 读到的圈和训练、最近一次上报的结果、设置（上报地址与 Access 凭据、模块开关）。右上角 Report Now 立刻报一次。 |

正在听的歌显示在 Tab 栏的底部附件里（系统音乐 App 迷你播放器的位置），点开是完整的正在播放：进度按上报时刻往前推，有同步歌词就逐行高亮。展开页采用封面、曲目信息、进度与底部操作的布局，支持横屏和动态字体；Lyrics 切换歌词，Song Options 与 Share Song 使用原生菜单和分享面板。

Listen Along 用 `SystemMusic.swift#SystemMusic.listenAlong` 调用系统音乐 App：先请求 Media & Apple Music 授权，再把当前曲库 ID、推算的播放进度、后续曲目和单曲循环交给 `MPMusicPlayerController.systemMusicPlayer.openToPlay`。音乐 App 接手后继续播放，lyjwpage 不在后台同步 Mac / HomePod 的换歌、暂停或进度；回到 App 后再次点击可重新对齐。没有曲库 ID 时无法跟随，模拟器会提示需要真机。真实播放仍需真机上可用的 Apple Music 账号与曲目。

## 读：和访客看同一份

- 状态 API 在 api Worker（`Core/StatusClient.swift#SiteHosts`），GET 不带 `Origin`；推送长连接 `/ws` 必须带白名单里的来源，App 自报站点域名。站点改 `ALLOWED_ORIGINS` 时要留着它。
- 哪一路多久取一次照浏览器端：实时层按卡片自己的间隔，推送连着时能退成兜底的退成兜底；可滞后层按 `updatedAt + 节奏 + 宽限` 去取、逾期退避。登记在 `Core/Live/FeedSchedule.swift`，每条标了站点侧的出处。
- 推送与轮询交错时按代际戳丢掉旧的（`LiveStore` 的顺序闸），充电头推送不带历史，接在手上的曲线后面。
- 过期规则（多久没更新写 Unavailable、Mac 掉线时正在听换成 HomePod 那一路）照站点的 `src/lib/freshness.ts`，见 `Core/Freshness.swift` 与 `Core/Live/LiveStore+Derived.swift`。
- 冷启动先解上次落盘的响应体垫底（Caches 里，系统清了就是第一次打开的样子），随后照常回源。
- 退到后台就断推送、停排期：推送连着会算进站点页脚的「Online now」，这和关掉标签页是同一个语义。

站点那侧的类型（`src/lib/types.ts` 等）是这里模型的来源；只声明 App 用得到的字段，多出来的字段解码时忽略，所以站点加字段不会让 App 解码失败。站点改名或删字段时，这里的模型和 `Tests/` 一起改。

## iOS 27 特性用在哪

| 特性 | 用处 |
| --- | --- |
| `Tab(role: .prominent)` | 「iPhone」分区单独摆在 Tab 栏末端 |
| `tabViewBottomAccessory` + `tabBarMinimizeBehavior` | 正在听的迷你播放器；往下滚时 Tab 栏收起、附件并进同一行 |
| `topBarPinnedTrailing` | 「Report Now」钉在右上角，窗口变窄也不进溢出菜单 |
| `ToolbarOverflowMenu` + `visibilityPriority` | Now 页的次要操作收进溢出菜单，Arrange 优先保留 |
| `toolbarMinimizationBehavior` | 往下滚时导航栏收起 |
| `reorderable()` + `reorderContainer` | Arrange 里拖动排卡片 |
| `List` + `swipeActions` + `ShareLink` | Library 的看片左滑、跳转与系统分享 |
| `AsyncImage(request:)` + `asyncImageURLSession` | 内容地址的图片走磁盘缓存 |
| `.navigationTransition(.crossFade)` | 设置与 Arrange 面板淡入 |
| `IntentExecutionTargets` | 「Report Telemetry」快捷指令只在主 App 进程执行 |
| Foundation Models | Pulse 的「Day in Review」，设备端生成 |
| 可调尺寸的 iPhone App | 不再锁竖屏；宽窗口（iPhone Duo 展开、在 iPad 上运行）卡片排两列 |

液态玻璃本身（`glassProminent`、`backgroundExtensionEffect`、系统栏）是 iOS 26 引入的，iOS 27 沿用。iPhone Duo 的 `ArrangementView`、铰链、保留区域 API 目前是 27.1 beta，没用。

## 小组件与快捷指令

- 小组件（`Widgets/`）：「Listening」（小、中、锁屏长条）与「Activity Rings」（小、锁屏圆形与长条）。各自直接读站点的状态 API，不和 App 共享存储；封面在时间线里预先下载（小组件里不能用 `AsyncImage`）；着色与透明主屏上封面按系统规则去饱和。
- 快捷指令（`App/Intents/`）：「Report Telemetry」在后台立刻报一次，可绑到操作按钮；「What's Playing on lyjw.me」读站点此刻在放什么。

## 目录与验证

`project.yml` 开头写了哪个目录进哪个目标：`App/` 只进主 App，`Widgets/` 只进小组件，`Core/`（站点模型、取数、推送）主 App 全要、小组件不要 `Live/`，`SharedUI/` 两边都要，`Tests/` 只进单测。

`Core/` 不碰任何 UI 框架，`Package.swift` 把它和 `Tests/` 拼成一个 SwiftPM 包，Linux 工具链上也能跑：

```bash
cd apps/ios && swift test
```

测试对着两份样本解码：`Tests/Fixtures/` 是某一刻从生产 api Worker 抓的快照；站点本地开发用的 `workers/api/dev-fixtures/` 直接读仓库里那一份，覆盖此刻没发生的状态。站点契约变了两边一起红。Xcode 里同一批测试在 `LyjwpageTests` 目标（不挂宿主 App）。

模拟器端到端测试使用 `UITests/SimulatorTests.swift`，覆盖生产分区、刷新、排序与显隐保存、播放器与歌词、Pulse 选点、看片左滑与分享、缓存与失败状态、设置及横屏大字体。先在仓库根启动 `pnpm dev:worker`（`.dev.vars` 配 `DEV_OVERRIDES=true`），运行 `pnpm dev:override --on`，再启动目标模拟器：

```bash
cd apps/ios
./Tools/run-simulator-tests.sh
# 指定设备时设置 LYJWPAGE_SIMULATOR=<UDID>；脚本默认使用已启动的模拟器。
```

测试代理 `Tools/simulator-test-proxy.mjs` 只为 `/api/lyrics` 提供确定性歌词，其余 HTTP 与 WebSocket 转发到本地 Worker。测试会写入本地状态夹具；完成后在仓库根用 `pnpm dev:override --list` 查看注入，对每个端点执行 `pnpm dev:override <端点> --clear`，再执行 `pnpm dev:override --off`。测试中的 Apple Music 只验证模拟器提示，HealthKit、系统音乐播放、小组件和快捷指令的真实执行仍须在设备上验证。

界面层只能在 Mac 上用 Xcode 编译；首次上机的步骤与待验证清单见 [iOS App 上机验证](../../docs/ios-app-handoff.md)。

## 装

```bash
./build-install.sh
```

它做四件事：画图标 → `xcodegen generate` → `xcodebuild` Release（App 与小组件扩展一起） → `devicectl` 装到手机。
自动挑那台配对着的 iPhone；挑不出唯一一台时会把候选列出来，用
`LYJWPAGE_IOS_DEVICE=<identifier> ./build-install.sh` 指定。签名走自动，Team 默认
`2VTXNMR2GL`（`LYJWPAGE_IOS_TEAM` 可改）。

`.xcodeproj` **不入库**，是 `project.yml` 生成的 —— 几千行 pbxproj 进版本库只会在每次
改文件时制造无意义的冲突。

**bundle id 是 `com.liangyangjunwei.iPhoneTelemetryHub`，不随 App 名字走**：换了的话 HealthKit 授权、钥匙串里的 Access 密钥、带 HealthKit 能力的描述文件都要重来；装着同一 bundle id 的手机覆盖安装，这些都还在。小组件扩展是它的后缀 `.Widgets`，第一次编译时自动签名会顺带申请描述文件。

全新安装时第一次打开要做两件事：

1. 允许读取健康数据 —— **活动与训练所需的读取权限全勾**。少勾哪项就少哪项，站点那边对应的格子直接不渲染。
2. 「iPhone」页右上角齿轮里手填上报地址 `https://ingest.homepage.lyjw.llc/api/ingest/iphone`，以及
   Cloudflare Access 里 `lyjwpage-iphone` 那把 service token 的 Client ID 和 Client Secret，
   保存后按一次 Report Now。Secret 存钥匙串，`kSecAttrAccessibleAfterFirstUnlock` ——
   锁屏状态下被唤醒也要读得到它。换钥就在 Zero Trust 控制台重新生成这把 token 的 Secret，
   再贴进设置里保存。

本机 Worker 没有 Access，只认 `scripts/dev-access.mjs` 签的 JWT，App 发不出这个头，
所以本机联调上报链路用那个脚本配 curl；Info.plist 里的 `NSAllowsLocalNetworking` 留着给别的本机调试。**别填 `dev.lyjw.me`** —— 那份预览部署
开着 Vercel Authentication，App 的 POST 过不去。

## 上报

一个入口、一个信封、一个模块字典，只带这次真的变了的模块，POST 到 `/api/ingest/iphone`。和 Mac 上那个（MacTelemetryHub）是同一件事的手机版。

- **活动圆环**：三环（活动 / 锻炼 / 站立）加当天步数、距离、爬楼层数；同时读取最近 24 小时已经结束的 UTC 五分钟 HealthKit 统计桶，供 Pulse 回填真实时段。
- **最近训练**：HealthKit 最近 10 次已完成训练，按结束时间倒序；包含类型、开始/结束时间、实际活动时长（扣除暂停）、距离和活动消耗。距离与消耗没有读数时省略，不补零。同时读取训练自带的平均/最高心率统计、室内外标记及爬升（如有）；不查询逐点心率样本、路线或位置。距离和消耗保留原始精度，展示时才格式化。

训练模块随 HealthKit workout 变化请求后台投递，前台和手动上报也会刷新。每次发送完整的最近 10 条，删除记录时会同步删除；空列表表示没有可读取的训练，HealthKit 不区分未授权与无记录。训练时间优先使用记录的时区元数据，没有时使用手机当前时区在训练时刻的偏移。

活动历史每次发送完整的 24 小时查询范围。只发送 active energy、exercise time、steps 至少有一项真实统计的闭合五分钟桶；没有统计的桶保持未知，不补成静止，查询上界也不会延伸到此刻。HealthKit 查询失败时活动模块这次不上报（其他模块照常发），不用错误产生的空结果删除服务端历史。站点接收端把历史桶当选填：没带历史桶的旧版 App 仍能更新圆环，只是不产生 Pulse 历史桶，所以 Worker 可先于 App 部署。

上线顺序：先部署 Worker 与站点，让它们认得新模块（`KNOWN_MODULES`）、对应的公开端点已在线，再安装手机版本；新增了健康读取项就要允许授权并手动上报一次。Xcode 编译通过不能代替真机授权和后台唤醒验证。

### 和 Mac 那个哪里不一样

**骨架照抄，字段不照抄。** Mac 的信封里有 `heartbeatAt` / `presence` /
`activeModules`，这里一个都没有：它们在那边成立是因为 Mac 上跑的是常驻进程 ——
心跳能证明它还活着，`activeModules` 能让充电头在没有新读数时继续续命。

这个 App **平时根本不在运行**。它是模块自己的唤醒源（活动圆环那条是 HealthKit 的
观测）把它从后台拉起来的，报完就又睡了。照搬那三个字段只会让站点以为自己能判断
手机在不在线 —— 判不了。所以这条链路上没有存活、没有心跳，站点那张卡的新鲜度只看
「最近更新过没有」。协议版本号也从 1 起，不接着 Mac 的 4：两套协议各活各的。

### 加一个模块

写一个 `TelemetryModule` 的实现放进 `App/Hub/Modules/`，然后在
`Modules.all` 里加一行。**hub 不用改** —— 它不认识任何具体模块，只会让它们各自注册
唤醒源、各自交出快照。

协议为什么存在（而不是像 Mac 那样写一个「每个模块一个可选字段」的具体结构体）：手机上
模块各自带着自己的唤醒源，hub 必须能在不认识任何一个模块的前提下说「都去注册」。

**界面那层反过来是具体的**：`DeviceView` 直接认识各个模块（`ActivityModule` 画圈，
`WorkoutsModule` 列训练）。要是哪天想给协议加一个 `dashboardView()`，那就过线了 ——
每个模块的展示形态本来就天差地别。

站点那边也要认这个模块名：`shared/ingest/phone.ts` 的 `KNOWN_MODULES`（上报入口 prepare 时用）。
没认的模块会原样出现在回执的 `ignored` 里 —— 手机先于站点发版时，那是唯一看得见
这件事的地方。

### 签名会过期

装上去那个包是**开发签名**，有寿命。到期之后 iOS 直接拒绝启动它，站点那侧的表现只是
「圆环停在最后一次上报」，不会报任何错 —— 所以值得记一笔。

以「描述文件」和「实际签名用的那张证书」里**先到期的那个**为准，两个都能查：

```bash
# 描述文件
security cms -D -i ~/Library/Developer/Xcode/UserData/Provisioning\ Profiles/*.mobileprovision \
  | plutil -extract ExpirationDate raw -
# 真正签它的那张证书
codesign -dvvv "${TMPDIR:-/tmp}/lyjwpage-ios-xcode/Build/Products/Release-iphoneos/Lyjwpage.app"
```

描述文件的有效期是一年（付费个人账号的正常时长），而签名证书可能短得多 —— **短的是证书**。
描述文件里塞着好几张证书，Xcode 挑哪张是它自己的事，可能恰好挑到最早过期的一张。

到期了**重跑一次 `build-install.sh`** 就行：它会重新挑一张还有效的证书、必要时刷新描述
文件。钥匙串里的密钥和健康授权都留着，不用重新配。

### 装不上的两种

**`No Accounts: Add a new account in Accounts settings`**，跟着一串
「Provisioning profile "iOS Team Provisioning Profile: *" doesn't include the HealthKit
capability」—— 这不是工程配错了，是 **xcodebuild 拿不到开发者账号**，于是退回那份通配的
描述文件，而通配文件里没有 HealthKit 能力。带特殊能力的 bundle id 需要**现申请**一份
自己的描述文件，那一步绕不开账号。

最常见的原因是 **Mac 锁着屏**：登录钥匙串跟着锁上，Xcode 那条账号记录读不出来
（日志里会有 `Invalid credentials in keychain … missing Xcode-Username`）。解锁之后
重跑一般就好了；还不行就打开 Xcode → Settings → Accounts 看那个 Apple ID 要不要重新登。

对照着查：`~/Library/Developer/Xcode/UserData/Provisioning Profiles/` 下有没有一份
`iOS Team Provisioning Profile: com.liangyangjunwei.iPhoneTelemetryHub`。有、且没过期，
就说明账号那关过了。

**`Unable to find a destination matching { id:… }`** —— 手机不在线（锁屏、或者不在同一个
网络里）。`xcrun devicectl list devices` 看 `tunnelState`：`unavailable` 是连不上，
`disconnected` 就已经能装了。

编译**必须对着具体设备**（脚本里就是这么写的）：试过 `generic/platform=iOS`，那样自动
签名会挑通配的描述文件，照样缺 HealthKit 能力。

### 什么时候会上报

- 模块有新数据 → 系统把 App 唤起来 → 报一次。活动圆环这条**按小时节流**：
  `HKObserverQuery` 传 `.immediate` 也会被系统钳到 `.hourly`，别指望分钟级。
- 回到前台 → 报一次。这是唯一能绕开上面那个节流的路子。
- 按「iPhone」页的 Report Now，或跑快捷指令 Report Telemetry → 强制报一次，绕开合并窗口和「内容没变」两道闸。

多个唤醒源几乎同时响（活动圆环一个模块就观测着好几个 HealthKit 类型），
`App/Hub/TelemetryHub.swift#TelemetryHub.coalesce` 那个窗口把它们并成一封。
内容一个字节没变就不发，除非距上次上报已满 `TelemetryHub.refresh`（站点那边圆环读数按
`updatedAt` 判新鲜，超过 `src/lib/freshness.ts#ACTIVITY_STALE_MS` 没刷新就显示 Unavailable；
这次重发让「手机还在报、只是圈没变」也能续上时刻，所以 `refresh` 要小于它）。
判「变没变」用的是**编码后的字节**，指纹和真正发出去的 body 共用同一个
`JSONEncoder`（`sortedKeys`）—— 两套配置早晚会飘，飘了之后要么每轮白发一遍，要么反过来
把真变化吞掉。

### 两条不能单独改的规矩

1. **失败了不补发。** 站点那侧是「后到的就是对的」、整份替换，没有顺序闸。这里要是加了
   后台重试队列（`URLSession` 的 background 那套），一封迟到的旧报文就会把已经涨上去的
   数按回去。两边是一对，要加一起加。
2. **交差回调必须等上报结束再调。** 早调的话系统认为这次投递处理完了、随时可以挂起实例，
   上报被掐在半路；一次都不调更糟 —— HealthKit 退避几次之后就不再为这个 App 唤醒，
   表现是「装上那天好好的，过几天再也不更新」。

### 后台到底有没有在报

装好那天只能验到「手动按一下能报」——**后台唤醒这条路只有过几个小时才验得出来**，
而它恰好是最容易悄悄坏掉的一环。查法：装好、授权、手动报一次之后，**别开这个 App**，
过几个小时看站点上那张卡（或者再打开 App 看「iPhone」页的 Last report）。时间往前走了就说明
后台投递是通的。

一直不动的话，按这个顺序查：

1. **活动与训练健康权限是不是都给了。** 设置 → 隐私与安全性 → 健康 → lyjwpage。少给哪项就
   少哪项数据，全都没给的话连 summary 都读不到。
2. **`com.apple.developer.healthkit.background-delivery` 有没有进描述文件。** 少了这把钥匙
   `enableBackgroundDelivery` 会报授权错误，而前台点一下一切正常 —— 正是这种「装上那天
   好好的」的坏法。重跑一次 `build-install.sh`（自动签名会重新申请描述文件）。
3. **低电量模式。** 开着的时候系统会砍掉后台唤醒。
4. 都不是的话，把 App 从后台划掉再打开一次：唤醒源是在 `didFinishLaunching` 里注册的，
   一次干净的启动会重新注册 `Modules.all` 里各模块的观测。

### 日期这件事

`date` 直接从 summary 自己的 `dateComponents` 拼，**不另拿 `Date()` 算** —— 午夜前后
两者会差一天，而「这份数据说的是哪一天」正是站点唯一较真的东西：跨过午夜之后手表上的圈
已经归零，站点手上那份满环说的是昨天，卡片会把它画淡并写明日期。`secondsFromGMT` 一起发，
站点靠它判断手表那边现在是不是还是这一天。
